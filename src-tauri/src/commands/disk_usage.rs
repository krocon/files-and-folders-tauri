//! Commands of the disk-usage view (design 033 E4). Scans start as job
//! `diskUsage` (`start_job`); these read and change the kept trees.

use crate::commands::{JobsState, blocking};
use crate::disk_usage::{self, DiskUsageView, NodeId, UsageFile};
use crate::error::FsError;
use crate::paths::validate_input_path;
use tauri::{AppHandle, Manager, Runtime};

/// Entries of one prune call (a delete job's paths).
const MAX_PRUNE: usize = 100_000;

fn hub<R: Runtime>(app: &AppHandle<R>) -> std::sync::Arc<disk_usage::DiskUsageHub> {
    app.state::<JobsState>().manager.disk_usage().clone()
}

/// A node with its children down to `depth` levels (`nodeId` null = top node).
#[tauri::command(async)]
pub fn disk_usage_view<R: Runtime>(
    app: AppHandle<R>,
    scan_id: String,
    node_id: Option<NodeId>,
    depth: u32,
    min_fraction: f64,
    limit: u32,
) -> Result<DiskUsageView, FsError> {
    let min_fraction = if min_fraction.is_finite() {
        min_fraction
    } else {
        0.0
    };
    hub(&app)
        .get(&scan_id)?
        .view(node_id, depth, min_fraction, limit as usize)
}

/// The largest kept files below a node.
#[tauri::command(async)]
pub fn disk_usage_largest<R: Runtime>(
    app: AppHandle<R>,
    scan_id: String,
    node_id: NodeId,
    limit: u32,
) -> Result<Vec<UsageFile>, FsError> {
    let scan = hub(&app).get(&scan_id)?;
    let t = scan.read();
    Ok(t.largest(node_id, (limit as usize).min(disk_usage::MAX_LARGEST)))
}

/// The node of a path in the scan (`null` if not kept).
#[tauri::command(async)]
pub fn disk_usage_locate<R: Runtime>(
    app: AppHandle<R>,
    scan_id: String,
    path: String,
) -> Result<Option<NodeId>, FsError> {
    let path = validate_input_path(&path)?;
    let scan = hub(&app).get(&scan_id)?;
    let t = scan.read();
    Ok(t.locate(&path))
}

/// Removes the given entries that no longer exist (after a delete job) and
/// corrects the totals; returns the paths that went (as given).
#[tauri::command]
pub async fn disk_usage_prune<R: Runtime>(
    app: AppHandle<R>,
    scan_id: String,
    paths: Vec<String>,
) -> Result<Vec<String>, FsError> {
    if paths.len() > MAX_PRUNE {
        return Err(FsError::new(
            crate::error::FsErrorCode::TooMany,
            format!("Too many entries (max. {MAX_PRUNE})"),
            None,
        ));
    }
    let paths = paths
        .iter()
        .map(|p| validate_input_path(p))
        .collect::<Result<Vec<_>, _>>()?;
    let scan = hub(&app).get(&scan_id)?;
    blocking("Updating the disk usage", move || {
        Ok(scan
            .prune(&paths)
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect())
    })
    .await
}

/// Forgets a scan (its tab closed); a running scan is cancelled.
#[tauri::command(async)]
pub fn disk_usage_release<R: Runtime>(app: AppHandle<R>, scan_id: String) {
    let state = app.state::<JobsState>();
    state.manager.cancel(&scan_id);
    state.manager.disk_usage().release(&scan_id);
}
