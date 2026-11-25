//! The mirror of the window (design 071): which tabs are open, where the cursor is and
//! what is marked. The panels live in the frontend; it reports them (debounced, only
//! while MCP is on). Rust keeps the last report – bounded, nothing else is trusted.
//! Keep in sync with `src/app/core/mcp/mcp.models.ts`.

use super::McpError;
use serde::{Deserialize, Serialize};

pub const MAX_TABS: usize = 64;
pub const MAX_MARKED: usize = 5000;
pub const MAX_STRING: usize = 4096;
pub const TAB_KINDS: [&str; 6] = ["folder", "search", "flat", "usage", "duplicates", "chart"];
pub const ENTRY_KINDS: [&str; 4] = ["file", "directory", "symlink", "unknown"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    #[default]
    Left,
    Right,
}

impl Side {
    pub fn other(self) -> Side {
        match self {
            Side::Left => Side::Right,
            Side::Right => Side::Left,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Side::Left => "left",
            Side::Right => "right",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UiEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub modified_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UiTab {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UiPanel {
    #[serde(default)]
    pub tabs: Vec<UiTab>,
    #[serde(default)]
    pub active_tab: usize,
    /// The folder shown (opaque; a virtual path inside an archive, `remote://…` on a
    /// server) – `None` for a result tab.
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub cursor: Option<UiEntry>,
    #[serde(default)]
    pub marked: Vec<UiEntry>,
    /// All marked entries (`marked` may be cut).
    #[serde(default)]
    pub marked_total: usize,
    /// The listing comes from the cache and was not checked yet (design 030).
    #[serde(default)]
    pub unchecked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UiState {
    #[serde(default)]
    pub active_side: Side,
    #[serde(default)]
    pub left: UiPanel,
    #[serde(default)]
    pub right: UiPanel,
}

impl UiState {
    pub fn panel(&self, side: Side) -> &UiPanel {
        match side {
            Side::Left => &self.left,
            Side::Right => &self.right,
        }
    }
}

fn too_big(what: &str) -> McpError {
    McpError::new(
        "limit_exceeded",
        format!("The reported state is too big: {what}"),
    )
}

fn check_entry(e: &UiEntry) -> Result<(), McpError> {
    if e.name.len() > MAX_STRING || e.path.len() > MAX_STRING {
        return Err(too_big("entry"));
    }
    if !ENTRY_KINDS.contains(&e.kind.as_str()) {
        return Err(McpError::new("invalid_arguments", "Unknown entry kind"));
    }
    Ok(())
}

fn check_panel(p: &UiPanel) -> Result<(), McpError> {
    if p.tabs.len() > MAX_TABS {
        return Err(too_big("tabs"));
    }
    if p.marked.len() > MAX_MARKED {
        return Err(too_big("marked entries"));
    }
    for t in &p.tabs {
        if t.id.len() > 128
            || t.title.len() > MAX_STRING
            || t.path.as_ref().is_some_and(|x| x.len() > MAX_STRING)
        {
            return Err(too_big("tab"));
        }
        if !TAB_KINDS.contains(&t.kind.as_str()) {
            return Err(McpError::new("invalid_arguments", "Unknown tab kind"));
        }
    }
    if p.folder.as_ref().is_some_and(|f| f.len() > MAX_STRING) {
        return Err(too_big("folder"));
    }
    if let Some(c) = &p.cursor {
        check_entry(c)?;
    }
    p.marked.iter().try_for_each(check_entry)
}

/// A report of the frontend is kept only within these limits.
pub fn check(state: &UiState) -> Result<(), McpError> {
    check_panel(&state.left)?;
    check_panel(&state.right)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn wire_format() {
        let s: UiState = serde_json::from_value(json!({
            "activeSide": "right",
            "left": {
                "tabs": [{ "id": "t1", "kind": "folder", "title": "docs", "path": "/home/u/docs" }],
                "activeTab": 0,
                "folder": "/home/u/docs",
                "cursor": { "name": "a.txt", "path": "/home/u/docs/a.txt", "kind": "file", "size": 3, "modifiedMs": 5 },
                "marked": [],
                "markedTotal": 0,
                "unchecked": true
            },
            "right": {}
        }))
        .unwrap();
        assert_eq!(s.active_side, Side::Right);
        assert!(s.left.unchecked);
        assert_eq!(s.left.cursor.as_ref().unwrap().size, Some(3));
        assert!(check(&s).is_ok());
        assert_eq!(Side::Left.other().as_str(), "right");
    }

    #[test]
    fn reports_beyond_the_limits_are_refused() {
        let entry = UiEntry {
            name: "a".into(),
            path: "/a".into(),
            kind: "file".into(),
            ..UiEntry::default()
        };
        let mut s = UiState::default();
        s.left.marked = vec![entry.clone(); MAX_MARKED + 1];
        assert_eq!(check(&s).unwrap_err().code, "limit_exceeded");
        let mut s = UiState::default();
        s.right.cursor = Some(UiEntry {
            kind: "socket".into(),
            ..entry.clone()
        });
        assert_eq!(check(&s).unwrap_err().code, "invalid_arguments");
        let mut s = UiState::default();
        s.right.tabs = vec![
            UiTab {
                id: "x".into(),
                kind: "folder".into(),
                title: "t".repeat(MAX_STRING + 1),
                path: None,
            };
            1
        ];
        assert_eq!(check(&s).unwrap_err().code, "limit_exceeded");
    }
}
