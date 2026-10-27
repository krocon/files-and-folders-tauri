//! Jobs that change an archive (design 035): add files and folders (copy or move into it),
//! delete entries, create a folder. Every job rewrites the archive into a temporary file
//! next to it (`archive::write`), reads that back, checks that the original did not change
//! meanwhile and replaces it atomically – a cancel or an error leaves the original as it was.

use super::ask::Asker;
use super::copy::{self, ItemKind, Plan, Top};
use super::report::Reporter;
use super::{
    Control, CopyOptions, Decision, FileMeta, ItemError, JobEvent, JobState, MAX_REPORTED_ERRORS,
    Summary,
};
use crate::archive::write::{self, Change, Fail, NewEntry};
use crate::archive::{self, ArchiveFormat, ArchiveIndex, EntryType};
use crate::error::{FsError, FsErrorCode};
use crate::paths::{normalize_lexically, validate_name};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

/// What the job does.
pub enum Op<'a> {
    Add {
        sources: &'a [String],
        target_dir: &'a str,
        options: &'a CopyOptions,
        move_sources: bool,
    },
    Delete {
        paths: &'a [String],
    },
    Mkdir {
        parent: &'a str,
        name: &'a str,
    },
}

/// Archives being written now (design 035 E2).
fn locks() -> &'static Mutex<HashSet<PathBuf>> {
    static L: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(HashSet::new()))
}

struct Lock(PathBuf);

impl Lock {
    fn take(archive: &Path) -> Result<Lock, FsError> {
        // one key for every alias of the file (case, linked parent folder – review 035 #10)
        let key = fs::canonicalize(archive).unwrap_or_else(|_| archive.to_path_buf());
        let mut l = locks().lock().unwrap_or_else(|e| e.into_inner());
        if !l.insert(key.clone()) {
            return Err(FsError::new(
                FsErrorCode::ArchiveBusy,
                "Another task changes this archive right now",
                Some(archive),
            ));
        }
        Ok(Lock(key))
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        locks()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.0);
    }
}

/// `(archive, inner)` of a virtual path (or of the archive itself).
pub fn split(path: &str) -> Result<(PathBuf, Vec<String>), FsError> {
    let p = normalize_lexically(Path::new(path));
    archive::resolve(&p).ok_or_else(|| {
        FsError::new(
            FsErrorCode::NotADirectory,
            "Not inside an archive",
            Some(&p),
        )
    })
}

/// The archive every path of a job lies in (all the same one).
pub fn archive_of(paths: &[&str]) -> Result<PathBuf, FsError> {
    let mut archive: Option<PathBuf> = None;
    for p in paths {
        let (a, _) = split(p)?;
        match &archive {
            Some(x) if *x != a => {
                return Err(FsError::new(
                    FsErrorCode::InvalidPath,
                    "The entries lie in different archives",
                    Some(&a),
                ));
            }
            _ => archive = Some(a),
        }
    }
    archive.ok_or_else(|| FsError::new(FsErrorCode::InvalidPath, "Nothing selected", None))
}

/// Size + modification time + identity: the original must not change while it is rewritten.
type Stamp = (u64, Option<SystemTime>, Option<(u64, u64)>);

fn stamp(p: &Path) -> Option<Stamp> {
    let m = fs::symlink_metadata(p).ok()?;
    Some((
        m.len(),
        m.modified().ok(),
        crate::platform::file_identity(p).map(|i| i.id),
    ))
}

/// The kind of what is at `name` in the archive: an explicit entry, or a folder implied by
/// deeper entries; `None` = nothing.
fn kind_at(index: &ArchiveIndex, name: &[String]) -> Option<EntryType> {
    let mut implied = false;
    for e in &index.entries {
        if e.name == name {
            return Some(e.kind);
        }
        if e.name.len() > name.len() && e.name.starts_with(name) {
            implied = true;
        }
    }
    implied.then_some(EntryType::Dir)
}

fn entry_meta(index: &ArchiveIndex, name: &[String]) -> FileMeta {
    let e = index.entries.iter().find(|e| e.name == name);
    FileMeta {
        size: e.filter(|e| e.kind != EntryType::Dir).map(|e| e.size),
        modified_ms: e.and_then(|e| e.modified_ms),
        is_dir: e.is_none_or(|e| e.kind == EntryType::Dir),
    }
}

/// A free `name (1).ext` among the names in folder `dir` of the archive (and the new ones).
fn free_name(taken: &HashSet<Vec<String>>, dir: &[String], name: &str) -> String {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1..10_000 {
        let candidate = format!("{stem} ({n}){ext}");
        let mut full = dir.to_vec();
        full.push(candidate.clone());
        if !taken.contains(&full) {
            return candidate;
        }
    }
    format!("{stem} (copy){ext}")
}

struct Ctx<'a> {
    id: &'a str,
    rep: Reporter<'a>,
    summary: Summary,
}

impl Ctx<'_> {
    fn fail(&mut self, path: &Path, error: FsError) {
        self.summary.items_failed += 1;
        let item = ItemError {
            path: path.to_string_lossy().into_owned(),
            error,
        };
        if self.summary.items_failed <= 100 {
            self.rep.item_failed(item.clone());
        }
        if self.summary.errors.len() < MAX_REPORTED_ERRORS {
            self.summary.errors.push(item);
        }
    }
    fn state(&self, s: JobState) {
        self.rep.emit(JobEvent::State {
            id: self.id.to_string(),
            state: s,
        });
    }
}

/// A planned source of an add job (for moving: removed after the archive was replaced).
struct Added {
    src: PathBuf,
    /// Identity, size and mtime when it was planned: only that exact file is removed.
    stamp: Option<Stamp>,
    dir: bool,
}

#[allow(clippy::too_many_arguments)]
fn plan_add(
    ctx: &mut Ctx<'_>,
    index: &ArchiveIndex,
    archive_path: &Path,
    inner: &[String],
    sources: &[String],
    options: &CopyOptions,
    control: &Control,
    change: &mut Change,
    added: &mut Vec<Added>,
) -> Result<bool, FsError> {
    // the target folder must be in the archive (or be its root)
    if !inner.is_empty() && kind_at(index, inner) != Some(EntryType::Dir) {
        return Err(FsError::new(
            FsErrorCode::NotFound,
            "This folder is not in the archive",
            Some(&archive::virtual_path(archive_path, inner)),
        ));
    }
    let mut plan = Plan::default();
    let mut tops = Vec::new();
    for s in super::drop_nested(&sources.iter().map(PathBuf::from).collect::<Vec<_>>()) {
        let src = normalize_lexically(&s);
        // the archive into itself, or a folder that holds the archive (review 035 #2)
        if src.starts_with(archive_path) || archive_path.starts_with(&src) {
            return Err(FsError::new(
                FsErrorCode::TargetInsideSource,
                "An archive cannot be added to itself",
                Some(&src),
            ));
        }
        let Some(name) = src.file_name().map(|n| n.to_os_string()) else {
            return Err(FsError::new(
                FsErrorCode::InvalidPath,
                "A drive or root cannot be added",
                Some(&src),
            ));
        };
        match fs::symlink_metadata(&src) {
            Ok(meta) => tops.push(Top {
                src,
                dst: PathBuf::from(name),
                meta,
            }),
            Err(e) => ctx.fail(&src, FsError::from_io(&e, &src)),
        }
    }
    if !copy::walk(tops, &mut plan, control) {
        return Ok(false);
    }
    ctx.summary.items_failed += plan.more_errors;
    for e in std::mem::take(&mut plan.errors) {
        let p = PathBuf::from(&e.path);
        ctx.fail(&p, e.error);
    }
    let mut taken: HashSet<Vec<String>> = index.entries.iter().map(|e| e.name.clone()).collect();
    let mut asker = Asker::new(options.conflict_default.decision());
    // folders renamed by a conflict answer: their content follows
    let mut moved: HashMap<PathBuf, Vec<String>> = HashMap::new();
    let mut failed_dirs: Vec<PathBuf> = Vec::new();
    'items: for item in &plan.items {
        if control.is_cancelled() {
            return Ok(false);
        }
        if failed_dirs.iter().any(|d| item.src.starts_with(d)) {
            ctx.summary.items_skipped += 1;
            continue;
        }
        // the name inside the archive: target folder + relative path (each part checked)
        let mut name: Vec<String> = inner.to_vec();
        let rel_parent = item.dst.parent().map(Path::to_path_buf).unwrap_or_default();
        if let Some(base) = moved.get(&rel_parent) {
            name = base.clone();
        } else {
            for c in rel_parent.components() {
                let Some(s) = c.as_os_str().to_str() else {
                    ctx.fail(
                        &item.src,
                        FsError::new(
                            FsErrorCode::InvalidName,
                            "The name is not valid UTF-8 – not added",
                            Some(&item.src),
                        ),
                    );
                    continue 'items;
                };
                name.push(s.to_string());
            }
        }
        let Some(leaf) = item.dst.file_name().and_then(|n| n.to_str()) else {
            ctx.fail(
                &item.src,
                FsError::new(
                    FsErrorCode::InvalidName,
                    "The name is not valid UTF-8 – not added",
                    Some(&item.src),
                ),
            );
            continue;
        };
        if let Err(e) = validate_name(leaf) {
            ctx.fail(&item.src, e);
            continue;
        }
        // a name the archive reader would refuse (`:`, control characters) fails alone (#8)
        let mut probe = name.clone();
        probe.push(leaf.to_string());
        if archive::sanitize(&probe.join("/")).ok().as_ref() != Some(&probe) {
            ctx.fail(
                &item.src,
                FsError::new(
                    FsErrorCode::InvalidName,
                    "The name is not allowed in an archive",
                    Some(&item.src),
                ),
            );
            continue;
        }
        let mut leaf = leaf.to_string();
        let meta = match fs::symlink_metadata(&item.src) {
            Ok(m) => m,
            Err(e) => {
                ctx.fail(&item.src, FsError::from_io(&e, &item.src));
                continue;
            }
        };
        let mode = mode_of(&meta);
        let modified = meta.modified().ok();
        match item.kind {
            ItemKind::Symlink => {
                ctx.fail(
                    &item.src,
                    FsError::new(
                        FsErrorCode::NotAFile,
                        "Links are not added to archives",
                        Some(&item.src),
                    ),
                );
                continue;
            }
            ItemKind::Dir => {
                let mut full = name.clone();
                full.push(leaf.clone());
                match kind_at(index, &full) {
                    Some(EntryType::Dir) => {} // merge into the existing folder
                    Some(_) if !change.removes(&full) => {
                        ctx.fail(
                            &item.src,
                            FsError::new(
                                FsErrorCode::NotADirectory,
                                "A file with this name is in the archive",
                                Some(&item.src),
                            ),
                        );
                        failed_dirs.push(item.src.clone());
                        continue;
                    }
                    _ => {
                        change.add.push(NewEntry {
                            name: full.clone(),
                            source: None,
                            len: 0,
                            mode,
                            modified,
                        });
                        taken.insert(full.clone());
                    }
                }
                moved.insert(item.dst.clone(), full);
                added.push(Added {
                    src: item.src.clone(),
                    stamp: None,
                    dir: true,
                });
                ctx.summary.items_done += 1;
            }
            ItemKind::File { size } => {
                loop {
                    let mut full = name.clone();
                    full.push(leaf.clone());
                    let existing = kind_at(index, &full)
                        .filter(|_| !change.removes(&full))
                        .or_else(|| {
                            // added in this job already (two sources of one name)
                            change
                                .add
                                .iter()
                                .any(|a| a.name == full)
                                .then_some(EntryType::File)
                        });
                    match existing {
                        None => {
                            change.add.push(NewEntry {
                                name: full.clone(),
                                source: Some(item.src.clone()),
                                len: size,
                                mode,
                                modified,
                            });
                            taken.insert(full);
                            added.push(Added {
                                src: item.src.clone(),
                                stamp: stamp(&item.src),
                                dir: false,
                            });
                            ctx.summary.items_done += 1;
                            break;
                        }
                        Some(EntryType::Dir) => {
                            ctx.fail(
                                &item.src,
                                FsError::new(
                                    FsErrorCode::NotAFile,
                                    "A folder with this name is in the archive",
                                    Some(&item.src),
                                ),
                            );
                            break;
                        }
                        Some(_) => {
                            let target = archive::virtual_path(archive_path, &full);
                            let source_meta = super::ask::meta_of(&meta);
                            let tmeta = entry_meta(index, &full);
                            let suggested = free_name(&taken, &name, &leaf);
                            let answer = asker.ask_meta(
                                ctx.id,
                                control,
                                &ctx.rep,
                                &item.src.to_string_lossy(),
                                source_meta,
                                &target.to_string_lossy(),
                                tmeta.clone(),
                                || suggested.clone(),
                            );
                            match answer {
                                None => return Ok(false),
                                Some(Decision::Overwrite) => {
                                    change.remove.push(full.clone());
                                    continue;
                                }
                                Some(Decision::OverwriteIfNewer) => {
                                    let newer = modified
                                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                        .map(|d| d.as_millis() as i64)
                                        > tmeta.modified_ms;
                                    if newer {
                                        change.remove.push(full.clone());
                                        continue;
                                    }
                                    ctx.summary.items_skipped += 1;
                                    break;
                                }
                                Some(Decision::Skip) => {
                                    ctx.summary.items_skipped += 1;
                                    break;
                                }
                                Some(Decision::Rename { new_name }) => {
                                    let n = new_name.unwrap_or(suggested);
                                    if let Err(e) = validate_name(&n) {
                                        ctx.fail(&item.src, e);
                                        break;
                                    }
                                    leaf = n;
                                    continue;
                                }
                                Some(Decision::Cancel) => {
                                    control.cancel();
                                    return Ok(false);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(true)
}

fn mode_of(m: &fs::Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        m.permissions().mode() & 0o777
    }
    #[cfg(not(unix))]
    {
        if m.is_dir() {
            0o755
        } else if m.permissions().readonly() {
            0o444
        } else {
            0o644
        }
    }
}

/// The names the rewritten archive must hold.
fn expected_names(index: &ArchiveIndex, change: &Change) -> HashSet<Vec<String>> {
    let mut out: HashSet<Vec<String>> = index
        .entries
        .iter()
        .filter(|e| !change.removes(&e.name))
        .map(|e| e.name.clone())
        .collect();
    out.extend(change.add.iter().map(|a| a.name.clone()));
    out
}

pub fn run(
    id: &str,
    op: Op<'_>,
    control: &Control,
    emit: &(dyn Fn(JobEvent) + Send + Sync),
) -> (JobState, Summary) {
    let mut ctx = Ctx {
        id,
        rep: Reporter::new(id, emit),
        summary: Summary::default(),
    };
    ctx.state(JobState::Planning);
    macro_rules! failed {
        ($e:expr) => {{
            ctx.summary.error = Some($e);
            return (JobState::Failed, ctx.summary);
        }};
    }
    let archive_path = match &op {
        Op::Add { target_dir, .. } => archive_of(&[target_dir]),
        Op::Delete { paths } => archive_of(&paths.iter().map(String::as_str).collect::<Vec<_>>()),
        Op::Mkdir { parent, .. } => archive_of(&[parent]),
    };
    let archive_path = match archive_path {
        Ok(a) => a,
        Err(e) => failed!(e),
    };
    let _lock = match Lock::take(&archive_path) {
        Ok(l) => l,
        Err(e) => failed!(e),
    };
    let before = stamp(&archive_path);
    let index = match write::writable(&archive_path) {
        Ok(i) => i,
        Err(e) => failed!(e),
    };
    let mut change = Change::default();
    let mut added: Vec<Added> = Vec::new();
    let mut dirs_changed: Vec<PathBuf> = vec![];
    let mut move_sources = false;
    match &op {
        Op::Add {
            target_dir,
            sources,
            options,
            move_sources: mv,
        } => {
            move_sources = *mv;
            let (_, inner) = match split(target_dir) {
                Ok(x) => x,
                Err(e) => failed!(e),
            };
            dirs_changed.push(archive::virtual_path(&archive_path, &inner));
            match plan_add(
                &mut ctx,
                &index,
                &archive_path,
                &inner,
                sources,
                options,
                control,
                &mut change,
                &mut added,
            ) {
                Ok(true) => {}
                Ok(false) => return (JobState::Cancelled, ctx.summary),
                Err(e) => failed!(e),
            }
        }
        Op::Delete { paths } => {
            for p in *paths {
                let (_, inner) = match split(p) {
                    Ok(x) => x,
                    Err(e) => failed!(e),
                };
                if inner.is_empty() {
                    failed!(FsError::new(
                        FsErrorCode::InvalidPath,
                        "The archive itself is not an entry",
                        Some(Path::new(p)),
                    ));
                }
                if kind_at(&index, &inner).is_none() {
                    ctx.fail(
                        Path::new(p),
                        FsError::new(
                            FsErrorCode::NotFound,
                            "Not in the archive",
                            Some(Path::new(p)),
                        ),
                    );
                    continue;
                }
                let parent = archive::virtual_path(&archive_path, &inner[..inner.len() - 1]);
                if !dirs_changed.contains(&parent) {
                    dirs_changed.push(parent);
                }
                change.remove.push(inner);
                ctx.summary.items_done += 1;
            }
        }
        Op::Mkdir { parent, name } => {
            let (_, mut inner) = match split(parent) {
                Ok(x) => x,
                Err(e) => failed!(e),
            };
            if let Err(e) = validate_name(name) {
                failed!(e);
            }
            if !inner.is_empty() && kind_at(&index, &inner) != Some(EntryType::Dir) {
                failed!(FsError::new(
                    FsErrorCode::NotFound,
                    "This folder is not in the archive",
                    Some(Path::new(parent)),
                ));
            }
            dirs_changed.push(archive::virtual_path(&archive_path, &inner));
            inner.push(name.to_string());
            if kind_at(&index, &inner).is_some() {
                failed!(FsError::new(
                    FsErrorCode::AlreadyExists,
                    "An entry with this name is in the archive",
                    Some(&archive::virtual_path(&archive_path, &inner)),
                ));
            }
            change.add.push(NewEntry {
                name: inner,
                source: None,
                len: 0,
                mode: 0o755,
                modified: Some(SystemTime::now()),
            });
            ctx.summary.items_done += 1;
        }
    }
    if change.add.is_empty() && change.remove.is_empty() {
        let state = if ctx.summary.items_failed > 0 {
            JobState::DoneWithErrors
        } else {
            JobState::Done
        };
        return (state, ctx.summary);
    }
    // new files into an encrypted ZIP: with the known password (AES-256, design 035 E4)
    let adds_files = change.add.iter().any(|a| a.source.is_some());
    let password = if adds_files && index.encrypted && index.format == ArchiveFormat::Zip {
        match archive::secrets::get(&archive_path) {
            Some(p) => Some(p),
            None => failed!(FsError::new(
                FsErrorCode::ArchivePasswordRequired,
                "The archive is encrypted – enter its password first",
                Some(&archive_path),
            )),
        }
    } else {
        None
    };

    // rewrite into a temporary file next to the archive
    ctx.rep.progress.bytes_total = write::work_total(&index, &change);
    ctx.rep.progress.items_total = (change.add.len() + change.remove.len()) as u64;
    ctx.rep.progress.current = Some(archive_path.to_string_lossy().into_owned());
    ctx.state(JobState::Running);
    ctx.rep.tick(true);
    let dir = archive_path.parent().unwrap_or(Path::new("."));
    let tmp = dir.join(format!(".fnf-{id}.part"));
    let result = {
        let rep = &mut ctx.rep;
        let mut tick = |n: u64| {
            if control.is_cancelled() || !control.wait_while_paused() {
                return false;
            }
            rep.progress.bytes_done += n;
            rep.tick(false);
            true
        };
        write::rewrite(
            &archive_path,
            index.format,
            &change,
            password.as_ref(),
            &tmp,
            &mut tick,
        )
    };
    let fail_tmp = |e: FsError, mut summary: Summary| {
        let _ = fs::remove_file(&tmp);
        summary.error = Some(e);
        (JobState::Failed, summary)
    };
    match result {
        Ok(()) => {}
        Err(Fail::Cancelled) => {
            let _ = fs::remove_file(&tmp);
            ctx.rep.tick(true);
            return (JobState::Cancelled, ctx.summary);
        }
        Err(Fail::Error(e)) => return fail_tmp(e, ctx.summary),
    }
    // read it back: exactly the expected names (design 035 E2 step 5)
    let deadline = std::time::Instant::now() + archive::INDEX_TIME;
    let check = archive::read_index_as(&tmp, index.format, deadline).and_then(|new| {
        let got: HashSet<Vec<String>> = new.entries.iter().map(|e| e.name.clone()).collect();
        if got != expected_names(&index, &change) || new.unsafe_entries > 0 {
            Err(archive::archive_error(
                "The rewritten archive does not hold what was planned – the original stays",
                &archive_path,
            ))
        } else {
            Ok(())
        }
    });
    // ZIP: every kept entry is still what it was – CRC, size, encryption (review 035 #1)
    let check = check.and_then(|()| {
        if index.format != ArchiveFormat::Zip {
            return Ok(());
        }
        let old = write::zip_fingerprints(&archive_path)?;
        let new = write::zip_fingerprints(&tmp)?;
        let added: HashSet<String> = change.add.iter().map(|a| a.name.join("/")).collect();
        let lost = old.iter().any(|(name, fp)| {
            let comps = archive::sanitize(name).unwrap_or_default();
            !change.removes(&comps)
                && !added.contains(&comps.join("/"))
                && new.get(name) != Some(fp)
        });
        if lost {
            Err(archive::archive_error(
                "An entry would change while it is copied – the original stays",
                &archive_path,
            ))
        } else {
            Ok(())
        }
    });
    if let Err(e) = check {
        return fail_tmp(e, ctx.summary);
    }
    if control.is_cancelled() {
        let _ = fs::remove_file(&tmp);
        return (JobState::Cancelled, ctx.summary);
    }
    if stamp(&archive_path) != before {
        return fail_tmp(
            FsError::new(
                FsErrorCode::ChangedSinceListing,
                "The archive was changed by someone else meanwhile – the original stays",
                Some(&archive_path),
            ),
            ctx.summary,
        );
    }
    if let Ok(m) = fs::metadata(&archive_path) {
        let _ = fs::set_permissions(&tmp, m.permissions());
    }
    if let Err(e) = fs::rename(&tmp, &archive_path) {
        return fail_tmp(FsError::from_io(&e, &archive_path), ctx.summary);
    }
    archive::forget_index(&archive_path);
    // moving: the sources that went in – each only if it is still the same entry
    if move_sources {
        for a in added.iter().rev() {
            // identity, size and mtime as planned (Windows too – review 035 #2/#3)
            let same = || a.stamp.is_some() && stamp(&a.src) == a.stamp;
            let removed = if a.dir {
                fs::remove_dir(&a.src) // only when empty: skipped content stays
            } else if same() {
                fs::remove_file(&a.src)
            } else {
                Err(std::io::Error::other("changed"))
            };
            if let Err(e) = removed
                && !a.dir
            {
                ctx.fail(&a.src, FsError::from_io(&e, &a.src));
            }
            if let Some(p) = a.src.parent() {
                ctx.rep.dir_changed(p.to_string_lossy().into_owned());
            }
        }
    }
    ctx.summary.bytes_done = ctx.rep.progress.bytes_done;
    ctx.rep.dir_changed(dir.to_string_lossy().into_owned());
    for d in dirs_changed {
        ctx.rep.dir_changed(d.to_string_lossy().into_owned());
    }
    ctx.rep.progress.current = None;
    ctx.rep.tick(true);
    ctx.rep.flush_dirs();
    let state = if ctx.summary.items_failed > 0 {
        JobState::DoneWithErrors
    } else {
        JobState::Done
    };
    (state, ctx.summary)
}
