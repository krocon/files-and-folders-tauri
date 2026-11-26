//! One connection (design 071): reads JSON-RPC lines from a client and answers them.
//! Independent of the transport – the Unix socket (`server`) and the tests use it.
//! Tool calls run on their own threads (rule 10); the reader keeps reading, so a
//! client can cancel a call or be disconnected while a call waits for the user.

use super::limits::MAX_LINE_BYTES;
use super::protocol::{self, Incoming};
use super::{Call, Conn, McpError, McpHub, tools};
use serde_json::{Value, json};
use std::io::{self, BufRead, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Reads one line of at most `max` bytes. `Ok(None)` = end of the stream; an
/// over-long or non-UTF-8 line is `InvalidData`.
pub fn read_line<R: BufRead>(reader: &mut R, max: usize) -> io::Result<Option<String>> {
    let mut buf = Vec::new();
    let n = reader
        .by_ref()
        .take(max as u64 + 1)
        .read_until(b'\n', &mut buf)?;
    if n == 0 {
        return Ok(None);
    }
    if buf.last() == Some(&b'\n') {
        buf.pop();
        if buf.last() == Some(&b'\r') {
            buf.pop();
        }
    } else if buf.len() > max {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "line too long"));
    }
    String::from_utf8(buf)
        .map(Some)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "not UTF-8"))
}

/// A name of a client in an error message: plain and short.
fn plain(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(64)
        .collect()
}

/// Where the answers of one connection go.
struct Output {
    writer: Mutex<Box<dyn Write + Send>>,
    /// A write failed: nothing is written any more.
    broken: AtomicBool,
    hub: Arc<McpHub>,
    conn: Arc<Conn>,
}

type Out = Arc<Output>;

/// Writes one message. A write that fails – the client is gone, or it did not read for
/// the transport's write timeout – ends the connection: the line may be half on the
/// wire, so whatever followed would not be a message any more, and every further
/// answer would wait for the timeout again.
fn send(out: &Out, line: &str) -> bool {
    {
        let mut w = out.writer.lock().unwrap_or_else(|e| e.into_inner());
        // checked under the lock: answers that waited behind the failed one see it
        if out.broken.load(Ordering::SeqCst) {
            return false;
        }
        let written = w
            .write_all(line.as_bytes())
            .and_then(|_| w.write_all(b"\n"))
            .and_then(|_| w.flush());
        if written.is_ok() {
            return true;
        }
        out.broken.store(true, Ordering::SeqCst);
    }
    // shuts the transport down: the reader ends and cleans up
    out.hub.disconnect(Some(out.conn.id));
    false
}

fn run_call(hub: Arc<McpHub>, conn: Arc<Conn>, out: Out, id: Value, params: Value) {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let key = protocol::id_key(&id);
    let Some(cancel) = hub.begin_call(&conn, &key) else {
        let e = McpError::new("rate_limited", "Too many calls at the same time");
        send(&out, &protocol::result(&id, protocol::tool_result(Err(e))));
        return;
    };
    let token = params
        .get("_meta")
        .and_then(|m| m.get("progressToken"))
        .filter(|t| t.is_string() || t.is_i64() || t.is_u64())
        .cloned();
    let worker = {
        let (hub, conn, out, id, key) = (
            hub.clone(),
            conn.clone(),
            out.clone(),
            id.clone(),
            key.clone(),
        );
        let name = name.to_string();
        move || {
            let progress = |done: u64, total: Option<u64>| {
                if let Some(token) = &token {
                    let mut p = json!({ "progressToken": token, "progress": done });
                    if let Some(t) = total {
                        p["total"] = json!(t);
                    }
                    send(&out, &protocol::notification("notifications/progress", p));
                }
            };
            let call = Call {
                conn: &conn,
                cancel: &cancel,
                progress: &progress,
            };
            let result = hub.call_tool(&call, &name, &args);
            hub.end_call(&conn, &key);
            // a call the client gave up gets no answer (it does not wait for one)
            if !cancel.load(Ordering::SeqCst) || conn.is_closed() {
                send(&out, &protocol::result(&id, protocol::tool_result(result)));
            }
        }
    };
    let spawned = std::thread::Builder::new()
        .name(format!("fnf-mcp-call-{}", conn.id))
        .spawn(worker);
    if spawned.is_err() {
        hub.end_call(&conn, &key);
        let e = McpError::new("not_available", "No thread for the call");
        send(&out, &protocol::result(&id, protocol::tool_result(Err(e))));
    }
}

/// Serves `conn` until its stream ends, then cleans up after it.
pub fn serve<R: BufRead>(
    hub: &Arc<McpHub>,
    conn: Arc<Conn>,
    mut reader: R,
    writer: Box<dyn Write + Send>,
) {
    let out: Out = Arc::new(Output {
        writer: Mutex::new(writer),
        broken: AtomicBool::new(false),
        hub: hub.clone(),
        conn: conn.clone(),
    });
    let mut initialized = false;
    loop {
        let line = match read_line(&mut reader, MAX_LINE_BYTES) {
            Ok(Some(l)) => l,
            Ok(None) => break,
            Err(e) => {
                if e.kind() == io::ErrorKind::InvalidData {
                    send(
                        &out,
                        &protocol::error(
                            &Value::Null,
                            protocol::INVALID_REQUEST,
                            "Message too long or not UTF-8",
                        ),
                    );
                }
                break;
            }
        };
        if conn.is_closed() {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        match protocol::parse(&line) {
            Incoming::Invalid(Some(answer)) => {
                send(&out, &answer);
            }
            Incoming::Invalid(None) => {}
            Incoming::Notification { method, params } => {
                if method == "notifications/cancelled"
                    && let Some(id) = params.get("requestId")
                {
                    conn.cancel_request(&protocol::id_key(id));
                }
            }
            Incoming::Request { id, method, params } => match method.as_str() {
                // once per connection: the name the user was asked about stays (review #6)
                "initialize" if initialized => {
                    send(
                        &out,
                        &protocol::error(&id, protocol::INVALID_REQUEST, "Already initialized"),
                    );
                }
                "initialize" => {
                    conn.set_name(&protocol::client_name(&params));
                    initialized = true;
                    hub.emit_status();
                    send(
                        &out,
                        &protocol::result(&id, protocol::initialize_result(&params, None)),
                    );
                }
                "ping" => {
                    send(&out, &protocol::result(&id, json!({})));
                }
                "tools/list" => {
                    send(&out, &protocol::result(&id, tools::list()));
                }
                "tools/call" => {
                    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                    if !initialized {
                        send(
                            &out,
                            &protocol::error(&id, protocol::INVALID_REQUEST, "Not initialized"),
                        );
                    } else if tools::find(name).is_none() {
                        // not on the positive list: it does not exist
                        let text = format!("Unknown tool: {}", plain(name));
                        send(&out, &protocol::error(&id, protocol::INVALID_PARAMS, &text));
                    } else {
                        run_call(hub.clone(), conn.clone(), out.clone(), id, params);
                    }
                }
                _ => {
                    send(
                        &out,
                        &protocol::error(&id, protocol::METHOD_NOT_FOUND, "Method not found"),
                    );
                }
            },
        }
    }
    hub.disconnected(&conn);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn lines_are_bounded() {
        let mut r = Cursor::new(b"abc\r\ndef\n\nlast".to_vec());
        assert_eq!(read_line(&mut r, 10).unwrap().as_deref(), Some("abc"));
        assert_eq!(read_line(&mut r, 10).unwrap().as_deref(), Some("def"));
        assert_eq!(read_line(&mut r, 10).unwrap().as_deref(), Some(""));
        assert_eq!(read_line(&mut r, 10).unwrap().as_deref(), Some("last"));
        assert_eq!(read_line(&mut r, 10).unwrap(), None);
        let mut long = Cursor::new(vec![b'x'; 100]);
        assert_eq!(
            read_line(&mut long, 10).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        // exactly at the limit is fine
        let mut exact = Cursor::new(b"0123456789\n".to_vec());
        assert_eq!(
            read_line(&mut exact, 10).unwrap().as_deref(),
            Some("0123456789")
        );
        let mut bad = Cursor::new(vec![0xff, 0xfe, b'\n']);
        assert_eq!(
            read_line(&mut bad, 10).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn tool_names_in_messages_are_plain() {
        assert_eq!(plain("run_shell"), "run_shell");
        assert_eq!(plain("x\"}\n<b>"), "xb");
        assert_eq!(plain(&"a".repeat(500)).len(), 64);
    }
}
