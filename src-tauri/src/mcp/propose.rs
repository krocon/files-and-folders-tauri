//! Tier 2 (design 071): proposals. A tool here changes nothing – it checks its
//! arguments, describes the entries and asks the window to open the **normal** dialog,
//! pre-filled. The user decides there; the window starts the job the usual way
//! (`OpsStore` → `JobManager::start` with all its checks). The tool answers when the
//! dialog closed.

use super::bridge::{RenamePair, UiReply, UiRequest};
use super::limits::PROPOSAL_WAIT;
use super::tools::Args;
use super::{Call, McpError, McpHub};
use crate::model::DirEntryDto;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Existing local entries in the allowed roots (not inside an archive, not on a
/// server), described like a listing does. Duplicates are refused.
fn entries_of(hub: &McpHub, raws: &[&str]) -> Result<(Vec<DirEntryDto>, Vec<PathBuf>), McpError> {
    let scope = hub.scope();
    let mut paths = Vec::with_capacity(raws.len());
    let mut seen = std::collections::HashSet::new();
    for raw in raws {
        let path = scope.check(raw)?;
        if !seen.insert(path.clone()) {
            return Err(McpError::invalid("A path is named twice"));
        }
        paths.push(path);
    }
    let mut entries = Vec::with_capacity(paths.len());
    for p in &paths {
        // `stat_entry` does not follow links: a link is proposed as the link it is
        match crate::listing::stat_entry(p) {
            Some(e) => entries.push(e),
            None => {
                return Err(McpError::new(
                    "not_found",
                    "One of the paths does not exist",
                ));
            }
        }
    }
    Ok((entries, paths))
}

/// The folder all `paths` lie in, or "" if they come from several folders.
fn common_dir(paths: &[PathBuf]) -> String {
    let first = paths.first().and_then(|p| p.parent());
    match first {
        Some(dir) if paths.iter().all(|p| p.parent() == Some(dir)) => {
            dir.to_string_lossy().into_owned()
        }
        _ => String::new(),
    }
}

/// Opens the dialog and waits for the user. A confirmed proposal's job belongs to the
/// client (it may watch and cancel it).
fn propose(hub: &McpHub, call: &Call<'_>, request: UiRequest) -> Result<Value, McpError> {
    let client = McpHub::client_of(call);
    let reply: UiReply = hub.bridge.ask(request, PROPOSAL_WAIT, call.cancel)?;
    match reply.outcome.as_deref() {
        Some("confirmed") => {
            let job = reply.job_id.filter(|j| j.len() <= 32);
            if let Some(id) = &job {
                hub.tap.adopt(id, &client);
            }
            Ok(json!({ "outcome": "confirmed", "jobId": job }))
        }
        _ => Ok(json!({ "outcome": "cancelled" })),
    }
}

fn transfer(
    hub: &Arc<McpHub>,
    call: &Call<'_>,
    tool: &str,
    args: &Value,
) -> Result<Value, McpError> {
    let args = Args::checked(tool, args)?;
    let (entries, paths) = entries_of(hub, &args.strings("sources"))?;
    let target = hub.scope().check(args.str("target")?)?;
    if !std::fs::metadata(&target)
        .map(|m| m.is_dir())
        .unwrap_or(false)
    {
        return Err(McpError::new(
            "not_a_directory",
            "The target is not an existing folder",
        ));
    }
    let client = McpHub::client_of(call);
    let source_dir = common_dir(&paths);
    let target = target.to_string_lossy().into_owned();
    let request = if tool == "propose_move" {
        UiRequest::ProposeMove {
            client,
            entries,
            source_dir,
            target,
        }
    } else {
        UiRequest::ProposeCopy {
            client,
            entries,
            source_dir,
            target,
        }
    };
    propose(hub, call, request)
}

pub fn copy(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    transfer(hub, call, "propose_copy", args)
}

pub fn move_(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    transfer(hub, call, "propose_move", args)
}

pub fn delete(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("propose_delete", args)?;
    let (entries, paths) = entries_of(hub, &args.strings("paths"))?;
    propose(
        hub,
        call,
        UiRequest::ProposeDelete {
            client: McpHub::client_of(call),
            entries,
            source_dir: common_dir(&paths),
        },
    )
}

pub fn rename(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("propose_rename", args)?;
    let raw_pairs = args.0["pairs"].as_array().cloned().unwrap_or_default();
    let raws: Vec<&str> = raw_pairs
        .iter()
        .filter_map(|p| p["path"].as_str())
        .collect();
    let (entries, paths) = entries_of(hub, &raws)?;
    let mut pairs = Vec::with_capacity(entries.len());
    for ((entry, path), raw) in entries.into_iter().zip(&paths).zip(&raw_pairs) {
        let new_name = raw["newName"].as_str().unwrap_or_default().to_string();
        // a name, never a path: the entry stays in its folder (the dialog's check and
        // the job check again)
        crate::paths::validate_name(&new_name)?;
        if Path::new(&new_name).components().count() != 1 {
            return Err(McpError::new(
                "invalid_name",
                "A new name must not contain a path",
            ));
        }
        let dir = path.parent().unwrap_or(Path::new(""));
        pairs.push(RenamePair {
            entry,
            new_name,
            parent_names: crate::paths::parent_names(dir),
        });
    }
    propose(
        hub,
        call,
        UiRequest::ProposeRename {
            client: McpHub::client_of(call),
            folder: common_dir(&paths),
            pairs,
        },
    )
}

pub fn mkdir(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("propose_mkdir", args)?;
    let parent = hub.scope().check(args.str("parent")?)?;
    if !std::fs::metadata(&parent)
        .map(|m| m.is_dir())
        .unwrap_or(false)
    {
        return Err(McpError::new(
            "not_a_directory",
            "The parent is not an existing folder",
        ));
    }
    let mut names = Vec::new();
    for name in args.strings("names") {
        crate::paths::validate_name(name)?;
        if Path::new(name).components().count() != 1 {
            return Err(McpError::new(
                "invalid_name",
                "A folder name must not contain a path",
            ));
        }
        if names.iter().any(|n: &String| n == name) {
            return Err(McpError::invalid("A name is given twice"));
        }
        names.push(name.to_string());
    }
    propose(
        hub,
        call,
        UiRequest::ProposeMkdir {
            client: McpHub::client_of(call),
            parent_names: crate::paths::parent_names(&parent),
            parent: parent.to_string_lossy().into_owned(),
            names,
        },
    )
}
