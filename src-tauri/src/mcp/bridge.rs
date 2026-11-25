//! Requests to the window (design 071): Rust asks, the frontend answers with
//! `mcp_reply`. Every request has a time limit and can be given up; at most one
//! proposal is open at a time. Keep in sync with `src/app/core/mcp/mcp.models.ts`.

use super::McpError;
use super::state::Side;
use crate::model::DirEntryDto;
use crate::search::SearchHit;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePair {
    pub entry: DirEntryDto,
    pub new_name: String,
    /// Names of the entry's folder, its parent and grandparent (`paths::parent_names`).
    pub parent_names: [String; 3],
}

/// What the window is asked to do. Entries are described by Rust – the frontend never
/// builds an entry from a path of a client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UiRequest {
    /// "‹client› wants to access …": once / always / deny.
    Pair {
        client: String,
    },
    Navigate {
        side: Side,
        path: String,
    },
    OpenTab {
        side: Side,
        path: String,
        title: String,
        activate: bool,
    },
    SetCursor {
        side: Side,
        path: String,
    },
    Mark {
        side: Side,
        paths: Vec<String>,
        mode: String,
    },
    QuickView {
        side: Side,
        path: String,
    },
    ShowResults {
        side: Side,
        title: String,
        hits: Vec<SearchHit>,
        roots: Vec<String>,
    },
    ProposeCopy {
        client: String,
        entries: Vec<DirEntryDto>,
        source_dir: String,
        target: String,
    },
    ProposeMove {
        client: String,
        entries: Vec<DirEntryDto>,
        source_dir: String,
        target: String,
    },
    ProposeDelete {
        client: String,
        entries: Vec<DirEntryDto>,
        source_dir: String,
    },
    ProposeRename {
        client: String,
        folder: String,
        pairs: Vec<RenamePair>,
    },
    ProposeMkdir {
        client: String,
        parent: String,
        parent_names: [String; 3],
        names: Vec<String>,
    },
}

impl UiRequest {
    pub fn is_proposal(&self) -> bool {
        matches!(
            self,
            UiRequest::ProposeCopy { .. }
                | UiRequest::ProposeMove { .. }
                | UiRequest::ProposeDelete { .. }
                | UiRequest::ProposeRename { .. }
                | UiRequest::ProposeMkdir { .. }
        )
    }
}

/// The frontend's answer. `ok = false` carries a code (`busy`, `not_found` …).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UiReply {
    pub ok: bool,
    #[serde(default)]
    pub code: Option<String>,
    /// Proposals: `confirmed` | `cancelled`.
    #[serde(default)]
    pub outcome: Option<String>,
    #[serde(default)]
    pub job_id: Option<String>,
    /// Pairing: `once` | `always` | `deny`.
    #[serde(default)]
    pub decision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UiEvent {
    Request {
        id: u64,
        request: Box<UiRequest>,
    },
    /// The request is over (time limit, the client gave up or was disconnected): an
    /// open dialog of it must close.
    Withdraw {
        id: u64,
    },
    Status {
        status: Box<super::McpStatus>,
    },
}

/// Sends an event to the window; false = nobody listens (any more).
pub type UiSink = Arc<dyn Fn(UiEvent) -> bool + Send + Sync>;

/// Codes a reply may carry – anything else becomes `not_available`.
const REPLY_CODES: [&str; 6] = [
    "busy",
    "not_found",
    "invalid_arguments",
    "limit_exceeded",
    "not_available",
    "out_of_scope",
];

#[derive(Default)]
pub struct Bridge {
    sink: Mutex<Option<UiSink>>,
    waiters: Mutex<HashMap<u64, mpsc::Sender<UiReply>>>,
    next: AtomicU64,
    proposal_open: AtomicBool,
}

struct ProposalSlot<'a>(Option<&'a AtomicBool>);

impl Drop for ProposalSlot<'_> {
    fn drop(&mut self) {
        if let Some(flag) = self.0 {
            flag.store(false, Ordering::SeqCst);
        }
    }
}

impl Bridge {
    pub fn set_sink(&self, sink: Option<UiSink>) {
        *self.sink.lock().unwrap_or_else(|e| e.into_inner()) = sink;
    }

    pub fn has_sink(&self) -> bool {
        self.sink
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
    }

    /// Sends an event that needs no answer.
    pub fn notify(&self, event: UiEvent) {
        let sink = self.sink.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if let Some(s) = sink
            && !s(event)
        {
            self.set_sink(None);
        }
    }

    /// Asks the window and waits for its answer – at most `timeout`, and only while
    /// `cancel` is not set. A second proposal while one is open is `busy`.
    pub fn ask(
        &self,
        request: UiRequest,
        timeout: Duration,
        cancel: &AtomicBool,
    ) -> Result<UiReply, McpError> {
        let sink = self
            .sink
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or_else(|| McpError::new("not_available", "The window is not ready"))?;
        let _slot = if request.is_proposal() {
            if self.proposal_open.swap(true, Ordering::SeqCst) {
                return Err(McpError::new(
                    "busy",
                    "Another proposal is waiting for the user",
                ));
            }
            ProposalSlot(Some(&self.proposal_open))
        } else {
            ProposalSlot(None)
        };
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = mpsc::channel();
        self.waiters
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, tx);
        let forget = |me: &Bridge| {
            me.waiters
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
        };
        if !sink(UiEvent::Request {
            id,
            request: Box::new(request),
        }) {
            forget(self);
            self.set_sink(None);
            return Err(McpError::new("not_available", "The window is not ready"));
        }
        let deadline = Instant::now() + timeout;
        loop {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(reply) => return check_reply(reply),
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(McpError::new("not_available", "The window is not ready"));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            let cancelled = cancel.load(Ordering::SeqCst);
            if cancelled || Instant::now() >= deadline {
                forget(self);
                self.notify(UiEvent::Withdraw { id });
                return Err(if cancelled {
                    McpError::new("cancelled", "The call was cancelled")
                } else {
                    McpError::new("timeout", "The user did not answer in time")
                });
            }
        }
    }

    /// The frontend's answer to request `id`; an unknown id (answered, timed out) is ignored.
    pub fn reply(&self, id: u64, reply: UiReply) {
        let tx = self
            .waiters
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
        if let Some(tx) = tx {
            let _ = tx.send(reply);
        }
    }
}

fn check_reply(reply: UiReply) -> Result<UiReply, McpError> {
    if reply.ok {
        return Ok(reply);
    }
    let code = reply
        .code
        .as_deref()
        .filter(|c| REPLY_CODES.contains(c))
        .unwrap_or("not_available");
    Err(McpError::new(code, ui_message(code)))
}

fn ui_message(code: &str) -> &'static str {
    match code {
        "busy" => "A dialog is open in Files and Folders – try again when it is closed",
        "not_found" => "The entry is not in the panel",
        "limit_exceeded" => "Too many tabs are open",
        "invalid_arguments" => "The window could not use the arguments",
        "out_of_scope" => "Not possible in this panel",
        _ => "The window could not do this",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn recording() -> (Arc<Bridge>, Arc<Mutex<Vec<UiEvent>>>) {
        let b = Arc::new(Bridge::default());
        let seen: Arc<Mutex<Vec<UiEvent>>> = Arc::default();
        let s = seen.clone();
        b.set_sink(Some(Arc::new(move |e| {
            s.lock().unwrap().push(e);
            true
        })));
        (b, seen)
    }

    fn request_id(seen: &Mutex<Vec<UiEvent>>) -> u64 {
        for _ in 0..200 {
            if let Some(UiEvent::Request { id, .. }) = seen.lock().unwrap().first() {
                return *id;
            }
            thread::sleep(Duration::from_millis(5));
        }
        panic!("no request arrived");
    }

    fn nav() -> UiRequest {
        UiRequest::Navigate {
            side: Side::Left,
            path: "/x".into(),
        }
    }

    fn del() -> UiRequest {
        UiRequest::ProposeDelete {
            client: "c".into(),
            entries: vec![],
            source_dir: String::new(),
        }
    }

    #[test]
    fn without_a_window_nothing_is_asked() {
        let b = Bridge::default();
        let e = b
            .ask(nav(), Duration::from_secs(1), &AtomicBool::new(false))
            .unwrap_err();
        assert_eq!(e.code, "not_available");
    }

    #[test]
    fn the_answer_reaches_the_asker() {
        let (b, seen) = recording();
        let b2 = b.clone();
        let t =
            thread::spawn(move || b2.ask(nav(), Duration::from_secs(5), &AtomicBool::new(false)));
        let id = request_id(&seen);
        b.reply(
            id,
            UiReply {
                ok: true,
                ..UiReply::default()
            },
        );
        assert!(t.join().unwrap().unwrap().ok);
        // a second answer to the same request is ignored
        b.reply(id, UiReply::default());
    }

    #[test]
    fn a_refusal_keeps_only_known_codes() {
        let (b, seen) = recording();
        for (code, expected) in [("busy", "busy"), ("<script>", "not_available")] {
            seen.lock().unwrap().clear();
            let b2 = b.clone();
            let t = thread::spawn(move || {
                b2.ask(nav(), Duration::from_secs(5), &AtomicBool::new(false))
            });
            let id = request_id(&seen);
            b.reply(
                id,
                UiReply {
                    ok: false,
                    code: Some(code.into()),
                    ..UiReply::default()
                },
            );
            assert_eq!(t.join().unwrap().unwrap_err().code, expected);
        }
    }

    #[test]
    fn a_timeout_withdraws_the_request() {
        let (b, seen) = recording();
        let e = b
            .ask(del(), Duration::from_millis(120), &AtomicBool::new(false))
            .unwrap_err();
        assert_eq!(e.code, "timeout");
        let events = seen.lock().unwrap();
        assert!(matches!(events.last(), Some(UiEvent::Withdraw { .. })));
        drop(events);
        // the slot is free again
        let e = b
            .ask(del(), Duration::from_millis(60), &AtomicBool::new(false))
            .unwrap_err();
        assert_eq!(e.code, "timeout");
    }

    #[test]
    fn a_cancelled_call_withdraws_the_request() {
        let (b, seen) = recording();
        let cancel = Arc::new(AtomicBool::new(false));
        let (b2, c2) = (b.clone(), cancel.clone());
        let t = thread::spawn(move || b2.ask(del(), Duration::from_secs(30), &c2));
        let _ = request_id(&seen);
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(t.join().unwrap().unwrap_err().code, "cancelled");
        assert!(matches!(
            seen.lock().unwrap().last(),
            Some(UiEvent::Withdraw { .. })
        ));
    }

    #[test]
    fn only_one_proposal_is_open() {
        let (b, seen) = recording();
        let b2 = b.clone();
        let t =
            thread::spawn(move || b2.ask(del(), Duration::from_secs(5), &AtomicBool::new(false)));
        let id = request_id(&seen);
        let e = b
            .ask(del(), Duration::from_secs(1), &AtomicBool::new(false))
            .unwrap_err();
        assert_eq!(e.code, "busy");
        b.reply(
            id,
            UiReply {
                ok: true,
                outcome: Some("cancelled".into()),
                ..UiReply::default()
            },
        );
        assert_eq!(
            t.join().unwrap().unwrap().outcome.as_deref(),
            Some("cancelled")
        );
    }

    #[test]
    fn a_dead_window_is_forgotten() {
        let b = Bridge::default();
        b.set_sink(Some(Arc::new(|_| false)));
        let e = b
            .ask(nav(), Duration::from_secs(1), &AtomicBool::new(false))
            .unwrap_err();
        assert_eq!(e.code, "not_available");
        assert!(!b.has_sink());
    }
}
