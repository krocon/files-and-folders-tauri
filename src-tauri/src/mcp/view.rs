//! Tier 1 (design 071): tools that steer the view – visible, harmless, undone by the
//! user with one key. They change no file. Rust checks every path and tells the
//! window what to show; the window refuses while a dialog is open (`busy`).

use super::bridge::UiRequest;
use super::limits::UI_WAIT;
use super::read::{connected_remote, local_folder, side_of};
use super::state::{Side, UiState};
use super::tools::Args;
use super::{Call, McpError, McpHub};
use crate::search::SearchHit;
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;

fn ask(hub: &McpHub, call: &Call<'_>, request: UiRequest) -> Result<Value, McpError> {
    hub.bridge.ask(request, UI_WAIT, call.cancel)?;
    Ok(json!({ "ok": true }))
}

/// A folder a panel may be sent to: a server folder of an open connection, a folder
/// inside an archive the user has open, or an existing folder in the allowed roots.
fn folder_target(hub: &McpHub, raw: &str) -> Result<String, McpError> {
    if crate::remote::is_remote(raw.trim()) {
        return connected_remote(raw);
    }
    let path = local_folder(hub, raw)?;
    let is_dir = std::fs::metadata(&path)
        .map(|m| m.is_dir())
        .unwrap_or(false);
    // an archive (or a folder in it) that is open in a tab was accepted by `local_folder`
    if !is_dir && crate::archive::resolve(&path).is_none() {
        return Err(McpError::new("not_a_directory", "The path is not a folder"));
    }
    Ok(path.to_string_lossy().into_owned())
}

pub fn navigate(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("navigate", args)?;
    let ui = hub.ui();
    let path = folder_target(hub, args.str("path")?)?;
    ask(
        hub,
        call,
        UiRequest::Navigate {
            side: side_of(&args, &ui, ui.active_side),
            path,
        },
    )
}

pub fn open_tab(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("open_tab", args)?;
    let ui = hub.ui();
    let path = folder_target(hub, args.str("path")?)?;
    let title = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    ask(
        hub,
        call,
        UiRequest::OpenTab {
            side: side_of(&args, &ui, ui.active_side),
            path,
            title,
            activate: args.bool("activate", true),
        },
    )
}

/// An entry of the folder panel `side` shows – nothing else can get the cursor or a mark.
fn in_panel(hub: &McpHub, ui: &UiState, side: Side, raw: &str) -> Result<String, McpError> {
    let not_here = || {
        McpError::new(
            "not_found",
            "The entry is not in the folder this panel shows",
        )
    };
    let folder = ui.panel(side).folder.as_deref().ok_or_else(|| {
        McpError::new(
            "out_of_scope",
            "This panel shows a result list, not a folder",
        )
    })?;
    if crate::remote::is_remote(folder) {
        connected_remote(folder)?;
        let entry = crate::remote::RemotePath::parse(raw.trim())?;
        let parent = entry.parent().map(|p| p.to_string());
        let shown = crate::remote::RemotePath::parse(folder)?.to_string();
        return if parent.as_deref() == Some(shown.as_str()) {
            Ok(entry.to_string())
        } else {
            Err(not_here())
        };
    }
    let path = hub.scope().check(raw)?;
    if path.parent() != Some(Path::new(folder)) {
        return Err(not_here());
    }
    Ok(path.to_string_lossy().into_owned())
}

pub fn set_cursor(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("set_cursor", args)?;
    let ui = hub.ui();
    let side = side_of(&args, &ui, ui.active_side);
    let path = in_panel(hub, &ui, side, args.str("path")?)?;
    ask(hub, call, UiRequest::SetCursor { side, path })
}

pub fn mark(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("mark", args)?;
    let ui = hub.ui();
    let side = side_of(&args, &ui, ui.active_side);
    let paths = args
        .strings("paths")
        .into_iter()
        .map(|raw| in_panel(hub, &ui, side, raw))
        .collect::<Result<Vec<_>, _>>()?;
    let mode = args.str("mode")?.to_string();
    ask(hub, call, UiRequest::Mark { side, paths, mode })
}

pub fn quick_view(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("quick_view", args)?;
    let ui = hub.ui();
    let side = ui.active_side;
    let path = in_panel(hub, &ui, side, args.str("path")?)?;
    ask(hub, call, UiRequest::QuickView { side, path })
}

/// A hit for a result tab from a path: described by Rust like a search would.
pub(crate) fn hit_for(path: &Path) -> Option<SearchHit> {
    let entry = crate::listing::stat_entry(path)?;
    let dir = crate::paths::parent_of(path)?;
    Some(SearchHit {
        entry,
        parent_names: crate::paths::parent_names(&dir),
        dir: dir.to_string_lossy().into_owned(),
        rel_dir: String::new(),
        group: None,
        order: None,
        same_as: None,
        links: None,
        width: None,
        height: None,
        pages: None,
        distance: None,
    })
}

pub fn show_results(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("show_results", args)?;
    let ui = hub.ui();
    let scope = hub.scope();
    let mut hits = Vec::new();
    let mut missing = 0usize;
    let mut seen = std::collections::HashSet::new();
    for raw in args.strings("paths") {
        let path = scope.check(raw)?;
        if !seen.insert(path.clone()) {
            continue;
        }
        match hit_for(&path) {
            Some(h) => hits.push(h),
            None => missing += 1,
        }
    }
    if hits.is_empty() {
        return Err(McpError::new("not_found", "None of the paths exists"));
    }
    let roots = hits
        .first()
        .map(|h| vec![h.dir.clone()])
        .unwrap_or_default();
    let shown = hits.len();
    hub.bridge.ask(
        UiRequest::ShowResults {
            side: side_of(&args, &ui, ui.active_side),
            title: args.str("title")?.to_string(),
            hits,
            roots,
        },
        UI_WAIT,
        call.cancel,
    )?;
    Ok(json!({ "ok": true, "shown": shown, "missing": missing }))
}

pub fn cancel_job(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("cancel_job", args)?;
    let id = args.str("id")?;
    // only a job this client started or proposed – never one of the user
    if hub.tap.owner(id).as_deref() != Some(McpHub::client_of(call).as_str()) {
        return Err(McpError::new(
            "not_found",
            "No job of this client has this id",
        ));
    }
    hub.deps.jobs.cancel(id);
    Ok(json!({ "ok": true }))
}
