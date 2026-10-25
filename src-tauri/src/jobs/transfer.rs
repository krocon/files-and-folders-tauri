//! Copy and move with a server side (design 034 E4): local → server, server → local,
//! server → server. The local-only `copy.rs` stays untouched.
//!
//! Like copying (006): plan first (walk, sizes), every file goes to a
//! `.fnf-<job>-<n>.part` beside its target and is renamed to its name afterwards, so a
//! cancelled or failed transfer never leaves half a file under the real name;
//! existing targets raise the conflict question. Differences:
//! - links are not followed and not copied (servers cannot take them reliably) –
//!   they are reported as `symlink_skipped`;
//! - FTP cannot refuse a rename onto an existing name: the target is checked first
//!   (a race with another client is possible and documented);
//! - server → server goes through a temporary local file (two connections of one
//!   profile with `maxConnections = 1` would wait for each other);
//! - moving on the same server renames whole entries when the target name is free.

use super::ask::Asker;
use super::report::Reporter;
use super::{
    Control, CopyOptions, Decision, FileMeta, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS,
    Summary,
};
use crate::dirsize::DirSize;
use crate::error::{FsError, FsErrorCode};
use crate::model::EntryKind;
use crate::paths::validate_name;
use crate::remote::fs::RemoteFs;
use crate::remote::{Hub, RemotePath, is_remote};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const MAX_LIVE_ERRORS: u64 = 100;
const BLOCK: usize = 256 * 1024;
/// Entries a plan may hold (a whole server is no copy source).
const MAX_ITEMS: usize = 1_000_000;

/// A place: local path or server path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Loc {
    Local(PathBuf),
    Remote(RemotePath),
}

impl Loc {
    pub fn parse(raw: &str) -> Result<Loc, FsError> {
        if is_remote(raw) {
            Ok(Loc::Remote(RemotePath::parse(raw)?))
        } else {
            Ok(Loc::Local(PathBuf::from(raw)))
        }
    }

    pub fn display(&self) -> String {
        match self {
            Loc::Local(p) => p.to_string_lossy().into_owned(),
            Loc::Remote(r) => r.to_string(),
        }
    }

    fn name(&self) -> Option<String> {
        match self {
            Loc::Local(p) => p.file_name().map(|n| n.to_string_lossy().into_owned()),
            Loc::Remote(r) => r.name().map(str::to_string),
        }
    }

    fn parent(&self) -> Option<Loc> {
        match self {
            Loc::Local(p) => p.parent().map(|p| Loc::Local(p.to_path_buf())),
            Loc::Remote(r) => r.parent().map(Loc::Remote),
        }
    }

    fn join(&self, name: &str) -> Result<Loc, FsError> {
        match self {
            Loc::Local(p) => {
                validate_name(name)?;
                Ok(Loc::Local(p.join(name)))
            }
            Loc::Remote(r) => r.join(name).map(Loc::Remote),
        }
    }

    fn starts_with(&self, other: &Loc) -> bool {
        match (self, other) {
            (Loc::Local(a), Loc::Local(b)) => a.starts_with(b),
            (Loc::Remote(a), Loc::Remote(b)) => a.starts_with(b),
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Meta {
    pub kind: EntryKind,
    pub size: u64,
    pub modified_ms: Option<i64>,
}

impl Meta {
    fn file_meta(&self) -> FileMeta {
        FileMeta {
            size: (self.kind != EntryKind::Directory).then_some(self.size),
            modified_ms: self.modified_ms,
            is_dir: self.kind == EntryKind::Directory,
        }
    }
}

fn local_meta(m: &fs::Metadata) -> Meta {
    let ft = m.file_type();
    Meta {
        kind: if ft.is_symlink() {
            EntryKind::Symlink
        } else if ft.is_dir() {
            EntryKind::Directory
        } else {
            EntryKind::File
        },
        size: m.len(),
        modified_ms: m
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64),
    }
}

/// Entry metadata without following links; `None` = does not exist.
pub fn stat(hub: &Hub, loc: &Loc) -> Result<Option<Meta>, FsError> {
    match loc {
        Loc::Local(p) => match fs::symlink_metadata(p) {
            Ok(m) => Ok(Some(local_meta(&m))),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(FsError::from_io(&e, p)),
        },
        Loc::Remote(r) => {
            let m = hub.with(r.profile(), |c| c.stat(r.server_path()))?;
            Ok(m.map(|m| Meta {
                kind: m.kind,
                size: m.size.unwrap_or(0),
                modified_ms: m.modified_ms,
            }))
        }
    }
}

/// A folder entry, or the name that could not be read exactly.
type Child = Result<(String, Meta), String>;

/// The entries of a folder (`Err` per unreadable name is reported by the caller).
fn list(hub: &Hub, loc: &Loc) -> Result<Vec<Child>, FsError> {
    match loc {
        Loc::Local(p) => {
            let mut out = Vec::new();
            for e in fs::read_dir(p).map_err(|e| FsError::from_io(&e, p))? {
                let e = e.map_err(|e| FsError::from_io(&e, p))?;
                let name = e.file_name();
                let Some(name) = name.to_str() else {
                    out.push(Err(name.to_string_lossy().into_owned()));
                    continue;
                };
                match fs::symlink_metadata(e.path()) {
                    Ok(m) => out.push(Ok((name.to_string(), local_meta(&m)))),
                    Err(_) => out.push(Err(name.to_string())),
                }
            }
            Ok(out)
        }
        Loc::Remote(r) => {
            let l = hub.with(r.profile(), |c| c.list(r.server_path()))?;
            Ok(l.entries
                .into_iter()
                .map(|e| {
                    if e.lossy {
                        Err(e.name)
                    } else {
                        Ok((
                            e.name,
                            Meta {
                                kind: e.kind,
                                size: e.size.unwrap_or(0),
                                modified_ms: e.modified_ms,
                            },
                        ))
                    }
                })
                .collect())
        }
    }
}

#[derive(Debug, Clone)]
struct Item {
    src: Loc,
    dst: Loc,
    meta: Meta,
    /// Index of the top-level source this item belongs to.
    top: usize,
}

#[derive(Default)]
struct Plan {
    items: Vec<Item>,
    bytes: u64,
    errors: Vec<ItemError>,
    more_errors: u64,
}

impl Plan {
    fn error(&mut self, path: String, error: FsError) {
        if self.errors.len() < MAX_REPORTED_ERRORS {
            self.errors.push(ItemError { path, error });
        } else {
            self.more_errors += 1;
        }
    }
}

fn skipped_link(path: &str) -> FsError {
    FsError::at(
        FsErrorCode::SymlinkSkipped,
        "Links are not copied to or from servers",
        path,
    )
}

/// Walks the sources (depth first, folders before their content).
fn walk(hub: &Hub, tops: &[(Loc, Loc, Meta)], plan: &mut Plan, control: &Control) -> bool {
    for (i, (src, dst, meta)) in tops.iter().enumerate() {
        let mut stack = vec![(src.clone(), dst.clone(), *meta)];
        while let Some((s, d, m)) = stack.pop() {
            if control.is_cancelled() {
                return false;
            }
            if plan.items.len() >= MAX_ITEMS {
                plan.error(
                    s.display(),
                    FsError::at(FsErrorCode::TooMany, "Too many entries", &s.display()),
                );
                return true;
            }
            match m.kind {
                EntryKind::Symlink | EntryKind::Unknown => {
                    plan.error(s.display(), skipped_link(&s.display()));
                }
                EntryKind::File => {
                    plan.bytes += m.size;
                    plan.items.push(Item {
                        src: s,
                        dst: d,
                        meta: m,
                        top: i,
                    });
                }
                EntryKind::Directory => {
                    let children = match list(hub, &s) {
                        Ok(c) => c,
                        Err(e) => {
                            plan.error(s.display(), e);
                            continue;
                        }
                    };
                    plan.items.push(Item {
                        src: s.clone(),
                        dst: d.clone(),
                        meta: m,
                        top: i,
                    });
                    let mut next = Vec::new();
                    for c in children {
                        match c {
                            Ok((name, cm)) => match (s.join(&name), d.join(&name)) {
                                (Ok(cs), Ok(cd)) => next.push((cs, cd, cm)),
                                (Err(e), _) | (_, Err(e)) => plan.error(s.display(), e),
                            },
                            Err(name) => plan.error(
                                format!("{}/{name}", s.display()),
                                FsError::at(
                                    FsErrorCode::InvalidName,
                                    "Name cannot be read exactly",
                                    &name,
                                ),
                            ),
                        }
                    }
                    // reversed: the stack pops them in listing order
                    next.reverse();
                    stack.extend(next);
                }
            }
        }
    }
    true
}

/// A free name `name (n).ext` beside `dst`.
fn suggest(hub: &Hub, dst: &Loc) -> String {
    let name = dst.name().unwrap_or_default();
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name.as_str(), ""),
    };
    let Some(parent) = dst.parent() else {
        return name;
    };
    for n in 1..1000 {
        let candidate = format!("{stem} ({n}){ext}");
        if let Ok(c) = parent.join(&candidate)
            && matches!(stat(hub, &c), Ok(None))
        {
            return candidate;
        }
    }
    format!("{stem} (copy){ext}")
}

/// Reads a local file in blocks, counting bytes; stops (Interrupted) on cancel.
struct Counting<'c, R: Read> {
    inner: R,
    control: &'c Control,
    count: &'c mut dyn FnMut(u64),
}

impl<R: Read> Read for Counting<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.control.is_cancelled() || !self.control.wait_while_paused() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
        let n = self.inner.read(buf)?;
        (self.count)(n as u64);
        Ok(n)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Done,
    Failed,
    Cancelled,
}

struct Run<'a> {
    id: &'a str,
    hub: &'a Hub,
    control: &'a Control,
    rep: Reporter<'a>,
    summary: Summary,
    asker: Asker,
    temp_seq: u64,
}

impl Run<'_> {
    fn fail(&mut self, path: String, error: FsError) {
        self.summary.items_failed += 1;
        let item = ItemError { path, error };
        if self.summary.items_failed <= MAX_LIVE_ERRORS {
            self.rep.item_failed(item.clone());
        }
        if self.summary.errors.len() < MAX_REPORTED_ERRORS {
            self.summary.errors.push(item);
        }
    }

    fn state(&self, state: JobState) {
        self.rep.emit(JobEvent::State {
            id: self.id.to_string(),
            state,
        });
    }

    fn temp_name(&mut self) -> String {
        self.temp_seq += 1;
        format!(".fnf-{}-{}.part", self.id, self.temp_seq)
    }

    fn mkdir(&self, d: &Loc) -> Result<(), FsError> {
        match d {
            Loc::Local(p) => fs::create_dir(p).map_err(|e| FsError::from_io(&e, p)),
            Loc::Remote(r) => self.hub.with(r.profile(), |c| c.mkdir(r.server_path())),
        }
    }

    fn remove_file(&self, d: &Loc) -> Result<(), FsError> {
        match d {
            Loc::Local(p) => fs::remove_file(p).map_err(|e| FsError::from_io(&e, p)),
            Loc::Remote(r) => self
                .hub
                .with(r.profile(), |c| c.remove_file(r.server_path())),
        }
    }

    /// Copies one file `src` → `dst` through a temporary name. `overwrite` = an
    /// existing `dst` is replaced.
    fn copy_file(&mut self, item: &Item, dst: &Loc, overwrite: bool) -> Outcome {
        let parent = match dst.parent() {
            Some(p) => p,
            None => {
                self.fail(
                    dst.display(),
                    FsError::at(FsErrorCode::InvalidPath, "No folder", &dst.display()),
                );
                return Outcome::Failed;
            }
        };
        let tmp_name = self.temp_name();
        let tmp = match parent.join(&tmp_name) {
            Ok(t) => t,
            Err(e) => {
                self.fail(dst.display(), e);
                return Outcome::Failed;
            }
        };
        let r = self.transfer(&item.src, &tmp, item.meta.size);
        match r {
            Ok(true) => {}
            Ok(false) => {
                let _ = self.remove_file(&tmp);
                return Outcome::Cancelled;
            }
            Err(e) => {
                let _ = self.remove_file(&tmp);
                self.fail(item.src.display(), e);
                return Outcome::Failed;
            }
        }
        if let Some(ms) = item.meta.modified_ms {
            let _ = self.set_mtime(&tmp, ms);
        }
        match self.place(&tmp, dst, overwrite) {
            Ok(()) => Outcome::Done,
            Err(e) => {
                let _ = self.remove_file(&tmp);
                self.fail(dst.display(), e);
                Outcome::Failed
            }
        }
    }

    fn set_mtime(&self, d: &Loc, ms: i64) -> Result<(), FsError> {
        match d {
            Loc::Local(p) => {
                let f = fs::File::options()
                    .write(true)
                    .open(p)
                    .map_err(|e| FsError::from_io(&e, p))?;
                let t = UNIX_EPOCH + std::time::Duration::from_millis(ms.max(0) as u64);
                f.set_modified(t).map_err(|e| FsError::from_io(&e, p))
            }
            Loc::Remote(r) => self
                .hub
                .with(r.profile(), |c| c.set_mtime(r.server_path(), ms))
                .map(|_| ()),
        }
    }

    /// Renames the finished temporary file to its name (never replacing unless `overwrite`).
    fn place(&self, tmp: &Loc, dst: &Loc, overwrite: bool) -> Result<(), FsError> {
        match (tmp, dst) {
            (Loc::Local(t), Loc::Local(d)) => {
                if overwrite && fs::symlink_metadata(d).is_ok() {
                    fs::remove_file(d).map_err(|e| FsError::from_io(&e, d))?;
                }
                crate::platform::rename_noreplace(t, d).map_err(|e| FsError::from_io(&e, d))
            }
            (Loc::Remote(t), Loc::Remote(d)) => self.hub.with(d.profile(), |c| {
                if c.stat(d.server_path())?.is_some() {
                    if !overwrite {
                        return Err(FsError::at(
                            FsErrorCode::AlreadyExists,
                            "The target appeared meanwhile",
                            &d.to_string(),
                        ));
                    }
                    c.remove_file(d.server_path())?;
                }
                c.rename(t.server_path(), d.server_path())
            }),
            _ => Err(FsError::at(
                FsErrorCode::InvalidPath,
                "Mixed places",
                &dst.display(),
            )),
        }
    }

    /// Moves the bytes of `src` into the new file `to`. `Ok(false)` = cancelled.
    fn transfer(&mut self, src: &Loc, to: &Loc, size: u64) -> Result<bool, FsError> {
        let control = self.control;
        let rep = &mut self.rep;
        let hub = self.hub;
        match (src, to) {
            (Loc::Local(s), Loc::Remote(t)) => {
                let file = fs::File::open(s).map_err(|e| FsError::from_io(&e, s))?;
                let mut read = 0u64;
                let mut count = |n: u64| {
                    read += n;
                    rep.progress.bytes_done += n;
                    rep.tick(false);
                };
                let mut reader = Counting {
                    inner: io::BufReader::with_capacity(BLOCK, file),
                    control,
                    count: &mut count,
                };
                let r = hub.with_stream(t.profile(), |c| c.write(t.server_path(), &mut reader));
                drop(reader);
                match r {
                    Ok(n) => complete(n, read, t).map(|()| true),
                    Err(_) if control.is_cancelled() => Ok(false),
                    Err(e) => Err(e),
                }
            }
            (Loc::Remote(s), Loc::Local(t)) => {
                let mut file = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(t)
                    .map_err(|e| FsError::from_io(&e, t))?;
                mark_download(hub, s, &file, t);
                let mut sink = |b: &[u8]| -> io::Result<bool> {
                    if control.is_cancelled() || !control.wait_while_paused() {
                        return Ok(false);
                    }
                    file.write_all(b)?;
                    rep.progress.bytes_done += b.len() as u64;
                    rep.tick(false);
                    Ok(true)
                };
                let mut got = 0u64;
                let mut counted = |b: &[u8]| {
                    got += b.len() as u64;
                    sink(b)
                };
                let done =
                    hub.with_stream(s.profile(), |c| c.read(s.server_path(), &mut counted))?;
                if done {
                    received_all(hub, s, size, got)?;
                    file.sync_all().map_err(|e| FsError::from_io(&e, t))?;
                }
                Ok(done)
            }
            (Loc::Remote(s), Loc::Remote(t)) => {
                // through a local temporary file: half of the bytes count per direction
                let local = transfer_temp_path(self.id, self.temp_seq);
                let half = |rep: &mut Reporter<'_>, n: u64| {
                    rep.progress.bytes_done += n / 2;
                    rep.tick(false);
                };
                let result = (|| {
                    let mut file = fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&local)
                        .map_err(|e| FsError::from_io(&e, &local))?;
                    let mut sink = |b: &[u8]| -> io::Result<bool> {
                        if control.is_cancelled() || !control.wait_while_paused() {
                            return Ok(false);
                        }
                        file.write_all(b)?;
                        half(rep, b.len() as u64);
                        Ok(true)
                    };
                    let mut got = 0u64;
                    let mut counted = |b: &[u8]| {
                        got += b.len() as u64;
                        sink(b)
                    };
                    if !hub.with_stream(s.profile(), |c| c.read(s.server_path(), &mut counted))? {
                        return Ok(false);
                    }
                    received_all(hub, s, size, got)?;
                    drop(file);
                    let file = fs::File::open(&local).map_err(|e| FsError::from_io(&e, &local))?;
                    let mut sent = 0u64;
                    let mut count = |n: u64| {
                        sent += n;
                        half(rep, n)
                    };
                    let mut reader = Counting {
                        inner: io::BufReader::with_capacity(BLOCK, file),
                        control,
                        count: &mut count,
                    };
                    let r = hub.with_stream(t.profile(), |c| c.write(t.server_path(), &mut reader));
                    drop(reader);
                    match r {
                        Ok(n) => complete(n, sent, t).map(|()| true),
                        Err(_) if control.is_cancelled() => Ok(false),
                        Err(e) => Err(e),
                    }
                })();
                let _ = fs::remove_file(&local);
                result
            }
            (Loc::Local(_), Loc::Local(_)) => Err(FsError::at(
                FsErrorCode::InvalidPath,
                "Local copies go through the copy job",
                &to.display(),
            )),
        }
    }
}

/// Copy (`moving = false`) or move `sources` into `target_dir`; at least one side is a server.
#[allow(clippy::too_many_arguments)]
pub fn run(
    hub: &Hub,
    id: &str,
    sources: &[String],
    target_dir: &str,
    options: &CopyOptions,
    moving: bool,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut run = Run {
        id,
        hub,
        control,
        rep: Reporter::new(id, emit),
        summary: Summary::default(),
        asker: Asker::new(options.conflict_default.decision()),
        temp_seq: 0,
    };
    let failed = |run: Run<'_>, e: FsError| {
        let mut s = run.summary;
        s.error = Some(e);
        (JobState::Failed, s)
    };
    run.state(JobState::Planning);
    let target = match Loc::parse(target_dir) {
        Ok(t) => t,
        Err(e) => return failed(run, e),
    };
    match stat(hub, &target) {
        Ok(Some(m)) if m.kind == EntryKind::Directory => {}
        Ok(_) => {
            return failed(
                run,
                FsError::at(
                    FsErrorCode::NotADirectory,
                    "The target is no folder",
                    target_dir,
                ),
            );
        }
        Err(e) => return failed(run, e),
    }
    // top-level pairs
    let mut tops: Vec<(Loc, Loc, Meta)> = Vec::new();
    let mut srcs: Vec<Loc> = Vec::new();
    for s in sources {
        match Loc::parse(s) {
            Ok(l) => srcs.push(l),
            Err(e) => return failed(run, e),
        }
    }
    // nested sources: the outer one brings the inner along
    let all = srcs.clone();
    srcs.retain(|s| !all.iter().any(|o| o != s && s.starts_with(o)));
    for (i, src) in srcs.iter().enumerate() {
        let name = match (srcs.len(), options.rename_to.as_deref(), src.name()) {
            (1, Some(n), _) => n.to_string(),
            (_, _, Some(n)) => n,
            _ => {
                return failed(
                    run,
                    FsError::at(
                        FsErrorCode::InvalidPath,
                        "A root cannot be copied",
                        &src.display(),
                    ),
                );
            }
        };
        let dst = match target.join(&name) {
            Ok(d) => d,
            Err(e) => return failed(run, e),
        };
        if dst == *src {
            return failed(
                run,
                FsError::at(
                    FsErrorCode::SameSourceTarget,
                    "Source and target are the same",
                    &src.display(),
                ),
            );
        }
        if dst.starts_with(src) {
            return failed(
                run,
                FsError::at(
                    FsErrorCode::TargetInsideSource,
                    "The target lies inside the source",
                    &src.display(),
                ),
            );
        }
        match stat(hub, src) {
            Ok(Some(m)) => tops.push((src.clone(), dst, m)),
            Ok(None) => run.fail(
                src.display(),
                FsError::at(FsErrorCode::NotFound, "Not found", &src.display()),
            ),
            Err(e) => run.fail(src.display(), e),
        }
        let _ = i;
    }
    // moving on one server: rename whole entries whose target name is free
    let mut rest = Vec::new();
    for (src, dst, m) in tops {
        if control.is_cancelled() {
            run.rep.flush_dirs();
            return (JobState::Cancelled, run.summary);
        }
        if moving
            && let (Loc::Remote(s), Loc::Remote(d)) = (&src, &dst)
            && s.profile() == d.profile()
            && matches!(stat(hub, &dst), Ok(None))
        {
            match hub.with(s.profile(), |c| c.rename(s.server_path(), d.server_path())) {
                Ok(()) => {
                    run.summary.items_done += 1;
                    for p in [src.parent(), dst.parent()].into_iter().flatten() {
                        run.rep.dir_changed(p.display());
                    }
                    continue;
                }
                Err(e) => {
                    run.fail(src.display(), e);
                    continue;
                }
            }
        }
        rest.push((src, dst, m));
    }
    let mut plan = Plan::default();
    if !walk(hub, &rest, &mut plan, control) {
        run.rep.flush_dirs();
        return (JobState::Cancelled, run.summary);
    }
    run.summary.items_failed += plan.more_errors;
    for e in std::mem::take(&mut plan.errors) {
        run.fail(e.path, e.error);
    }
    run.rep.progress.bytes_total = plan.bytes;
    run.rep.progress.items_total = plan.items.len() as u64 + run.summary.items_done;
    run.rep.progress.items_done = run.summary.items_done;
    run.state(if control.is_paused() {
        JobState::Paused
    } else {
        JobState::Running
    });
    run.rep.tick(true);

    let mut failed_dirs: Vec<Loc> = Vec::new();
    let mut placed_dirs: Vec<Loc> = Vec::new();
    let mut failed_tops = vec![false; rest.len()];
    let mut cancelled = false;
    'items: for item in &plan.items {
        if control.is_cancelled() || !control.wait_while_paused() {
            cancelled = true;
            break;
        }
        run.rep.progress.current = Some(item.src.display());
        let size = if item.meta.kind == EntryKind::File {
            item.meta.size
        } else {
            0
        };
        if failed_dirs.iter().any(|d| item.dst.starts_with(d)) {
            run.summary.items_skipped += 1;
            run.rep.progress.items_done += 1;
            run.rep.progress.bytes_done += size;
            failed_tops[item.top] = true;
            continue;
        }
        if let Some(p) = item.dst.parent() {
            run.rep.dir_changed(p.display());
        }
        if moving && let Some(p) = item.src.parent() {
            run.rep.dir_changed(p.display());
        }
        if item.meta.kind == EntryKind::Directory {
            match stat(hub, &item.dst) {
                Ok(Some(m)) if m.kind == EntryKind::Directory => {
                    run.summary.items_done += 1;
                    placed_dirs.push(item.src.clone());
                }
                Ok(Some(_)) => {
                    run.fail(
                        item.dst.display(),
                        FsError::at(
                            FsErrorCode::NotADirectory,
                            "A file with this name exists",
                            &item.dst.display(),
                        ),
                    );
                    failed_dirs.push(item.dst.clone());
                    failed_tops[item.top] = true;
                }
                Ok(None) => match run.mkdir(&item.dst) {
                    Ok(()) => {
                        run.summary.items_done += 1;
                        placed_dirs.push(item.src.clone());
                    }
                    Err(e) => {
                        run.fail(item.dst.display(), e);
                        failed_dirs.push(item.dst.clone());
                        failed_tops[item.top] = true;
                    }
                },
                Err(e) => {
                    run.fail(item.dst.display(), e);
                    failed_dirs.push(item.dst.clone());
                    failed_tops[item.top] = true;
                }
            }
            run.rep.progress.items_done += 1;
            run.rep.tick(false);
            continue;
        }
        // a file: conflict?
        let mut dst = item.dst.clone();
        let mut overwrite = false;
        match stat(hub, &dst) {
            Ok(None) => {}
            Ok(Some(tm)) => {
                let src_display = item.src.display();
                let target_display = dst.display();
                let suggestion = || suggest(hub, &item.dst);
                let decision = run.asker.ask_meta(
                    id,
                    control,
                    &run.rep,
                    &src_display,
                    item.meta.file_meta(),
                    &target_display,
                    tm.file_meta(),
                    suggestion,
                );
                let Some(decision) = decision else {
                    cancelled = true;
                    break 'items;
                };
                match decision {
                    Decision::Skip => {
                        run.summary.items_skipped += 1;
                        run.rep.progress.items_done += 1;
                        run.rep.progress.bytes_done += size;
                        failed_tops[item.top] = true;
                        continue 'items;
                    }
                    Decision::Overwrite => overwrite = true,
                    Decision::OverwriteIfNewer => {
                        if item.meta.modified_ms.unwrap_or(0) > tm.modified_ms.unwrap_or(0) {
                            overwrite = true;
                        } else {
                            run.summary.items_skipped += 1;
                            run.rep.progress.items_done += 1;
                            run.rep.progress.bytes_done += size;
                            failed_tops[item.top] = true;
                            continue 'items;
                        }
                    }
                    Decision::Rename { new_name } => {
                        let name = new_name.unwrap_or_else(|| suggest(hub, &item.dst));
                        let joined = dst
                            .parent()
                            .ok_or_else(|| {
                                FsError::at(FsErrorCode::InvalidName, "Invalid name", &name)
                            })
                            .and_then(|p| p.join(&name));
                        match joined {
                            Ok(d) => dst = d,
                            Err(e) => {
                                run.fail(item.dst.display(), e);
                                run.rep.progress.items_done += 1;
                                run.rep.progress.bytes_done += size;
                                failed_tops[item.top] = true;
                                continue 'items;
                            }
                        }
                    }
                    Decision::Cancel => {
                        control.cancel();
                        cancelled = true;
                        break 'items;
                    }
                }
            }
            Err(e) => {
                run.fail(dst.display(), e);
                run.rep.progress.items_done += 1;
                run.rep.progress.bytes_done += size;
                failed_tops[item.top] = true;
                continue;
            }
        }
        let before = run.rep.progress.bytes_done;
        let outcome = run.copy_file(item, &dst, overwrite);
        if outcome == Outcome::Cancelled {
            cancelled = true;
            break;
        }
        run.rep.progress.bytes_done = before + size;
        if outcome == Outcome::Done {
            if moving {
                if let Err(e) = run.remove_file(&item.src) {
                    run.fail(item.src.display(), e);
                    failed_tops[item.top] = true;
                } else {
                    run.summary.items_done += 1;
                }
            } else {
                run.summary.items_done += 1;
            }
        } else {
            failed_tops[item.top] = true;
        }
        run.rep.progress.items_done += 1;
        run.rep.tick(false);
    }
    if moving && !cancelled {
        // emptied source folders go, deepest first (only those that arrived at the target)
        for item in plan.items.iter().rev() {
            if item.meta.kind == EntryKind::Directory && placed_dirs.contains(&item.src) {
                let _ = match &item.src {
                    Loc::Local(p) => fs::remove_dir(p).map_err(|e| FsError::from_io(&e, p)),
                    Loc::Remote(r) => hub.with(r.profile(), |c| c.remove_dir(r.server_path())),
                };
            }
        }
    }
    let _ = failed_tops;
    run.rep.progress.current = None;
    run.summary.bytes_done = run.rep.progress.bytes_done;
    run.rep.tick(true);
    run.rep.flush_dirs();
    let state = if cancelled || control.is_cancelled() {
        JobState::Cancelled
    } else if run.summary.items_failed > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    (state, run.summary)
}

/// Size of a server folder (recursive listing, no links followed).
pub fn remote_size(
    hub: &Hub,
    path: &RemotePath,
    control: &Control,
    report: &mut dyn FnMut(&DirSize),
) -> DirSize {
    let mut total = DirSize::default();
    let mut stack = vec![path.clone()];
    let mut last = std::time::Instant::now();
    while let Some(dir) = stack.pop() {
        if control.is_cancelled() {
            total.cancelled = true;
            break;
        }
        let listing = match hub.with(dir.profile(), |c: &mut dyn RemoteFs| {
            c.list(dir.server_path())
        }) {
            Ok(l) => l,
            Err(_) => {
                total.unreadable += 1;
                continue;
            }
        };
        total.unreadable += listing.unreadable as u64;
        for e in listing.entries {
            match e.kind {
                EntryKind::Directory => {
                    total.dirs += 1;
                    match dir.join(&e.name) {
                        Ok(d) => stack.push(d),
                        Err(_) => total.unreadable += 1,
                    }
                }
                EntryKind::File => {
                    total.files += 1;
                    total.bytes += e.size.unwrap_or(0);
                }
                _ => total.files += 1,
            }
        }
        if last.elapsed() >= std::time::Duration::from_millis(100) {
            report(&total);
            last = std::time::Instant::now();
        }
    }
    total
}

/// What the panel showed is still there (design 030 E5) – for server entries.
pub fn changed_remote(
    hub: &Hub,
    path: &str,
    expected: &super::expect::ExpectedEntry,
) -> Option<String> {
    let loc = Loc::parse(path).ok()?;
    let now = stat(hub, &loc).ok()??;
    if now.kind != expected.kind {
        return Some("it is another kind of entry now".into());
    }
    if now.kind == EntryKind::File {
        if expected.size.is_some() && Some(now.size) != expected.size {
            return Some("its size changed".into());
        }
        if expected.modified_ms.is_some() && now.modified_ms != expected.modified_ms {
            return Some("it was modified".into());
        }
    }
    None
}

/// Splits server `paths` into the ones still as shown and the changed ones.
pub fn filter_remote(
    hub: &Hub,
    paths: Vec<String>,
    expected: &[super::expect::ExpectedEntry],
    control: &Control,
) -> (Vec<String>, Vec<ItemError>) {
    if expected.is_empty() {
        return (paths, Vec::new());
    }
    let mut keep = Vec::new();
    let mut skipped = Vec::new();
    for p in paths {
        if control.is_cancelled() {
            keep.push(p);
            continue;
        }
        match expected
            .iter()
            .find(|e| e.path == p)
            .and_then(|e| changed_remote(hub, &p, e))
        {
            Some(why) => skipped.push(ItemError {
                error: FsError::at(
                    FsErrorCode::ChangedSinceListing,
                    format!("Left alone: {why} since the panel listed it"),
                    &p,
                ),
                path: p,
            }),
            None => keep.push(p),
        }
    }
    (keep, skipped)
}

/// Files from a server are "downloaded from the internet" for the OS (Gatekeeper,
/// SmartScreen, Office protected view) – like files from a marked archive (025).
fn mark_download(hub: &Hub, src: &RemotePath, file: &fs::File, path: &Path) {
    if let Ok(p) = hub.profile(src.profile()) {
        let mark = crate::platform::origin_mark::downloaded(&p.origin_url());
        crate::platform::origin_mark::apply_open(file, path, &mark);
    }
}

/// The server took fewer (or more) bytes than were read: never treated as done – a move
/// would delete the source of a truncated copy (review 034 #1).
fn complete(written: u64, read: u64, to: &RemotePath) -> Result<(), FsError> {
    if written == read {
        Ok(())
    } else {
        Err(FsError::at(
            FsErrorCode::RemoteConnectionLost,
            format!("Incomplete upload ({written} of {read} bytes)"),
            &to.to_string(),
        ))
    }
}

/// A download whose length differs from the planned size counts only when the server
/// now reports exactly that length (the file changed before the transfer started).
fn received_all(hub: &Hub, src: &RemotePath, planned: u64, got: u64) -> Result<(), FsError> {
    if got == planned {
        return Ok(());
    }
    let now = hub.with(src.profile(), |c| c.stat(src.server_path()))?;
    if now.and_then(|m| m.size) == Some(got) {
        Ok(())
    } else {
        Err(changed(src))
    }
}

/// A file of a server in a local file (view cache): exactly `size` bytes when the server
/// reported a size, never more than `max`. More stops the download (a hostile or growing
/// file cannot fill the disk, review 034 #7), less is an error. `Ok(false)` = cancelled.
pub fn download(
    hub: &Hub,
    src: &RemotePath,
    to: &Path,
    size: Option<u64>,
    max: u64,
    control: &Control,
    progress: &mut dyn FnMut(u64),
) -> Result<bool, FsError> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)
        .map_err(|e| FsError::from_io(&e, to))?;
    mark_download(hub, src, &file, to);
    let limit = size.map_or(max, |s| s.min(max));
    let mut got = 0u64;
    let mut sink = |b: &[u8]| -> io::Result<bool> {
        if control.is_cancelled() {
            return Ok(false);
        }
        got += b.len() as u64;
        if got > limit {
            return Err(io::Error::other("larger than reported"));
        }
        file.write_all(b)?;
        progress(b.len() as u64);
        Ok(true)
    };
    let done = hub
        .with_stream(src.profile(), |c| c.read(src.server_path(), &mut sink))
        .map_err(|e| changed_or(e, got > limit, src))?;
    if done && size.is_some_and(|s| s != got) {
        return Err(changed(src));
    }
    Ok(done)
}

/// The file on the server is not the size it had a moment ago.
fn changed(src: &RemotePath) -> FsError {
    FsError::at(
        FsErrorCode::ChangedSinceListing,
        "The file changed on the server during the transfer",
        &src.to_string(),
    )
}

fn changed_or(e: FsError, is_changed: bool, src: &RemotePath) -> FsError {
    if is_changed { changed(src) } else { e }
}

/// The local temporary file of a server → server transfer. Job ids are unique only per
/// `JobManager`, so a process-wide counter keeps two managers (parallel tests) apart.
fn transfer_temp_path(job: &str, seq: u64) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "fnf-transfer-{}-{}-{}-{}",
        std::process::id(),
        job,
        seq,
        n
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_temp_paths_never_repeat_for_the_same_job_id() {
        // job ids are only unique per JobManager (j1, j2, …): two managers in one process
        // (parallel tests) once shared a temporary file and broke each other's transfers
        let a = transfer_temp_path("j6", 0);
        let b = transfer_temp_path("j6", 0);
        assert_ne!(a, b);
    }
}
