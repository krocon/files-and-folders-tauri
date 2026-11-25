// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // the MCP bridge (design 071 E1): stdin/stdout ↔ the running app – no window, no app start
    if std::env::args().nth(1).as_deref() == Some("--mcp") {
        std::process::exit(fnf_lib::mcp::stdio::main());
    }
    fnf_lib::run();
}
