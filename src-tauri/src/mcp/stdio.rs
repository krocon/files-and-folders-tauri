//! The bridge (design 071 E1/E2): `files-and-folders-tauri --mcp`. An MCP client
//! (Claude Desktop, Claude Code) starts it and speaks MCP over stdin/stdout; the
//! bridge passes tool calls to the running app through the local socket. It creates
//! no window and starts no app. While the app does not answer it says so itself:
//! every call ends with `mcp_disabled`.
//!
//! The bridge is no boundary – any process of the user could speak to the socket
//! directly. Every check lives in the app.

use super::limits::MAX_LINE_BYTES;
use super::protocol::{self, Incoming};
use super::session::read_line;
use super::tools;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::{Arc, Mutex};

/// Opens a connection to the app: its reading and its writing half.
pub type Connect = Box<dyn Fn() -> Option<(Box<dyn Read + Send>, Box<dyn Write + Send>)> + Send>;

/// Id of the `initialize` the bridge sends to the app by itself.
const REPLAY_ID: &str = "fnf-bridge-initialize";

struct Upstream {
    generation: u64,
    writer: Option<Box<dyn Write + Send>>,
    /// Requests passed on and not answered yet: id key → (id, is a tool call).
    pending: HashMap<String, (Value, bool)>,
}

type Out<O> = Arc<Mutex<O>>;

fn write_line<O: Write>(out: &Out<O>, line: &str) {
    let mut o = out.lock().unwrap_or_else(|e| e.into_inner());
    let _ = o
        .write_all(line.as_bytes())
        .and_then(|_| o.write_all(b"\n"))
        .and_then(|_| o.flush());
}

fn lock(up: &Mutex<Upstream>) -> std::sync::MutexGuard<'_, Upstream> {
    up.lock().unwrap_or_else(|e| e.into_inner())
}

fn offline_answer(id: &Value, tool_call: bool) -> String {
    if tool_call {
        protocol::result(id, protocol::tool_result(Err(super::disabled())))
    } else {
        protocol::error(id, protocol::METHOD_NOT_FOUND, "Method not found")
    }
}

/// The app's end of the connection: passes its lines to the client until it closes;
/// then every request still open is answered with `mcp_disabled`.
fn pump<O: Write + Send + 'static>(
    reader: Box<dyn Read + Send>,
    generation: u64,
    up: Arc<Mutex<Upstream>>,
    out: Out<O>,
) {
    let mut reader = BufReader::new(reader);
    while let Ok(Some(line)) = read_line(&mut reader, MAX_LINE_BYTES * 8) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if v.get("method").is_none()
            && let Some(id) = v.get("id")
        {
            if id == REPLAY_ID {
                continue; // the answer to our own initialize
            }
            lock(&up).pending.remove(&protocol::id_key(id));
        }
        write_line(&out, &line);
    }
    let mut u = lock(&up);
    if u.generation != generation {
        return; // a newer connection took over
    }
    u.writer = None;
    for (_, (id, tool_call)) in u.pending.drain() {
        write_line(&out, &offline_answer(&id, tool_call));
    }
}

fn send_up(up: &Mutex<Upstream>, line: &str) -> bool {
    let mut u = lock(up);
    let Some(w) = u.writer.as_mut() else {
        return false;
    };
    let ok = w
        .write_all(line.as_bytes())
        .and_then(|_| w.write_all(b"\n"))
        .and_then(|_| w.flush())
        .is_ok();
    if !ok {
        u.writer = None;
    }
    ok
}

/// Connects to the app if there is no connection and introduces the client to it.
fn ensure_connected<O: Write + Send + 'static>(
    up: &Arc<Mutex<Upstream>>,
    out: &Out<O>,
    connect: &Connect,
    init: &Value,
) -> bool {
    if lock(up).writer.is_some() {
        return true;
    }
    let Some((reader, writer)) = connect() else {
        return false;
    };
    let generation = {
        let mut u = lock(up);
        u.generation += 1;
        u.writer = Some(writer);
        u.generation
    };
    let (up2, out2) = (up.clone(), out.clone());
    let spawned = std::thread::Builder::new()
        .name("fnf-mcp-bridge".into())
        .spawn(move || pump(reader, generation, up2, out2));
    if spawned.is_err() {
        lock(up).writer = None;
        return false;
    }
    let hello =
        json!({ "jsonrpc": "2.0", "id": REPLAY_ID, "method": "initialize", "params": init });
    send_up(up, &hello.to_string())
        && send_up(
            up,
            &protocol::notification("notifications/initialized", json!({})),
        )
}

/// Runs the bridge until `input` ends.
pub fn run<I: BufRead, O: Write + Send + 'static>(mut input: I, output: O, connect: Connect) {
    let out: Out<O> = Arc::new(Mutex::new(output));
    let up = Arc::new(Mutex::new(Upstream {
        generation: 0,
        writer: None,
        pending: HashMap::new(),
    }));
    let mut init = json!({});
    loop {
        let line = match read_line(&mut input, MAX_LINE_BYTES) {
            Ok(Some(l)) => l,
            Ok(None) => break,
            Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
                write_line(
                    &out,
                    &protocol::error(
                        &Value::Null,
                        protocol::INVALID_REQUEST,
                        "Message too long or not UTF-8",
                    ),
                );
                break;
            }
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        match protocol::parse(&line) {
            Incoming::Invalid(Some(answer)) => write_line(&out, &answer),
            Incoming::Invalid(None) => {}
            Incoming::Notification { method, .. } => {
                // the app got its own `initialized` from us
                if method != "notifications/initialized" {
                    send_up(&up, &line);
                }
            }
            Incoming::Request { id, method, params } => match method.as_str() {
                "initialize" => {
                    init = params.clone();
                    // connect now: the user sees the client in the app at once
                    ensure_connected(&up, &out, &connect, &init);
                    write_line(
                        &out,
                        &protocol::result(&id, protocol::initialize_result(&params, None)),
                    );
                }
                "ping" => write_line(&out, &protocol::result(&id, json!({}))),
                // the same table as the app's (the same binary)
                "tools/list" => write_line(&out, &protocol::result(&id, tools::list())),
                _ => {
                    let tool_call = method == "tools/call";
                    let connected = if tool_call {
                        ensure_connected(&up, &out, &connect, &init)
                    } else {
                        lock(&up).writer.is_some()
                    };
                    let key = protocol::id_key(&id);
                    let mut sent = false;
                    if connected {
                        lock(&up)
                            .pending
                            .insert(key.clone(), (id.clone(), tool_call));
                        sent = send_up(&up, &line);
                    }
                    // `pump` answers what is pending when the app goes away – never twice
                    if !sent && (!connected || lock(&up).pending.remove(&key).is_some()) {
                        write_line(&out, &offline_answer(&id, tool_call));
                    }
                }
            },
        }
    }
}

/// `--mcp`: stdin/stdout ↔ the socket of the running app. Returns the exit code.
pub fn main() -> i32 {
    let path = super::config::socket_path_for_bridge();
    let connect: Connect = Box::new(move || {
        #[cfg(unix)]
        {
            let stream = std::os::unix::net::UnixStream::connect(path.as_ref().ok()?).ok()?;
            let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(10)));
            let reader = stream.try_clone().ok()?;
            Some((
                Box::new(reader) as Box<dyn Read + Send>,
                Box::new(stream) as Box<dyn Write + Send>,
            ))
        }
        #[cfg(not(unix))]
        {
            let _ = &path;
            None
        }
    });
    let stdin = std::io::stdin();
    run(stdin.lock(), std::io::stdout(), connect);
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[derive(Clone, Default)]
    struct Sink(Arc<Mutex<Vec<u8>>>);

    impl Write for Sink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn lines(sink: &Sink) -> Vec<Value> {
        String::from_utf8(sink.0.lock().unwrap().clone())
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    fn input(messages: &[Value]) -> Cursor<Vec<u8>> {
        let text: String = messages.iter().map(|m| format!("{m}\n")).collect();
        Cursor::new(text.into_bytes())
    }

    /// The app is not running or MCP is off: the bridge answers by itself.
    #[test]
    fn without_the_app_every_call_says_mcp_disabled() {
        let sink = Sink::default();
        run(
            input(&[
                json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": { "protocolVersion": "2025-06-18", "clientInfo": { "name": "t" } } }),
                json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
                json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
                json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                    "params": { "name": "get_selection", "arguments": {} } }),
                json!({ "jsonrpc": "2.0", "id": 4, "method": "resources/list" }),
                json!({ "jsonrpc": "2.0", "id": 5, "method": "ping" }),
            ]),
            sink.clone(),
            Box::new(|| None),
        );
        let out = lines(&sink);
        assert_eq!(out.len(), 5);
        assert_eq!(out[0]["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(
            out[1]["result"]["tools"].as_array().unwrap().len(),
            tools::TOOLS.len()
        );
        assert_eq!(out[2]["id"], 3);
        assert_eq!(out[2]["result"]["isError"], true);
        assert_eq!(
            out[2]["result"]["structuredContent"]["error"]["code"],
            "mcp_disabled"
        );
        let text = out[2]["result"]["structuredContent"]["error"]["message"]
            .as_str()
            .unwrap();
        assert!(text.contains("not running") && text.contains("Settings"));
        assert_eq!(out[3]["error"]["code"], protocol::METHOD_NOT_FOUND);
        assert_eq!(out[4]["result"], json!({}));
    }

    #[test]
    fn rubbish_and_overlong_lines_do_not_crash_it() {
        let sink = Sink::default();
        let mut bytes = b"not json\n".to_vec();
        bytes.extend(vec![b'x'; MAX_LINE_BYTES + 10]);
        run(Cursor::new(bytes), sink.clone(), Box::new(|| None));
        let out = lines(&sink);
        assert_eq!(out[0]["error"]["code"], protocol::PARSE_ERROR);
        assert_eq!(out[1]["error"]["code"], protocol::INVALID_REQUEST);
    }
}
