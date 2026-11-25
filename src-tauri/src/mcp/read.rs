//! Tier 0 (design 071): tools that read – the mirror of the window, listings,
//! properties and the engines as reading jobs. Every path goes through
//! [`Scope::check`](super::scope::Scope::check) first; results are filtered by it too.

use super::jobs::{Collector, Waited};
use super::limits::{DEFAULT_TEXT_BYTES, FIND_WAIT, JOB_WAIT, MAX_JOBS, MAX_TEXT_BYTES};
use super::state::{Side, UiEntry, UiPanel, UiState};
use super::tools::Args;
use super::{Call, McpError, McpHub};
use crate::jobs::{JobSpec, JobState};
use crate::model::DirEntryDto;
use crate::search::SearchHit;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, mpsc};
use std::time::Instant;

// ---- shared helpers ----

pub(crate) fn side_of(args: &Args<'_>, ui: &UiState, default: Side) -> Side {
    match args.opt_str("side") {
        Some("left") => Side::Left,
        Some("right") => Side::Right,
        Some("active") => ui.active_side,
        Some("other") => ui.active_side.other(),
        _ => default,
    }
}

fn not_connected() -> McpError {
    McpError::new(
        "not_connected",
        "The user is not connected to this server – only the user can connect",
    )
}

/// A server path: usable only while the user's connection to its profile is open.
/// Never connects, never asks for a password (rule 7).
pub(crate) fn connected_remote(raw: &str) -> Result<String, McpError> {
    let path = crate::remote::RemotePath::parse(raw.trim())?;
    let open = crate::remote::hub().ok().is_some_and(|h| {
        h.states().get(path.profile()) == Some(&crate::remote::ConnState::Connected)
    });
    if !open {
        return Err(not_connected());
    }
    Ok(path.to_string())
}

/// The archive file a path leads into, if it does (a virtual path or the archive itself).
fn archive_of(path: &Path) -> Option<PathBuf> {
    crate::archive::resolve(path).map(|(archive, _)| archive)
}

/// An archive is listed and entered only when the user has it open in a tab (E6).
pub(crate) fn archive_open_in_tab(hub: &McpHub, archive: &Path) -> bool {
    let ui = hub.ui();
    let shown = |p: &UiPanel| -> bool {
        p.folder
            .iter()
            .chain(p.tabs.iter().filter_map(|t| t.path.as_ref()))
            .filter(|raw| !crate::remote::is_remote(raw))
            .any(|raw| archive_of(Path::new(raw)).as_deref() == Some(archive))
    };
    shown(&ui.left) || shown(&ui.right)
}

/// A local folder path a tool may list or show: in scope, and if it leads into an
/// archive, one that is open in a tab.
pub(crate) fn local_folder(hub: &McpHub, raw: &str) -> Result<PathBuf, McpError> {
    let path = hub.scope().check(raw)?;
    if let Some(archive) = archive_of(&path)
        && !archive_open_in_tab(hub, &archive)
    {
        return Err(McpError::new(
            "out_of_scope",
            "An archive can be used only while the user has it open in a tab",
        ));
    }
    Ok(path)
}

/// Whether a location of the window (a tab, a panel's folder) may be told to a client.
fn visible(hub: &McpHub, raw: &str) -> bool {
    if crate::remote::is_remote(raw) {
        return connected_remote(raw).is_ok();
    }
    hub.scope().check(raw).is_ok()
}

pub(crate) fn entry_json(e: &DirEntryDto) -> Value {
    json!({
        "name": e.name,
        "path": e.path,
        "kind": e.kind,
        "size": e.size,
        "modifiedMs": e.modified_ms,
        "hidden": e.hidden,
    })
}

fn ui_entry_json(e: &UiEntry) -> Value {
    json!({ "name": e.name, "path": e.path, "kind": e.kind, "size": e.size, "modifiedMs": e.modified_ms })
}

fn hit_json(h: &SearchHit) -> Value {
    let mut v = entry_json(&h.entry);
    v["dir"] = json!(h.dir);
    v
}

// ---- the window ----

pub fn get_workspace(hub: &Arc<McpHub>, _call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    Args::checked("get_workspace", args)?;
    let ui = hub.ui();
    let panel = |p: &UiPanel| -> Value {
        let tabs: Vec<Value> = p
            .tabs
            .iter()
            .map(|t| {
                // a tab outside the allowed folders is there, but not described
                let shown = t.path.as_deref().is_none_or(|raw| visible(hub, raw));
                if shown {
                    json!({ "id": t.id, "kind": t.kind, "title": t.title, "path": t.path })
                } else {
                    json!({ "id": t.id, "kind": t.kind, "title": null, "path": null, "outOfScope": true })
                }
            })
            .collect();
        json!({ "activeTab": p.active_tab, "tabs": tabs })
    };
    Ok(json!({
        "activeSide": ui.active_side.as_str(),
        "left": panel(&ui.left),
        "right": panel(&ui.right),
    }))
}

pub fn get_selection(hub: &Arc<McpHub>, _call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("get_selection", args)?;
    let ui = hub.ui();
    let side = side_of(&args, &ui, ui.active_side);
    let p = ui.panel(side);
    let limit = args.limit();
    let mut withheld = 0usize;
    let (cursor, marked): (Option<&UiEntry>, Vec<&UiEntry>) = match &p.folder {
        Some(folder) => {
            if !visible(hub, folder) {
                return Err(McpError::new(
                    "out_of_scope",
                    "This panel shows a folder outside the folders allowed for MCP",
                ));
            }
            (p.cursor.as_ref(), p.marked.iter().collect())
        }
        // a result tab mixes folders: every entry is judged by itself
        None => {
            let ok = |e: &&UiEntry| visible(hub, &e.path);
            let marked: Vec<&UiEntry> = p.marked.iter().filter(ok).collect();
            withheld = p.marked.len() - marked.len();
            (p.cursor.as_ref().filter(ok), marked)
        }
    };
    let tab = p.tabs.get(p.active_tab);
    Ok(json!({
        "side": side.as_str(),
        "folder": p.folder,
        "tabKind": tab.map(|t| t.kind.as_str()),
        "cursor": cursor.map(ui_entry_json),
        "marked": marked.iter().take(limit).map(|e| ui_entry_json(e)).collect::<Vec<_>>(),
        "markedTotal": p.marked_total.max(p.marked.len()),
        "truncated": marked.len() > limit || p.marked_total > p.marked.len(),
        "withheld": withheld,
        // the listing came from the cache and was not checked against the drive yet
        "unchecked": p.unchecked,
    }))
}

// ---- listings and properties ----

pub fn list_directory(
    hub: &Arc<McpHub>,
    _call: &Call<'_>,
    args: &Value,
) -> Result<Value, McpError> {
    let args = Args::checked("list_directory", args)?;
    let raw = args.str("path")?;
    let listing = if crate::remote::is_remote(raw.trim()) {
        let checked = connected_remote(raw)?;
        crate::remote::hub()?.list_directory(&checked)?
    } else {
        let path = local_folder(hub, raw)?;
        crate::archive::list_directory_or_archive(&path)?
    };
    let show_hidden = args.bool("showHidden", false);
    let offset = args.u64("offset").unwrap_or(0) as usize;
    let limit = args.limit();
    let all: Vec<&DirEntryDto> = listing
        .entries
        .iter()
        .filter(|e| show_hidden || !e.hidden)
        .collect();
    let page: Vec<Value> = all
        .iter()
        .skip(offset)
        .take(limit)
        .map(|e| entry_json(e))
        .collect();
    let parent = listing.parent.as_deref().filter(|p| visible(hub, p));
    Ok(json!({
        "path": listing.path,
        "parent": parent,
        "total": all.len(),
        "offset": offset,
        "truncated": offset + page.len() < all.len(),
        "unreadableEntries": listing.unreadable_entries,
        "inArchive": listing.archive.is_some(),
        "entries": page,
    }))
}

pub fn get_properties(
    hub: &Arc<McpHub>,
    _call: &Call<'_>,
    args: &Value,
) -> Result<Value, McpError> {
    let args = Args::checked("get_properties", args)?;
    let scope = hub.scope();
    let items: Vec<Value> = args
        .strings("paths")
        .into_iter()
        .map(|raw| {
            let one = scope
                .check(raw)
                .and_then(|p| crate::properties::properties(&p).map_err(McpError::from));
            match one {
                Ok(p) => json!({
                    "path": p.path,
                    "name": p.name,
                    "kind": p.kind,
                    "targetKind": p.target_kind,
                    "linkTarget": p.link_target,
                    "size": p.size,
                    "createdMs": p.created_ms,
                    "modifiedMs": p.modified_ms,
                    "accessedMs": p.accessed_ms,
                    "readonly": p.readonly,
                    "format": p.format.map(|f| f.label),
                    "unix": p.unix,
                    "windows": p.windows,
                }),
                Err(e) => json!({ "path": raw, "error": e.code }),
            }
        })
        .collect();
    Ok(json!({ "entries": items }))
}

// ---- jobs ----

/// Hits a search looks for beyond `limit`: some may be withheld (folders of the app).
const SEARCH_MARGIN: usize = 100;

fn start_job(
    hub: &Arc<McpHub>,
    call: &Call<'_>,
    spec: JobSpec,
    collector: Arc<Collector>,
) -> Result<Value, McpError> {
    // counted and started under one lock (review #8)
    let id = hub
        .tap
        .start(&hub.deps.jobs, spec, collector.clone(), MAX_JOBS)?;
    let waited = super::jobs::wait(
        &hub.deps.jobs,
        &id,
        &collector,
        JOB_WAIT,
        call.cancel,
        |p| (call.progress)(p.items_done, (p.items_total > 0).then_some(p.items_total)),
    );
    if waited == Waited::Cancelled {
        return Err(McpError::new("cancelled", "The call was cancelled"));
    }
    Ok(job_answer(hub, &id, &collector))
}

fn state_name(state: JobState, stopped_at_limit: bool) -> &'static str {
    match state {
        JobState::Done => "done",
        JobState::DoneWithErrors => "doneWithErrors",
        JobState::Failed => "failed",
        // we stopped it because the answer was full: that is a complete answer
        JobState::Cancelled if stopped_at_limit => "done",
        JobState::Cancelled => "cancelled",
        _ => "running",
    }
}

/// The answer for a job of a client: its state and what it found (so far).
fn job_answer(hub: &McpHub, id: &str, c: &Collector) -> Value {
    if let Some(v) = c.result.lock().unwrap_or_else(|e| e.into_inner()).clone() {
        return v;
    }
    let scope = hub.scope();
    // a job that looked into files (content search, hashes, byte comparison) tells
    // nothing about files whose content is closed (review #1) – one rule: the scope's
    let by_content = c.shape["content"].as_bool().unwrap_or(false);
    let tellable = |raw: &str| -> bool {
        let p = Path::new(raw);
        scope.allows(p) && (!by_content || scope.content_allowed(p))
    };
    let d = c.lock();
    let finished = d.finished.as_ref();
    let status = finished.map_or("running", |(s, _)| state_name(*s, d.truncated));
    let mut out = json!({ "status": status, "jobId": id, "kind": c.kind });
    if let Some((_, summary)) = finished
        && let Some(e) = &summary.error
    {
        out["error"] = json!(super::fs_code(e));
    }
    if finished.is_none() {
        out["progress"] = json!({
            "itemsDone": d.progress.items_done, "itemsTotal": d.progress.items_total,
            "bytesDone": d.progress.bytes_done, "bytesTotal": d.progress.bytes_total,
        });
    }
    match c.kind {
        "search" => {
            // the job may find entries the client must not see (folders of the app): it
            // looks for some more than asked, the answer keeps `limit` of the allowed ones
            let limit = c.shape["limit"].as_u64().unwrap_or(c.limit as u64) as usize;
            let allowed: Vec<&SearchHit> =
                d.hits.iter().filter(|h| tellable(&h.entry.path)).collect();
            let stats = d.search_stats.clone().unwrap_or_default();
            out["hits"] = json!(
                allowed
                    .iter()
                    .take(limit)
                    .map(|h| hit_json(h))
                    .collect::<Vec<_>>()
            );
            out["truncated"] = json!(allowed.len() > limit || d.truncated || stats.truncated);
            out["dirsScanned"] = json!(stats.dirs_scanned);
            out["filesScanned"] = json!(stats.files_scanned);
            out["unreadable"] = json!(stats.unreadable);
        }
        "duplicates" => {
            let mut groups: Vec<(u32, Vec<&SearchHit>)> = Vec::new();
            for h in d.hits.iter().filter(|h| tellable(&h.entry.path)) {
                let g = h.group.unwrap_or(0);
                match groups.iter_mut().find(|(n, _)| *n == g) {
                    Some((_, list)) => list.push(h),
                    None => groups.push((g, vec![h])),
                }
            }
            let groups: Vec<Value> = groups
                .iter()
                .filter(|(_, files)| files.len() > 1)
                .map(|(g, files)| {
                    let size = files[0].entry.size.unwrap_or(0);
                    // names of one file (hard links) are one unit, not copies
                    let units = files.iter().filter(|f| f.same_as.is_none()).count().max(1) as u64;
                    json!({
                        "group": g,
                        "size": size,
                        "wastedBytes": size.saturating_mul(units - 1),
                        "files": files.iter().map(|f| {
                            let mut v = hit_json(f);
                            if let Some(s) = &f.same_as { v["hardLinkOf"] = json!(s); }
                            if let Some(n) = f.distance { v["distance"] = json!(n); }
                            v
                        }).collect::<Vec<_>>(),
                    })
                })
                .collect();
            out["groups"] = json!(groups);
            out["truncated"] = json!(d.truncated);
        }
        "compare" => {
            let include_equal = c.shape["includeEqual"].as_bool().unwrap_or(false);
            let side = |s: &Option<crate::compare::CompareSide>| {
                s.as_ref().map(|x| json!({ "path": x.path, "kind": x.kind, "size": x.size, "modifiedMs": x.modified_ms }))
            };
            let rows: Vec<Value> = d
                .rows
                .iter()
                .filter(|r| include_equal || r.status != crate::compare::CompareStatus::Equal)
                // nothing about entries a client must not see (folders of the app, review #5)
                .filter(|r| tellable(&r.left_path) && tellable(&r.right_path))
                .map(|r| json!({ "rel": r.rel, "status": r.status, "left": side(&r.left), "right": side(&r.right) }))
                .collect();
            let stats = d.compare_stats.clone().unwrap_or_default();
            out["rows"] = json!(rows);
            out["truncated"] = json!(d.truncated || stats.truncated);
            out["files"] = json!(stats.files);
            out["dirs"] = json!(stats.dirs);
            out["differences"] = json!(stats.differences);
            out["unreadable"] = json!(stats.unreadable);
        }
        "checksum" => {
            if let Some((_, summary)) = finished
                && let Some(sums) = &summary.checksums
            {
                out["algorithm"] = json!(sums.algo);
                out["digests"] = json!(
                    sums.digests
                        .iter()
                        .map(|x| json!({ "path": x.path, "hex": x.hex }))
                        .collect::<Vec<_>>()
                );
                out["failed"] = json!(summary.items_failed);
            }
        }
        "diskUsage" if finished.is_some() => {
            {
                drop(d);
                let top = c.shape["top"].as_u64().unwrap_or(20) as usize;
                if let Some(usage) = usage_result(hub, id, top) {
                    for (k, v) in usage.as_object().into_iter().flatten() {
                        out[k] = v.clone();
                    }
                }
                // the tree is not kept for the client: the scan slots belong to the tabs
                hub.deps.jobs.disk_usage().release(id);
                *c.result.lock().unwrap_or_else(|e| e.into_inner()) = Some(out.clone());
                return out;
            }
        }
        _ => {}
    }
    out
}

fn usage_result(hub: &McpHub, id: &str, top: usize) -> Option<Value> {
    let scan = hub.deps.jobs.disk_usage().get(id).ok()?;
    let view = scan.view(None, 1, 0.0, top).ok()?;
    let node = serde_json::to_value(&view.node).ok()?;
    let pick = |n: &Value| {
        json!({
            "name": n["name"], "path": n["path"], "kind": n["kind"],
            "allocated": n["allocated"], "logical": n["logical"],
            "files": n["files"], "dirs": n["dirs"],
        })
    };
    // the folders of the app are not described (review #5); the sums of the folders
    // above still count them
    let scope = hub.scope();
    let allowed = |path: Option<&str>| path.is_none_or(|p| scope.allows(Path::new(p)));
    let children: Vec<Value> = node["children"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|n| allowed(n["path"].as_str()))
                .map(pick)
                .collect()
        })
        .unwrap_or_default();
    let largest: Vec<Value> = scan
        .read()
        .largest(
            crate::disk_usage::tree::TOP,
            crate::disk_usage::MAX_LARGEST,
        )
        .iter()
        .filter(|f| allowed(Some(&f.path)))
        .take(top)
        .map(|f| json!({ "name": f.name, "path": f.path, "allocated": f.allocated, "logical": f.logical }))
        .collect();
    Some(json!({
        "total": pick(&node),
        "complete": view.complete,
        "unreadable": node["unreadable"],
        "children": children,
        "largestFiles": largest,
    }))
}

fn checked_strings(hub: &McpHub, raws: &[&str]) -> Result<Vec<String>, McpError> {
    let scope = hub.scope();
    raws.iter()
        .map(|raw| scope.check(raw).map(|p| p.to_string_lossy().into_owned()))
        .collect()
}

fn from_json<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, McpError> {
    serde_json::from_value(v).map_err(|_| McpError::invalid("The arguments do not fit"))
}

pub fn search(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("search", args)?;
    let roots = checked_strings(hub, &args.strings("roots"))?;
    let excludes: Vec<String> = args
        .strings("excludes")
        .iter()
        .map(|s| s.to_string())
        .collect();
    let content = match args.opt_str("content").filter(|t| !t.is_empty()) {
        Some(text) => {
            if !hub.config().allow_content {
                return Err(content_off());
            }
            // a content search never starts in a place whose contents are closed; what it
            // finds elsewhere is filtered by the same rule (`job_answer`, review #1)
            for root in &roots {
                hub.scope().check_content(root)?;
            }
            json!({ "text": text, "caseSensitive": args.bool("contentCaseSensitive", false) })
        }
        None => Value::Null,
    };
    let limit = args.limit();
    let with_content = !content.is_null();
    let criteria: crate::search::SearchCriteria = from_json(json!({
        "roots": roots,
        "name": args.opt_str("name").unwrap_or(""),
        "nameMode": args.opt_str("nameMode").unwrap_or("glob"),
        "caseSensitive": args.bool("caseSensitive", false),
        "wholeName": args.bool("wholeName", true),
        "kinds": { "files": args.bool("files", true), "dirs": args.bool("dirs", true), "links": true },
        "minSize": args.u64("minSize"),
        "maxSize": args.u64("maxSize"),
        "modifiedFromMs": args.i64("modifiedFromMs"),
        "modifiedToMs": args.i64("modifiedToMs"),
        "includeHidden": args.bool("includeHidden", false),
        // links are never followed: a search stays where the roots physically are
        "followLinks": false,
        "maxDepth": args.u64("maxDepth"),
        "excludes": excludes,
        "content": content,
        "maxHits": limit + SEARCH_MARGIN,
    }))?;
    let label = if criteria.name.is_empty() {
        "*".to_string()
    } else {
        criteria.name.clone()
    };
    let search_roots = criteria.roots.clone();
    let collector = Collector::new(
        "search",
        &McpHub::client_of(call),
        call.conn.id,
        limit + SEARCH_MARGIN,
        json!({ "limit": limit, "content": with_content }),
    );
    let mut out = start_job(hub, call, JobSpec::Search { criteria }, collector.clone())?;
    if args.bool("showAsTab", false) && out["status"] == "done" {
        let ui = hub.ui();
        let scope = hub.scope();
        let hits: Vec<SearchHit> = collector
            .lock()
            .hits
            .iter()
            .filter(|h| {
                let p = Path::new(&h.entry.path);
                scope.allows(p) && (!with_content || scope.content_allowed(p))
            })
            .take(limit)
            .cloned()
            .collect();
        let shown = hub.bridge.ask(
            super::bridge::UiRequest::ShowResults {
                client: McpHub::client_of(call),
                side: side_of(&args, &ui, ui.active_side.other()),
                title: label.chars().take(100).collect(),
                hits,
                roots: search_roots,
            },
            super::limits::UI_WAIT,
            call.cancel,
        );
        out["shownAsTab"] = json!(shown.is_ok());
    }
    Ok(out)
}

pub fn find_duplicates(
    hub: &Arc<McpHub>,
    call: &Call<'_>,
    args: &Value,
) -> Result<Value, McpError> {
    let args = Args::checked("find_duplicates", args)?;
    let roots = checked_strings(hub, &args.strings("paths"))?;
    let mode = match args.opt_str("mode") {
        Some("similarImages") => "similarImages",
        _ => "exact",
    };
    let criteria: crate::duplicates::DuplicateCriteria = from_json(json!({
        "roots": roots,
        "mode": mode,
        "compare": "content",
        "minSize": args.u64("minSize"),
        "includeHidden": false,
    }))?;
    // equal content is a statement about the content: the rule for contents applies
    let collector = Collector::new(
        "duplicates",
        &McpHub::client_of(call),
        call.conn.id,
        args.limit(),
        json!({ "content": true }),
    );
    start_job(hub, call, JobSpec::Duplicates { criteria }, collector)
}

pub fn compare_folders(
    hub: &Arc<McpHub>,
    call: &Call<'_>,
    args: &Value,
) -> Result<Value, McpError> {
    let args = Args::checked("compare_folders", args)?;
    let sides = checked_strings(hub, &[args.str("left")?, args.str("right")?])?;
    for s in &sides {
        if !Path::new(s).is_dir() {
            return Err(McpError::new(
                "not_a_directory",
                "Both sides must be folders",
            ));
        }
    }
    let by = args.opt_str("by").unwrap_or("date");
    let limit = args.limit();
    let options: crate::compare::CompareOptions = from_json(json!({
        "recursive": args.bool("recursive", true),
        "content": by == "content",
        "ignoreDate": by != "date",
        "maxRows": limit,
    }))?;
    let shape = json!({
        "includeEqual": args.bool("includeEqual", false),
        // a byte comparison says whether two files are equal
        "content": by == "content",
    });
    let collector = Collector::new(
        "compare",
        &McpHub::client_of(call),
        call.conn.id,
        limit,
        shape,
    );
    let spec = JobSpec::Compare {
        left: sides[0].clone(),
        right: sides[1].clone(),
        options,
    };
    start_job(hub, call, spec, collector)
}

pub fn checksum(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("checksum", args)?;
    let paths = checked_strings(hub, &args.strings("paths"))?;
    for p in &paths {
        // a digest is a function of the content: the same places are closed as for reading
        hub.scope().check_content(p).map_err(|_| {
            McpError::new(
                "content_not_allowed",
                "Files that usually hold credentials are never read over MCP",
            )
        })?;
        if !Path::new(p).is_file() {
            return Err(McpError::new(
                "not_a_file",
                "Checksums are computed for files",
            ));
        }
    }
    let base_dir = Path::new(&paths[0])
        .parent()
        .ok_or_else(|| McpError::new("invalid_path", "The file has no folder"))?
        .to_string_lossy()
        .into_owned();
    let algo: crate::checksum::Algo = from_json(json!(args.str("algorithm")?))?;
    let collector = Collector::new(
        "checksum",
        &McpHub::client_of(call),
        call.conn.id,
        paths.len(),
        Value::Null,
    );
    let spec = JobSpec::Checksum {
        paths,
        base_dir,
        algo,
        // only the digests in the answer – this tool never writes a file
        output: crate::jobs::checksum::ChecksumOutput::Show,
    };
    start_job(hub, call, spec, collector)
}

pub fn disk_usage(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("disk_usage", args)?;
    let root = checked_strings(hub, &[args.str("path")?])?;
    if !Path::new(&root[0]).is_dir() {
        return Err(McpError::new("not_a_directory", "The path is not a folder"));
    }
    // the kept scans belong to the user's tabs: never push one of them out
    if hub.deps.jobs.disk_usage().ids().len() >= crate::disk_usage::MAX_SCANS {
        return Err(McpError::new(
            "busy",
            "All disk usage scans are in use by tabs of the app – close one first",
        ));
    }
    let shape = json!({ "top": args.u64("top").unwrap_or(20) });
    let collector = Collector::new(
        "diskUsage",
        &McpHub::client_of(call),
        call.conn.id,
        0,
        shape,
    );
    let spec = JobSpec::DiskUsage {
        roots: root,
        volume: false,
        rescan: None,
        options: Default::default(),
    };
    start_job(hub, call, spec, collector)
}

pub fn list_jobs(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    Args::checked("list_jobs", args)?;
    let all = hub.deps.jobs.list();
    let jobs: Vec<Value> = hub
        .tap
        .owned_by(call.conn.id)
        .iter()
        .filter_map(|id| job_state(hub, &all, id))
        .collect();
    Ok(json!({ "jobs": jobs }))
}

/// State and progress of a job – codes and numbers, no paths.
fn job_state(hub: &McpHub, all: &[crate::jobs::JobInfo], id: &str) -> Option<Value> {
    if let Some(c) = hub.tap.collector(id) {
        let d = c.lock();
        let status = d
            .finished
            .as_ref()
            .map_or("running", |(s, _)| state_name(*s, d.truncated));
        return Some(json!({ "jobId": id, "kind": c.kind, "status": status }));
    }
    let info = all.iter().find(|j| j.id == id)?;
    let status = if info.state.is_finished() {
        state_name(info.state, false)
    } else if info.state == JobState::WaitingForDecision {
        // the user answers conflicts in the window – there is no tool for that
        "waitingForUser"
    } else {
        "running"
    };
    let mut out = json!({
        "jobId": id,
        "kind": info.spec.kind(),
        "status": status,
        "progress": {
            "itemsDone": info.progress.items_done, "itemsTotal": info.progress.items_total,
            "bytesDone": info.progress.bytes_done, "bytesTotal": info.progress.bytes_total,
        },
    });
    if let Some(s) = &info.summary {
        out["itemsDone"] = json!(s.items_done);
        out["itemsSkipped"] = json!(s.items_skipped);
        out["itemsFailed"] = json!(s.items_failed);
        if let Some(e) = &s.error {
            out["error"] = json!(super::fs_code(e));
        }
    }
    Some(out)
}

fn not_my_job() -> McpError {
    McpError::new("not_found", "No job of this client has this id")
}

pub fn get_job(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("get_job", args)?;
    let id = args.str("id")?;
    if hub.tap.owner(id) != Some(call.conn.id) {
        return Err(not_my_job());
    }
    if let Some(c) = hub.tap.collector(id) {
        return Ok(job_answer(hub, id, &c));
    }
    job_state(hub, &hub.deps.jobs.list(), id).ok_or_else(not_my_job)
}

// ---- names and contents ----

pub fn find_files(hub: &Arc<McpHub>, call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("find_files", args)?;
    let limit = args.limit();
    let palette = crate::palette::hub()
        .ok_or_else(|| McpError::new("not_available", "The name index is not available"))?;
    let request: crate::palette::PaletteRequest = from_json(json!({
        "text": args.str("query")?,
        "limit": limit.min(crate::palette::MAX_LIMIT as usize),
        // beside the palette of the window: neither cancels the other
        "detached": true,
    }))?;
    let (tx, rx) = mpsc::channel();
    let tx = std::sync::Mutex::new(tx);
    let query = palette.query(
        request,
        Arc::new(move |e| {
            let _ = tx.lock().unwrap_or_else(|e| e.into_inner()).send(e);
        }),
    );
    let deadline = Instant::now() + FIND_WAIT;
    let scope = hub.scope();
    let mut hits: Vec<Value> = Vec::new();
    let mut complete = false;
    while Instant::now() < deadline && !call.cancel.load(Ordering::SeqCst) {
        match rx.recv_timeout(std::time::Duration::from_millis(50)) {
            Ok(crate::palette::PaletteEvent::Hits { hits: batch, .. }) => {
                for h in batch {
                    if hits.len() < limit && scope.allows(Path::new(&h.entry.path)) {
                        let mut v = entry_json(&h.entry);
                        v["dir"] = json!(h.dir);
                        hits.push(v);
                    }
                }
            }
            Ok(crate::palette::PaletteEvent::Done { .. }) => {
                complete = true;
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    if !complete {
        palette.cancel(Some(query));
    }
    Ok(json!({ "hits": hits, "truncated": !complete || hits.len() >= limit }))
}

fn content_off() -> McpError {
    McpError::new(
        "content_not_allowed",
        "The user did not allow file contents over MCP (Settings → MCP → Allow file contents)",
    )
}

/// Reads at most `max` bytes of a regular file without blocking on a pipe.
fn read_head(path: &Path, max: u64) -> Result<(Vec<u8>, u64), McpError> {
    use std::io::Read;
    let mut opts = std::fs::OpenOptions::new();
    opts.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NONBLOCK);
    }
    let file = opts
        .open(path)
        .map_err(|e| McpError::from(crate::error::FsError::from_io(&e, path)))?;
    let meta = file
        .metadata()
        .map_err(|e| McpError::from(crate::error::FsError::from_io(&e, path)))?;
    if !meta.is_file() {
        return Err(McpError::new("not_a_file", "Only regular files are read"));
    }
    let mut bytes = Vec::new();
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| McpError::from(crate::error::FsError::from_io(&e, path)))?;
    Ok((bytes, meta.len()))
}

pub fn read_text(hub: &Arc<McpHub>, _call: &Call<'_>, args: &Value) -> Result<Value, McpError> {
    let args = Args::checked("read_text", args)?;
    if !hub.config().allow_content {
        return Err(content_off());
    }
    let path = hub.scope().check_content(args.str("path")?)?;
    let max = args
        .u64("maxBytes")
        .unwrap_or(DEFAULT_TEXT_BYTES)
        .clamp(1, MAX_TEXT_BYTES);
    let (mut bytes, size) = read_head(&path, max)?;
    let truncated = bytes.len() as u64 > max;
    bytes.truncate(max as usize);
    let head = &bytes[..bytes.len().min(crate::preview::HEAD_BYTES)];
    if crate::preview::detect::classify(head).family != crate::preview::detect::Family::Text {
        return Err(McpError::new(
            "content_not_allowed",
            "Only text files are read",
        ));
    }
    let encoding = crate::preview::encoding::detect(&bytes, truncated);
    let (text, replaced) = crate::preview::encoding::decode(&bytes, encoding, truncated);
    Ok(json!({
        "path": path.to_string_lossy(),
        "text": text,
        "encoding": encoding.id(),
        "bytes": bytes.len(),
        "size": size,
        "truncated": truncated,
        "invalidBytesReplaced": replaced,
    }))
}
