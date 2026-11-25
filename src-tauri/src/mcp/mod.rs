//! MCP interface (design 071): an agent works with the **running app** – it sees what
//! the window shows, uses the engines and proposes; the user confirms in the window.
//!
//! Rules (they come after `CLAUDE.md` §4):
//! - off by default (`mcp.enabled`); nothing listens while it is off;
//! - local only: a Unix socket for the signed-in user (`server`), no port;
//! - three tiers: 0 reads, 1 steers the view, 2 proposes – the normal dialog opens and
//!   the window starts the job after the user confirmed. **There is no tier 3**: no
//!   tool for the shell, external tools, opening files, attributes, passwords,
//!   connecting to servers or settings (`tools::TOOLS` is the positive list);
//! - every path of a client is checked like the commands check theirs and lies in the
//!   roots of `mcp.roots` (`scope`); jobs start only through `JobManager::start`, and
//!   only the reading kinds (`jobs::READ_KINDS`);
//! - limits and a rate limit per connection (`limits`); the log is in memory only and
//!   holds no path (`log`).
//!
//! Pure std code without Tauri – `commands/mcp.rs` only forwards.

pub mod bridge;
pub mod config;
pub mod jobs;
pub mod limits;
pub mod log;
pub mod pairing;
pub mod propose;
pub mod protocol;
pub mod read;
pub mod scope;
#[cfg(unix)]
pub mod server;
pub mod session;
pub mod state;
pub mod stdio;
#[cfg(all(test, unix))]
mod tests;
pub mod tools;
pub mod view;

use crate::error::FsError;
use crate::jobs::JobManager;
use bridge::{Bridge, UiEvent, UiRequest};
use config::McpConfig;
use jobs::JobTap;
use limits::RateLimiter;
use log::{CallLog, LogLine};
use pairing::{Pairing, PromptGate};
use scope::Scope;
use serde::Serialize;
use serde_json::Value;
use state::UiState;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

/// An error a tool answers with: a code for the agent and a short text. Never a
/// message of the system (it may name paths).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpError {
    pub code: String,
    pub message: String,
}

impl McpError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_arguments", message)
    }
}

/// The wire name of an [`FsError`] code (`not_found`, `permission_denied` …).
pub fn fs_code(e: &FsError) -> String {
    serde_json::to_value(e.code)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "io".to_string())
}

impl From<FsError> for McpError {
    fn from(e: FsError) -> Self {
        let code = fs_code(&e);
        let message = format!("The file system operation failed ({code})");
        Self { code, message }
    }
}

/// What the hub needs from the app.
pub struct Deps {
    pub jobs: Arc<JobManager>,
    pub home: Option<PathBuf>,
    /// Where `settings.json` lives.
    pub config_dir: PathBuf,
    /// The app's own folders – never visible to a client.
    pub denied: Vec<PathBuf>,
    /// Where to listen; `Err` = this platform or setup cannot.
    pub socket: Result<PathBuf, McpError>,
}

/// One connected client.
pub struct Conn {
    pub id: u64,
    name: Mutex<String>,
    pub since_ms: i64,
    pairing: Mutex<Pairing>,
    /// Paired through `mcp.clients` – revoked when the name leaves the list.
    via_list: AtomicBool,
    rate: Mutex<RateLimiter>,
    active: AtomicUsize,
    calls: AtomicU64,
    /// Request id (JSON text) → cancel flag of a running call.
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    closed: AtomicBool,
    connected: Instant,
    /// Closes the transport (the reader thread ends and cleans up).
    closer: Box<dyn Fn() + Send + Sync>,
}

impl Conn {
    pub fn name(&self) -> String {
        self.name.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_name(&self, raw: &str) {
        *self.name.lock().unwrap_or_else(|e| e.into_inner()) = pairing::clean_name(raw);
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// The client gave up request `id` (`notifications/cancelled`).
    pub fn cancel_request(&self, id: &str) {
        if let Some(flag) = self
            .cancels
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
        {
            flag.store(true, Ordering::SeqCst);
        }
    }

    fn cancel_all(&self) {
        for flag in self
            .cancels
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
        {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

/// One tool call: who asks, how to notice that the client gave up, how to report progress.
pub struct Call<'a> {
    pub conn: &'a Arc<Conn>,
    pub cancel: &'a AtomicBool,
    pub progress: &'a (dyn Fn(u64, Option<u64>) + Sync),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub connection: u64,
    pub name: String,
    pub since_ms: i64,
    pub calls: u64,
    pub paired: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    pub listening: bool,
    /// Why it does not listen although it is on (`unsupported`, `in_use`,
    /// `socket_path_too_long`, `io`).
    pub error: Option<String>,
    pub allow_content: bool,
    pub clients: Vec<ClientInfo>,
    /// Newest last. No paths (rule 9).
    pub log: Vec<LogLine>,
}

pub struct McpHub {
    pub(crate) deps: Deps,
    config: RwLock<McpConfig>,
    scope: RwLock<Arc<Scope>>,
    ui: RwLock<UiState>,
    pub bridge: Bridge,
    pub(crate) tap: Arc<JobTap>,
    log: CallLog,
    conns: Mutex<HashMap<u64, Arc<Conn>>>,
    #[cfg(unix)]
    server: Mutex<Option<server::ServerHandle>>,
    listen_error: Mutex<Option<String>>,
    gate: Mutex<PromptGate>,
    /// When the window last heard about a call.
    last_status: Mutex<Option<Instant>>,
    /// One pairing question at a time.
    pair_lock: Mutex<()>,
    next_conn: AtomicU64,
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl McpHub {
    /// A hub that is off. `tap` must receive the events of `deps.jobs`.
    pub fn new(deps: Deps, tap: Arc<JobTap>) -> Arc<Self> {
        Arc::new(Self {
            deps,
            config: RwLock::new(McpConfig::default()),
            scope: RwLock::new(Arc::new(Scope::default())),
            ui: RwLock::new(UiState::default()),
            bridge: Bridge::default(),
            tap,
            log: CallLog::default(),
            conns: Mutex::new(HashMap::new()),
            #[cfg(unix)]
            server: Mutex::new(None),
            listen_error: Mutex::new(None),
            gate: Mutex::new(PromptGate::default()),
            last_status: Mutex::new(None),
            pair_lock: Mutex::new(()),
            next_conn: AtomicU64::new(0),
        })
    }

    pub fn config(&self) -> McpConfig {
        self.config
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn scope(&self) -> Arc<Scope> {
        self.scope.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn ui(&self) -> UiState {
        self.ui.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Reads the settings again and applies them (blocking: reads a file, may bind).
    pub fn sync(self: &Arc<Self>) -> McpStatus {
        let cfg = config::read(&self.deps.config_dir, self.deps.home.as_deref());
        self.apply(cfg);
        self.status()
    }

    /// Applies what the user allowed: starts or stops listening, replaces the roots,
    /// disconnects clients whose "always" was revoked. Switching off closes everything.
    pub fn apply(self: &Arc<Self>, cfg: McpConfig) {
        let scope = Scope::new(
            &cfg.roots,
            &self.deps.denied,
            self.deps.home.as_deref(),
            cfg.explicit_roots,
        );
        *self.scope.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(scope);
        let enabled = cfg.enabled;
        let clients = cfg.clients.clone();
        *self.config.write().unwrap_or_else(|e| e.into_inner()) = cfg;
        if !enabled {
            self.stop_listening();
            self.disconnect(None);
            *self.ui.write().unwrap_or_else(|e| e.into_inner()) = UiState::default();
            self.log.clear();
            *lock(&self.listen_error) = None;
            // off and on again: the pairing question may be asked again (review #3)
            *lock(&self.gate) = PromptGate::default();
        } else {
            // "always" was taken back: the connection ends, the next one asks again
            let revoked: Vec<Arc<Conn>> = lock(&self.conns)
                .values()
                .filter(|c| c.via_list.load(Ordering::SeqCst) && !clients.contains(&c.name()))
                .cloned()
                .collect();
            for c in revoked {
                (c.closer)();
                self.drop_conn(&c);
            }
            self.start_listening();
        }
        self.emit_status();
    }

    #[cfg(unix)]
    fn start_listening(self: &Arc<Self>) {
        let mut server = lock(&self.server);
        if server.is_some() {
            return;
        }
        let result = match &self.deps.socket {
            Ok(path) => server::start(self.clone(), path),
            Err(e) => Err(e.clone()),
        };
        *lock(&self.listen_error) = match result {
            Ok(handle) => {
                *server = Some(handle);
                None
            }
            Err(e) => Some(e.code),
        };
    }

    #[cfg(not(unix))]
    fn start_listening(self: &Arc<Self>) {
        *lock(&self.listen_error) = Some("unsupported".to_string());
    }

    #[cfg(unix)]
    fn stop_listening(&self) {
        let handle = lock(&self.server).take();
        if let Some(h) = handle {
            h.stop();
        }
    }

    #[cfg(not(unix))]
    fn stop_listening(&self) {}

    #[cfg(unix)]
    pub fn listening(&self) -> bool {
        lock(&self.server).is_some()
    }

    #[cfg(not(unix))]
    pub fn listening(&self) -> bool {
        false
    }

    /// The app ends: stop listening, close every connection, remove the socket.
    pub fn shutdown(&self) {
        self.stop_listening();
        self.disconnect(None);
    }

    pub fn status(&self) -> McpStatus {
        let cfg = self.config();
        let mut clients: Vec<ClientInfo> = lock(&self.conns)
            .values()
            .map(|c| ClientInfo {
                connection: c.id,
                name: c.name(),
                since_ms: c.since_ms,
                calls: c.calls.load(Ordering::SeqCst),
                paired: *lock(&c.pairing) == Pairing::Allowed,
            })
            .collect();
        clients.sort_by_key(|c| c.connection);
        McpStatus {
            enabled: cfg.enabled,
            listening: self.listening(),
            error: lock(&self.listen_error).clone(),
            allow_content: cfg.allow_content,
            clients,
            log: self.log.lines(),
        }
    }

    pub(crate) fn emit_status(&self) {
        if self.bridge.has_sink() {
            self.bridge.notify(UiEvent::Status {
                status: Box::new(self.status()),
            });
        }
    }

    /// After a call: the window hears about it, but not more often than
    /// [`limits::STATUS_GAP`] (review #9 – the status carries the whole log; the log
    /// dialog reads it on demand, connects and disconnects are told at once).
    fn emit_status_soon(&self) {
        let now = Instant::now();
        let mut last = lock(&self.last_status);
        if last.is_some_and(|t| now.saturating_duration_since(t) < limits::STATUS_GAP) {
            return;
        }
        *last = Some(now);
        drop(last);
        self.emit_status();
    }

    /// The frontend reports the window (only while MCP is on).
    pub fn publish_state(&self, state: UiState) -> Result<(), McpError> {
        if !self.config().enabled {
            return Err(disabled());
        }
        state::check(&state)?;
        *self.ui.write().unwrap_or_else(|e| e.into_inner()) = state;
        Ok(())
    }

    // ---- connections ----

    /// A client connected. `None`: the interface is off or full.
    pub fn connect(&self, closer: Box<dyn Fn() + Send + Sync>) -> Option<Arc<Conn>> {
        if !self.config().enabled {
            return None;
        }
        let mut conns = lock(&self.conns);
        if conns.len() >= limits::MAX_CONNECTIONS {
            return None;
        }
        let id = self.next_conn.fetch_add(1, Ordering::SeqCst) + 1;
        let conn = Arc::new(Conn {
            id,
            name: Mutex::new(pairing::UNKNOWN_CLIENT.to_string()),
            since_ms: now_ms(),
            pairing: Mutex::new(Pairing::Unknown),
            via_list: AtomicBool::new(false),
            rate: Mutex::new(RateLimiter::new(Instant::now())),
            active: AtomicUsize::new(0),
            calls: AtomicU64::new(0),
            cancels: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
            connected: Instant::now(),
            closer,
        });
        conns.insert(id, conn.clone());
        drop(conns);
        self.emit_status();
        Some(conn)
    }

    /// Forgets `conn`: running calls are given up, their jobs stop, an open proposal closes.
    fn drop_conn(&self, conn: &Conn) {
        conn.closed.store(true, Ordering::SeqCst);
        conn.cancel_all();
        lock(&self.conns).remove(&conn.id);
        for job in self.tap.running_of(conn.id) {
            self.deps.jobs.cancel(&job);
        }
    }

    /// The transport of `conn` ended (also after [`disconnect`](Self::disconnect)).
    pub fn disconnected(&self, conn: &Arc<Conn>) {
        self.drop_conn(conn);
        self.emit_status();
    }

    /// "Disconnect": one connection or all. Works at once – the transport is shut down
    /// and the connection is gone before this returns.
    pub fn disconnect(&self, id: Option<u64>) {
        let targets: Vec<Arc<Conn>> = lock(&self.conns)
            .values()
            .filter(|c| id.is_none_or(|i| i == c.id))
            .cloned()
            .collect();
        if targets.is_empty() {
            return;
        }
        for c in targets {
            (c.closer)();
            self.drop_conn(&c);
        }
        self.emit_status();
    }

    /// Closes connections that were never paired and are older than
    /// [`limits::UNPAIRED_IDLE`] (review #9) – they hold one of the few places. A call
    /// that waits for the user's answer keeps its connection.
    pub fn reap_unpaired(&self, now: Instant) -> usize {
        let idle: Vec<Arc<Conn>> = lock(&self.conns)
            .values()
            .filter(|c| {
                *lock(&c.pairing) != Pairing::Allowed
                    && c.active.load(Ordering::SeqCst) == 0
                    && now.saturating_duration_since(c.connected) >= limits::UNPAIRED_IDLE
            })
            .cloned()
            .collect();
        for c in &idle {
            (c.closer)();
            self.drop_conn(c);
        }
        if !idle.is_empty() {
            self.emit_status();
        }
        idle.len()
    }

    pub fn connection_count(&self) -> usize {
        lock(&self.conns).len()
    }

    // ---- calls ----

    /// Registers the cancel flag of request `id`; false = too many calls at once.
    pub fn begin_call(&self, conn: &Conn, id: &str) -> Option<Arc<AtomicBool>> {
        if conn.active.fetch_add(1, Ordering::SeqCst) >= limits::MAX_CALLS_AT_ONCE {
            conn.active.fetch_sub(1, Ordering::SeqCst);
            return None;
        }
        let flag = Arc::new(AtomicBool::new(conn.is_closed()));
        let mut cancels = lock(&conn.cancels);
        if cancels.contains_key(id) {
            // a second request with an id that is still running
            drop(cancels);
            conn.active.fetch_sub(1, Ordering::SeqCst);
            return None;
        }
        cancels.insert(id.to_string(), flag.clone());
        drop(cancels);
        Some(flag)
    }

    pub fn end_call(&self, conn: &Conn, id: &str) {
        lock(&conn.cancels).remove(id);
        conn.active.fetch_sub(1, Ordering::SeqCst);
    }

    /// Runs a tool for a client: on? known tool? rate, pairing, then the tool. Every
    /// call lands in the log – with a count, never with a path.
    pub fn call_tool(
        self: &Arc<Self>,
        call: &Call<'_>,
        name: &str,
        args: &Value,
    ) -> Result<Value, McpError> {
        let Some(tool) = tools::find(name) else {
            // the caller answers "unknown tool" on the protocol level
            return Err(McpError::new("unknown_tool", "Unknown tool"));
        };
        let result = self.checked_call(call, tool, args);
        call.conn.calls.fetch_add(1, Ordering::SeqCst);
        let outcome = match &result {
            Ok(v) => v
                .get("outcome")
                .or_else(|| v.get("status"))
                .and_then(Value::as_str)
                .unwrap_or("ok")
                .to_string(),
            Err(e) => e.code.clone(),
        };
        // refusals before pairing and by the rate limit are counted in one line
        let refused = matches!(outcome.as_str(), "not_paired" | "rate_limited");
        self.log.add_or_count(
            LogLine {
                at_ms: now_ms(),
                client: call.conn.name(),
                tool: tool.name.to_string(),
                count: if refused {
                    1
                } else {
                    tools::count_of(args, result.as_ref().ok())
                },
                outcome,
            },
            refused,
        );
        self.emit_status_soon();
        result
    }

    fn checked_call(
        self: &Arc<Self>,
        call: &Call<'_>,
        tool: &tools::Tool,
        args: &Value,
    ) -> Result<Value, McpError> {
        if !self.config().enabled || call.conn.is_closed() {
            return Err(disabled());
        }
        if !lock(&call.conn.rate).take(Instant::now()) {
            return Err(McpError::new("rate_limited", "Too many calls – slow down"));
        }
        if !args.is_object() {
            return Err(McpError::invalid("The arguments must be an object"));
        }
        self.ensure_paired(call)?;
        if call.cancel.load(Ordering::SeqCst) {
            return Err(McpError::new("cancelled", "The call was cancelled"));
        }
        (tool.run)(self, call, args)
    }

    /// Pairing (E4): a name in `mcp.clients` is paired; everyone else is asked about
    /// in the window, once per connection.
    fn ensure_paired(&self, call: &Call<'_>) -> Result<(), McpError> {
        let not_paired = || {
            McpError::new(
                "not_paired",
                "The user did not allow this client to use Files and Folders",
            )
        };
        let conn = call.conn;
        let decide = |conn: &Conn| -> Option<Result<(), McpError>> {
            match *lock(&conn.pairing) {
                Pairing::Allowed => Some(Ok(())),
                Pairing::Denied => Some(Err(not_paired())),
                Pairing::Unknown => None,
            }
        };
        if let Some(r) = decide(conn) {
            return r;
        }
        let name = conn.name();
        let listed = |me: &Self| -> bool {
            if me.config().clients.contains(&name) {
                conn.via_list.store(true, Ordering::SeqCst);
                *lock(&conn.pairing) = Pairing::Allowed;
                true
            } else {
                false
            }
        };
        // a client the user always allows never waits behind a question about another
        // one (review #9)
        if listed(self) {
            return Ok(());
        }
        // one question at a time; calls of the same connection wait for it
        let _one = lock(&self.pair_lock);
        if let Some(r) = decide(conn) {
            return r;
        }
        if listed(self) {
            return Ok(());
        }
        if !lock(&self.gate).may_ask(&name, Instant::now()) {
            return Err(not_paired());
        }
        let reply = self.bridge.ask(
            UiRequest::Pair {
                client: name.clone(),
            },
            limits::PAIR_WAIT,
            call.cancel,
        );
        let decision = match &reply {
            Ok(r) => r.decision.as_deref().unwrap_or("deny"),
            Err(_) => "none",
        };
        // a no, no answer, a busy window: the next question waits longer (review #3)
        lock(&self.gate).answered(&name, matches!(decision, "once" | "always"), Instant::now());
        match decision {
            "once" | "always" => {
                if decision == "always" {
                    // the frontend writes `mcp.clients`; known here at once
                    conn.via_list.store(true, Ordering::SeqCst);
                    let mut cfg = self.config.write().unwrap_or_else(|e| e.into_inner());
                    if !cfg.clients.contains(&name) && cfg.clients.len() < config::MAX_CLIENTS {
                        cfg.clients.push(name);
                    }
                }
                *lock(&conn.pairing) = Pairing::Allowed;
                self.emit_status();
                Ok(())
            }
            "deny" => {
                *lock(&conn.pairing) = Pairing::Denied;
                Err(not_paired())
            }
            // no answer (time limit, window busy or gone): not paired now; the gate
            // keeps the next question away for a while
            _ => Err(not_paired()),
        }
    }

    /// The name of the calling client and its connection.
    pub(crate) fn client_of(call: &Call<'_>) -> String {
        call.conn.name()
    }
}

pub(crate) fn disabled() -> McpError {
    McpError::new(
        "mcp_disabled",
        "Files and Folders is not running or MCP is switched off – start the app and enable MCP in Settings → MCP",
    )
}
