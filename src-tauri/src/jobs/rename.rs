//! Multi-rename (design 007 E5–E7). The frontend computes the new names; this
//! module never computes a name. It checks the pairs `{ path, newName }`
//! against each other and the disk ([`plan`]) and runs them ([`run`]): never
//! overwriting, chains in the right order, cycles (`a↔b`) through a unique
//! temporary name, and it returns the pairs that undo what was done.

use super::report::Reporter;
use super::{Control, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS, Summary};
use crate::error::{FsError, FsErrorCode};
use crate::fileops::{already_exists, check_danger, rename_same_entry, unique_temp};
use crate::paths::{validate_input_path, validate_name};
use crate::platform::{file_id, link_count, rename_noreplace};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs::{self, Metadata};
use std::io;
use std::path::{Path, PathBuf};

/// Most pairs per plan or job.
pub const MAX_ITEMS: usize = 100_000;
const MAX_LIVE_ERRORS: u64 = 100;

/// One entry and the name it should get (in its own folder).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameItem {
    pub path: String,
    pub new_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanStatus {
    Ok,
    Unchanged,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRow {
    pub status: PlanStatus,
    pub error: Option<FsError>,
}

/// Result of `plan_rename`: one row per input pair (same index).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePlan {
    pub rows: Vec<PlanRow>,
    pub ok: u32,
    pub unchanged: u32,
    pub errors: u32,
}

/// Where the new name points to on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Target {
    Free,
    /// The file system sees the new name as this very entry (case or Unicode
    /// normalisation only, on an insensitive file system).
    SameEntry,
    /// Taken by the source of item `j` of this plan (chain or cycle).
    Occupied(usize),
}

#[derive(Debug, Clone)]
struct Checked {
    src: PathBuf,
    parent: PathBuf,
    old_name: String,
    dst: PathBuf,
    status: PlanStatus,
    error: Option<FsError>,
    target: Target,
    id: Option<(u64, u64)>,
    /// The source exists and is valid – it takes part in the folder's names.
    present: bool,
}

impl Checked {
    fn fail(&mut self, e: FsError) {
        if self.status != PlanStatus::Error {
            self.status = PlanStatus::Error;
            self.error = Some(e);
        }
    }

    /// The name this entry has after the job (an entry that is not renamed keeps its name).
    fn final_name<'a>(&'a self, item: &'a RenameItem) -> &'a str {
        if self.status == PlanStatus::Ok {
            &item.new_name
        } else {
            &self.old_name
        }
    }
}

fn err(code: FsErrorCode, message: &str, path: &Path) -> FsError {
    FsError::new(code, message, Some(path))
}

/// `Abc` → `aBC`: a name the file system can only resolve to the same entry
/// if it ignores case.
fn swap_case(name: &str) -> String {
    name.chars()
        .flat_map(|c| -> Box<dyn Iterator<Item = char>> {
            if c.is_lowercase() {
                Box::new(c.to_uppercase())
            } else {
                Box::new(c.to_lowercase())
            }
        })
        .collect()
}

/// Whether the folder ignores case – measured with an entry of the plan
/// (same entry under the swapped name?), else the platform default.
fn ignores_case(rows: &[Checked], members: &[usize]) -> bool {
    for &i in members {
        let r = &rows[i];
        let swapped = swap_case(&r.old_name);
        if swapped == r.old_name {
            continue;
        }
        match fs::symlink_metadata(r.parent.join(&swapped)) {
            Ok(m) => {
                return match (file_id(&m), r.id) {
                    (Some(a), Some(b)) => a == b,
                    _ => true, // no ids (Windows): the swapped name exists → insensitive
                };
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => return false,
            Err(_) => {}
        }
    }
    cfg!(any(windows, target_os = "macos"))
}

fn key(name: &str, insensitive: bool) -> String {
    if insensitive {
        name.to_lowercase()
    } else {
        name.to_string()
    }
}

/// Checks all pairs without writing anything (design 007 E5).
fn analyze(items: &[RenameItem], home: Option<&Path>) -> Vec<Checked> {
    let mut seen: HashMap<PathBuf, usize> = HashMap::new();
    let mut rows: Vec<Checked> = items
        .iter()
        .map(|item| {
            let mut c = Checked {
                src: PathBuf::from(&item.path),
                parent: PathBuf::new(),
                old_name: String::new(),
                dst: PathBuf::new(),
                status: PlanStatus::Ok,
                error: None,
                target: Target::Free,
                id: None,
                present: false,
            };
            let src = match validate_input_path(&item.path) {
                Ok(p) => p,
                Err(e) => {
                    c.fail(e);
                    return c;
                }
            };
            c.src = src.clone();
            let (Some(parent), Some(name)) = (src.parent(), src.file_name()) else {
                c.fail(err(
                    FsErrorCode::InvalidPath,
                    "A root cannot be renamed",
                    &src,
                ));
                return c;
            };
            c.parent = parent.to_path_buf();
            c.old_name = name.to_string_lossy().into_owned();
            c.dst = parent.join(&item.new_name);
            if seen.insert(src.clone(), 0).is_some() {
                c.fail(err(FsErrorCode::InvalidPath, "Listed twice", &src));
                return c;
            }
            match fs::symlink_metadata(&src) {
                Ok(m) => c.id = file_id(&m),
                Err(e) => {
                    c.fail(FsError::from_io(&e, &src));
                    return c;
                }
            }
            if let Err(e) = check_danger(&src, home, false) {
                c.fail(e);
                return c;
            }
            c.present = true;
            if item.new_name == c.old_name {
                c.status = PlanStatus::Unchanged;
            } else if let Err(mut e) = validate_name(&item.new_name) {
                e.path = Some(item.path.clone());
                c.fail(e);
            }
            c
        })
        .collect();

    // per folder: duplicates and existing targets
    let mut by_dir: HashMap<PathBuf, Vec<usize>> = HashMap::new();
    for (i, r) in rows.iter().enumerate() {
        if r.present {
            by_dir.entry(r.parent.clone()).or_default().push(i);
        }
    }
    for members in by_dir.values() {
        let insensitive = ignores_case(&rows, members);
        let mut names: HashMap<String, Vec<usize>> = HashMap::new();
        for &i in members {
            names
                .entry(key(rows[i].final_name(&items[i]), insensitive))
                .or_default()
                .push(i);
        }
        for group in names.values().filter(|g| g.len() > 1) {
            for &i in group {
                let message = if rows[i].status == PlanStatus::Ok {
                    "Another selected entry gets the same name"
                } else {
                    "Another selected entry gets this entry's name"
                };
                let path = rows[i].src.clone();
                rows[i].fail(err(FsErrorCode::DuplicateTarget, message, &path));
            }
        }
        let by_id: HashMap<(u64, u64), usize> = members
            .iter()
            .filter_map(|&i| rows[i].id.map(|id| (id, i)))
            .collect();
        let by_key: HashMap<String, usize> = members
            .iter()
            .map(|&i| (key(&rows[i].old_name, insensitive), i))
            .collect();
        for &i in members {
            if rows[i].status != PlanStatus::Ok {
                continue;
            }
            let target = match fs::symlink_metadata(&rows[i].dst) {
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Some(Target::Free)),
                Err(e) => Err(FsError::from_io(&e, &rows[i].dst)),
                Ok(m) => Ok(occupant(
                    &rows[i],
                    &items[i],
                    &m,
                    &by_id,
                    &by_key,
                    i,
                    insensitive,
                )),
            };
            match target {
                Ok(Some(t)) => rows[i].target = t,
                Ok(None) => {
                    let dst = rows[i].dst.clone();
                    rows[i].fail(already_exists(&dst));
                }
                Err(e) => rows[i].fail(e),
            }
        }
    }

    // an entry that keeps its name (error) blocks everyone waiting for it
    loop {
        let mut changed = false;
        for i in 0..rows.len() {
            if let (PlanStatus::Ok, Target::Occupied(j)) = (rows[i].status, rows[i].target)
                && rows[j].status != PlanStatus::Ok
            {
                let dst = rows[i].dst.clone();
                rows[i].fail(err(
                    FsErrorCode::AlreadyExists,
                    "The entry with this name is not renamed",
                    &dst,
                ));
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    rows
}

/// Who the existing target is: this entry, another source of the plan, or a
/// stranger (`None`).
fn occupant(
    row: &Checked,
    item: &RenameItem,
    meta: &Metadata,
    by_id: &HashMap<(u64, u64), usize>,
    by_key: &HashMap<String, usize>,
    me: usize,
    insensitive: bool,
) -> Option<Target> {
    let other = match file_id(meta) {
        Some(id) if Some(id) == row.id => {
            // two hard links of one inode are two names, not one entry
            let same = link_count(meta).is_none_or(|n| n <= 1)
                || row.old_name.to_lowercase() == item.new_name.to_lowercase();
            return same.then_some(Target::SameEntry);
        }
        Some(id) => by_id.get(&id).copied(),
        None => by_key.get(&key(&item.new_name, insensitive)).copied(),
    };
    match other {
        Some(j) if j == me => Some(Target::SameEntry),
        Some(j) => Some(Target::Occupied(j)),
        None => None,
    }
}

/// Checks the pairs against each other and the disk; writes nothing.
pub fn plan(items: &[RenameItem], home: Option<&Path>) -> RenamePlan {
    let rows = analyze(items, home);
    let mut out = RenamePlan {
        rows: Vec::with_capacity(rows.len()),
        ok: 0,
        unchanged: 0,
        errors: 0,
    };
    for r in rows {
        match r.status {
            PlanStatus::Ok => out.ok += 1,
            PlanStatus::Unchanged => out.unchanged += 1,
            PlanStatus::Error => out.errors += 1,
        }
        out.rows.push(PlanRow {
            status: r.status,
            error: r.error,
        });
    }
    out
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

struct Runner<'a> {
    rep: Reporter<'a>,
    summary: Summary,
    undo: Vec<RenameItem>,
}

impl Runner<'_> {
    fn fail(&mut self, path: &Path, error: FsError) {
        self.summary.items_failed += 1;
        let item = ItemError {
            path: path_string(path),
            error,
        };
        if self.summary.items_failed <= MAX_LIVE_ERRORS {
            self.rep.item_failed(item.clone());
        }
        if self.summary.errors.len() < MAX_REPORTED_ERRORS {
            self.summary.errors.push(item);
        }
    }

    fn done(&mut self, r: &Checked) {
        self.undo.push(RenameItem {
            path: path_string(&r.dst),
            new_name: r.old_name.clone(),
        });
        self.summary.items_done += 1;
        self.rep.dir_changed(path_string(&r.parent));
        self.rep.progress.items_done += 1;
        self.rep.progress.current = Some(path_string(&r.src));
        self.rep.tick(false);
    }
}

fn noreplace(from: &Path, to: &Path) -> Result<(), FsError> {
    rename_noreplace(from, to).map_err(|e| {
        if e.kind() == io::ErrorKind::AlreadyExists {
            already_exists(to)
        } else {
            FsError::from_io(&e, from)
        }
    })
}

/// Renames one entry that is not part of a cycle.
fn rename_one(r: &Checked, new_name: &str) -> Result<(), FsError> {
    if r.target == Target::SameEntry {
        rename_same_entry(&r.src, &r.parent, new_name).map(|_| ())
    } else {
        noreplace(&r.src, &r.dst)
    }
}

/// Runs a rename job. Without `partial`, any problem in the plan fails the job
/// before anything is renamed; with it (undo), the valid pairs run and the
/// others are reported. Returns the pairs that undo what was done.
pub fn run(
    id: &str,
    items: &[RenameItem],
    partial: bool,
    home: Option<&Path>,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary, Vec<RenameItem>) {
    let rows = analyze(items, home);
    let mut run = Runner {
        rep: Reporter::new(id, emit),
        summary: Summary::default(),
        undo: Vec::new(),
    };
    run.rep.emit(JobEvent::State {
        id: id.to_string(),
        state: if control.is_paused() {
            JobState::Paused
        } else {
            JobState::Running
        },
    });
    let failed: Vec<usize> = (0..rows.len())
        .filter(|&i| rows[i].status == PlanStatus::Error)
        .collect();
    if !failed.is_empty() && !partial {
        let first = rows[failed[0]].error.clone();
        for &i in &failed {
            run.fail(
                &rows[i].src.clone(),
                rows[i]
                    .error
                    .clone()
                    .unwrap_or_else(|| err(FsErrorCode::Io, "Not renamed", &rows[i].src)),
            );
        }
        run.summary.error = first.map(|mut e| {
            e.message = format!("Nothing was renamed: {}", e.message);
            e
        });
        return (JobState::Failed, run.summary, run.undo);
    }
    for &i in &failed {
        let e = rows[i]
            .error
            .clone()
            .unwrap_or_else(|| err(FsErrorCode::Io, "Not renamed", &rows[i].src));
        run.fail(&rows[i].src.clone(), e);
    }
    let work: Vec<usize> = (0..rows.len())
        .filter(|&i| rows[i].status == PlanStatus::Ok)
        .collect();
    run.rep.progress.items_total = work.len() as u64;
    run.rep.tick(true);

    // chains: first whoever's target is free; that frees the target of the one waiting for it
    let mut waiting_for: HashMap<usize, usize> = HashMap::new(); // occupant → dependent
    let mut queue: VecDeque<usize> = VecDeque::new();
    for &i in &work {
        match rows[i].target {
            Target::Occupied(j) => {
                waiting_for.insert(j, i);
            }
            _ => queue.push_back(i),
        }
    }
    let mut visited = vec![false; rows.len()];
    let mut cancelled = false;
    while let Some(i) = queue.pop_front() {
        if control.is_cancelled() || !control.wait_while_paused() {
            cancelled = true;
            break;
        }
        visited[i] = true;
        match rename_one(&rows[i], &items[i].new_name) {
            Ok(()) => run.done(&rows[i]),
            Err(e) => run.fail(&rows[i].src.clone(), e),
        }
        // even after a failure: the dependent fails on its own ("exists"), never overwrites
        if let Some(&k) = waiting_for.get(&i) {
            queue.push_back(k);
        }
    }

    // what is left are cycles (a↔b, a→b→c→a) – each one completes or is rolled back
    if !cancelled {
        for &start in &work {
            if visited[start] {
                continue;
            }
            if control.is_cancelled() || !control.wait_while_paused() {
                cancelled = true;
                break;
            }
            let mut cycle = vec![start];
            visited[start] = true;
            let mut j = start;
            let closed = loop {
                let Target::Occupied(next) = rows[j].target else {
                    break false;
                };
                if next == start {
                    break true;
                }
                if visited[next] || cycle.len() > work.len() {
                    break false;
                }
                visited[next] = true;
                cycle.push(next);
                j = next;
            };
            if !closed {
                for &k in &cycle {
                    let src = rows[k].src.clone();
                    run.fail(
                        &src,
                        err(FsErrorCode::Io, "Internal error: rename order", &src),
                    );
                }
                continue;
            }
            run_cycle(&rows, &cycle, &mut run);
        }
    }
    run.rep.tick(true);
    let state = if cancelled {
        JobState::Cancelled
    } else if run.summary.items_failed > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    (state, run.summary, run.undo)
}

/// `cycle[k + 1]` occupies the target of `cycle[k]`; the last one's target is
/// the first one's source. The first entry goes to a temporary name, the
/// others follow from the end, then the first leaves the temporary name. A
/// failure rolls back what was done, so no temporary name stays behind.
fn run_cycle(rows: &[Checked], cycle: &[usize], run: &mut Runner<'_>) {
    let first = &rows[cycle[0]];
    let tmp = unique_temp(&first.parent);
    if let Err(e) = noreplace(&first.src, &tmp) {
        for &k in cycle {
            let src = rows[k].src.clone();
            let e = if k == cycle[0] {
                e.clone()
            } else {
                not_swapped(&src)
            };
            run.fail(&src, e);
        }
        return;
    }
    let mut moved: Vec<usize> = Vec::new();
    let mut failure: Option<(usize, FsError)> = None;
    for &k in cycle[1..].iter().rev() {
        match noreplace(&rows[k].src, &rows[k].dst) {
            Ok(()) => moved.push(k),
            Err(e) => {
                failure = Some((k, e));
                break;
            }
        }
    }
    if failure.is_none() {
        match noreplace(&tmp, &first.dst) {
            Ok(()) => {
                for &k in cycle[1..].iter().rev() {
                    run.done(&rows[k]);
                }
                run.done(first);
                return;
            }
            Err(e) => failure = Some((cycle[0], e)),
        }
    }
    // roll back: the moved entries return, then the first one leaves the temporary name
    let mut stuck: Vec<usize> = Vec::new();
    for &k in moved.iter().rev() {
        if noreplace(&rows[k].dst, &rows[k].src).is_err() {
            stuck.push(k);
        }
    }
    let restored = stuck.is_empty() && noreplace(&tmp, &first.src).is_ok();
    let (bad, e) = failure.expect("a failure");
    for &k in cycle {
        let src = rows[k].src.clone();
        if stuck.contains(&k) {
            run.done(&rows[k]); // it has its new name after all (the undo log knows it)
        } else if k == bad {
            run.fail(&src, e.clone());
        } else if k == cycle[0] && !restored {
            run.fail(
                &src,
                FsError::new(
                    FsErrorCode::Io,
                    format!(
                        "The swap could not be completed; the entry is now named {}",
                        tmp.file_name().unwrap_or_default().to_string_lossy()
                    ),
                    Some(&src),
                ),
            );
        } else {
            run.fail(&src, not_swapped(&src));
        }
    }
}

fn not_swapped(path: &Path) -> FsError {
    err(
        FsErrorCode::Io,
        "Not renamed: the names could not be swapped",
        path,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tempfile::tempdir;

    fn item(dir: &Path, old: &str, new: &str) -> RenameItem {
        RenameItem {
            path: path_string(&dir.join(old)),
            new_name: new.to_string(),
        }
    }

    fn statuses(p: &RenamePlan) -> Vec<PlanStatus> {
        p.rows.iter().map(|r| r.status).collect()
    }

    fn code(p: &RenamePlan, i: usize) -> Option<FsErrorCode> {
        p.rows[i].error.as_ref().map(|e| e.code)
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    fn files(dir: &Path, list: &[(&str, &str)]) {
        for (n, c) in list {
            fs::write(dir.join(n), c).unwrap();
        }
    }

    fn content(dir: &Path, name: &str) -> String {
        fs::read_to_string(dir.join(name)).unwrap()
    }

    type Events = Mutex<Vec<JobEvent>>;

    fn exec(items: &[RenameItem], partial: bool) -> (JobState, Summary, Vec<RenameItem>, Events) {
        let events: Events = Mutex::new(Vec::new());
        let control = Control::default();
        let emit = |e: JobEvent| events.lock().unwrap().push(e);
        let (s, sum, undo) = run("j1", items, partial, None, &control, &emit);
        (s, sum, undo, events)
    }

    #[test]
    fn plan_ok_unchanged_and_invalid() {
        let t = tempdir().unwrap();
        files(t.path(), &[("a.txt", "A"), ("b.txt", "B"), ("c.txt", "C")]);
        let p = plan(
            &[
                item(t.path(), "a.txt", "x ü 🎉.txt"),
                item(t.path(), "b.txt", "b.txt"),
                item(t.path(), "c.txt", "a/b"),
            ],
            None,
        );
        assert_eq!(
            statuses(&p),
            vec![PlanStatus::Ok, PlanStatus::Unchanged, PlanStatus::Error]
        );
        assert_eq!(code(&p, 2), Some(FsErrorCode::InvalidName));
        assert_eq!((p.ok, p.unchanged, p.errors), (1, 1, 1));
        let p = plan(&[item(t.path(), "a.txt", "")], None);
        assert_eq!(code(&p, 0), Some(FsErrorCode::InvalidName));
        let p = plan(&[item(t.path(), "a.txt", &"x".repeat(300))], None);
        assert_eq!(code(&p, 0), Some(FsErrorCode::InvalidName));
    }

    #[test]
    fn plan_duplicates_inside_the_selection() {
        let t = tempdir().unwrap();
        files(t.path(), &[("a", "A"), ("b", "B"), ("c", "C")]);
        let p = plan(
            &[
                item(t.path(), "a", "x"),
                item(t.path(), "b", "x"),
                item(t.path(), "c", "c"),
            ],
            None,
        );
        assert_eq!(code(&p, 0), Some(FsErrorCode::DuplicateTarget));
        assert_eq!(code(&p, 1), Some(FsErrorCode::DuplicateTarget));
        assert_eq!(p.rows[2].status, PlanStatus::Unchanged);
        // a name an unchanged entry keeps
        let p = plan(&[item(t.path(), "a", "c"), item(t.path(), "c", "c")], None);
        assert_eq!(code(&p, 0), Some(FsErrorCode::DuplicateTarget));
        assert_eq!(code(&p, 1), Some(FsErrorCode::DuplicateTarget));
        // same path twice
        let p = plan(&[item(t.path(), "a", "y"), item(t.path(), "a", "z")], None);
        assert_eq!(code(&p, 1), Some(FsErrorCode::InvalidPath));
    }

    #[test]
    fn plan_existing_target_chain_and_swap() {
        let t = tempdir().unwrap();
        files(
            t.path(),
            &[("a", "A"), ("b", "B"), ("c", "C"), ("fremd", "F")],
        );
        let p = plan(&[item(t.path(), "a", "fremd")], None);
        assert_eq!(code(&p, 0), Some(FsErrorCode::AlreadyExists));
        // chain a→b, b→d
        let p = plan(&[item(t.path(), "a", "b"), item(t.path(), "b", "d")], None);
        assert_eq!(statuses(&p), vec![PlanStatus::Ok, PlanStatus::Ok]);
        // swap
        let p = plan(&[item(t.path(), "a", "b"), item(t.path(), "b", "a")], None);
        assert_eq!(p.ok, 2);
        // a→b, but b keeps its name (invalid new name) → a would duplicate it
        let p = plan(
            &[item(t.path(), "a", "b"), item(t.path(), "b", "x/y")],
            None,
        );
        assert_eq!(code(&p, 1), Some(FsErrorCode::InvalidName));
        assert_eq!(code(&p, 0), Some(FsErrorCode::DuplicateTarget));
        // b would go onto an existing stranger → a (waiting for b) is blocked too
        let p = plan(
            &[item(t.path(), "a", "b"), item(t.path(), "b", "fremd")],
            None,
        );
        assert_eq!(p.errors, 2);
        // missing source
        let p = plan(&[item(t.path(), "fehlt", "x")], None);
        assert_eq!(code(&p, 0), Some(FsErrorCode::NotFound));
    }

    #[cfg(unix)]
    #[test]
    fn plan_refuses_dangerous_paths_and_hard_links() {
        let p = plan(
            &[RenameItem {
                path: "/etc".into(),
                new_name: "x".into(),
            }],
            None,
        );
        assert_eq!(code(&p, 0), Some(FsErrorCode::DangerousPath));
        let t = tempdir().unwrap();
        files(t.path(), &[("a", "A")]);
        fs::hard_link(t.path().join("a"), t.path().join("b")).unwrap();
        let p = plan(&[item(t.path(), "a", "b")], None);
        assert_eq!(code(&p, 0), Some(FsErrorCode::AlreadyExists));
    }

    /// ext4/tmpfs are case-sensitive: `a` and `A` are distinct entries.
    #[cfg(target_os = "linux")]
    #[test]
    fn plan_measures_case_sensitivity() {
        let t = tempdir().unwrap();
        files(t.path(), &[("readme", "1"), ("README", "2"), ("x", "3")]);
        let p = plan(&[item(t.path(), "x", "README")], None);
        assert_eq!(code(&p, 0), Some(FsErrorCode::AlreadyExists));
        let p = plan(
            &[item(t.path(), "readme", "Readme"), item(t.path(), "x", "y")],
            None,
        );
        assert_eq!(p.ok, 2);
        let rows = analyze(&[item(t.path(), "readme", "x")], None);
        assert!(!ignores_case(&rows, &[0]));
        // distinct on a sensitive file system – no duplicate
        let p = plan(
            &[item(t.path(), "readme", "q"), item(t.path(), "x", "Q")],
            None,
        );
        assert_eq!(p.ok, 2);
    }

    #[test]
    fn run_simple_chain_swap_and_three_cycle() {
        let t = tempdir().unwrap();
        let d = t.path();
        files(
            d,
            &[
                ("a", "A"),
                ("b", "B"),
                ("c", "C"),
                ("1", "eins"),
                ("2", "zwei"),
                ("3", "drei"),
            ],
        );
        let items = vec![
            item(d, "a", "b"), // chain a→b→c→d
            item(d, "b", "c"),
            item(d, "c", "d"),
            item(d, "1", "2"), // cycle 1→2→3→1
            item(d, "2", "3"),
            item(d, "3", "1"),
        ];
        let (state, sum, undo, _) = exec(&items, false);
        assert_eq!(state, JobState::Done, "{:?}", sum.errors);
        assert_eq!(sum.items_done, 6);
        assert_eq!(content(d, "b"), "A");
        assert_eq!(content(d, "c"), "B");
        assert_eq!(content(d, "d"), "C");
        assert!(!d.join("a").exists());
        assert_eq!(content(d, "2"), "eins");
        assert_eq!(content(d, "3"), "zwei");
        assert_eq!(content(d, "1"), "drei");
        assert_eq!(names(d), vec!["1", "2", "3", "b", "c", "d"]);
        // undo restores the start
        let (state, sum, redo, _) = exec(&undo, true);
        assert_eq!(state, JobState::Done, "{:?}", sum.errors);
        assert_eq!(names(d), vec!["1", "2", "3", "a", "b", "c"]);
        assert_eq!(content(d, "a"), "A");
        assert_eq!(content(d, "1"), "eins");
        assert_eq!(content(d, "3"), "drei");
        // undo of the undo
        let (state, _, _, _) = exec(&redo, true);
        assert_eq!(state, JobState::Done);
        assert_eq!(content(d, "d"), "C");
        assert_eq!(content(d, "1"), "drei");
    }

    #[test]
    fn run_swap_with_unicode_spaces_and_folders() {
        let t = tempdir().unwrap();
        let d = t.path();
        fs::create_dir(d.join("Ordner ä")).unwrap();
        files(d, &[("Datei 🎉.txt", "x")]);
        let items = vec![
            item(d, "Ordner ä", "Datei 🎉.txt"),
            item(d, "Datei 🎉.txt", "Ordner ä"),
        ];
        let (state, _, _, _) = exec(&items, false);
        assert_eq!(state, JobState::Done);
        assert!(d.join("Datei 🎉.txt").is_dir());
        assert_eq!(content(d, "Ordner ä"), "x");
    }

    #[test]
    fn run_with_plan_errors_renames_nothing() {
        let t = tempdir().unwrap();
        let d = t.path();
        files(d, &[("a", "A"), ("b", "B"), ("x", "X")]);
        let items = vec![item(d, "a", "a2"), item(d, "b", "x")];
        let (state, sum, undo, _) = exec(&items, false);
        assert_eq!(state, JobState::Failed);
        assert!(
            sum.error
                .unwrap()
                .message
                .starts_with("Nothing was renamed")
        );
        assert!(undo.is_empty());
        assert_eq!(names(d), vec!["a", "b", "x"]);
        // partial (undo): the valid pair runs
        let (state, sum, undo, _) = exec(&items, true);
        assert_eq!(state, JobState::DoneWithErrors);
        assert_eq!((sum.items_done, sum.items_failed), (1, 1));
        assert_eq!(undo.len(), 1);
        assert_eq!(names(d), vec!["a2", "b", "x"]);
        assert_eq!(content(d, "x"), "X");
    }

    #[test]
    fn run_never_overwrites_a_target_that_appears_after_planning() {
        let t = tempdir().unwrap();
        let d = t.path();
        files(d, &[("a", "A")]);
        let items = vec![item(d, "a", "b")];
        assert_eq!(plan(&items, None).ok, 1);
        let rows = analyze(&items, None);
        fs::write(d.join("b"), "neu").unwrap(); // appears now
        assert_eq!(
            rename_one(&rows[0], "b").unwrap_err().code,
            FsErrorCode::AlreadyExists
        );
        assert_eq!(content(d, "b"), "neu");
        assert_eq!(content(d, "a"), "A");
    }

    #[test]
    fn cycle_failure_is_rolled_back_without_temporary_names() {
        let t = tempdir().unwrap();
        let d = t.path();
        files(d, &[("1", "eins"), ("2", "zwei"), ("3", "drei")]);
        let items = vec![item(d, "1", "2"), item(d, "2", "3"), item(d, "3", "1")];
        let rows = analyze(&items, None);
        // "2" disappears after the plan: the step 2 → 3 fails after 1 went to a
        // temporary name and 3 → 1 was done – both are rolled back
        fs::remove_file(d.join("2")).unwrap();
        let events = Mutex::new(Vec::new());
        let emit = |e: JobEvent| events.lock().unwrap().push(e);
        let mut runner = Runner {
            rep: Reporter::new("j", &emit),
            summary: Summary::default(),
            undo: Vec::new(),
        };
        run_cycle(&rows, &[0, 1, 2], &mut runner);
        assert_eq!(runner.summary.items_done, 0);
        assert_eq!(runner.summary.items_failed, 3);
        assert_eq!(names(d), vec!["1", "3"]);
        assert_eq!(content(d, "1"), "eins");
        assert_eq!(content(d, "3"), "drei");
    }

    #[test]
    fn cancel_stops_between_entries_and_completes_no_half_cycle() {
        let t = tempdir().unwrap();
        let d = t.path();
        files(d, &[("a", "A"), ("b", "B"), ("c", "C")]);
        let items = vec![item(d, "a", "b"), item(d, "b", "a"), item(d, "c", "c2")];
        let control = Control::default();
        control.cancel();
        let emit = |_e: JobEvent| {};
        let (state, sum, undo) = run("j", &items, false, None, &control, &emit);
        assert_eq!(state, JobState::Cancelled);
        assert_eq!(sum.items_done, 0);
        assert!(undo.is_empty());
        assert_eq!(names(d), vec!["a", "b", "c"]);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_renamed_not_their_targets() {
        let t = tempdir().unwrap();
        let d = t.path();
        files(d, &[("ziel", "Z")]);
        std::os::unix::fs::symlink(d.join("ziel"), d.join("link")).unwrap();
        std::os::unix::fs::symlink(d.join("fehlt"), d.join("kaputt")).unwrap();
        let items = vec![item(d, "link", "link2"), item(d, "kaputt", "kaputt2")];
        let (state, _, _, _) = exec(&items, false);
        assert_eq!(state, JobState::Done);
        assert_eq!(names(d), vec!["kaputt2", "link2", "ziel"]);
        assert!(fs::symlink_metadata(d.join("link2")).unwrap().is_symlink());
        assert_eq!(content(d, "ziel"), "Z");
    }

    #[test]
    fn ten_thousand_entries() {
        let t = tempdir().unwrap();
        let d = t.path();
        let items: Vec<RenameItem> = (0..10_000)
            .map(|i| {
                let n = format!("f{i:05}.txt");
                fs::write(d.join(&n), "").unwrap();
                // shift by one: a long chain f00000 → f00001 → … plus one new name
                item(d, &n, &format!("f{:05}.txt", i + 1))
            })
            .collect();
        let started = std::time::Instant::now();
        let p = plan(&items, None);
        let planned = started.elapsed();
        assert_eq!(p.ok, 10_000);
        let (state, sum, _, events) = exec(&items, false);
        assert_eq!(state, JobState::Done, "{:?}", sum.errors.first());
        assert_eq!(sum.items_done, 10_000);
        assert!(d.join("f10000.txt").exists() && !d.join("f00000.txt").exists());
        let progress = events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| matches!(e, JobEvent::Progress { .. }))
            .count();
        assert!(progress < 200, "throttled progress: {progress}");
        eprintln!("[fnf:perf] plan 10 000: {planned:?}");
    }

    #[test]
    fn wire_format() {
        let i: RenameItem = serde_json::from_str(r#"{"path":"/a","newName":"b"}"#).unwrap();
        assert_eq!(i.new_name, "b");
        let p = RenamePlan {
            rows: vec![PlanRow {
                status: PlanStatus::Unchanged,
                error: None,
            }],
            ok: 0,
            unchanged: 1,
            errors: 0,
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["rows"][0]["status"], "unchanged");
        assert_eq!(v["unchanged"], 1);
    }
}
