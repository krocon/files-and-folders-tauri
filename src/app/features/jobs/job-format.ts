import { JobInfo, JobState, Progress } from '../../core/jobs/jobs.models';
import { formatSize } from '../../shared/format';
import { translatable } from '../../core/i18n/i18n';
import { JOB_DE } from './job-format.de';

/** Job kinds with their own "Cancel …" label in the conflict dialog. */
export type CancelKind = 'copy' | 'move' | 'delete' | 'extract' | 'pack';

const CANCEL_VERBS: Readonly<Record<CancelKind, string>> = {
  copy: 'copying',
  move: 'moving',
  delete: 'deleting',
  extract: 'extracting',
  pack: 'packing',
};

/** The "Cancel …" kind for a job kind (anything else counts as copying). */
export function cancelKind(kind: string | undefined): CancelKind {
  return kind === 'move' || kind === 'delete' || kind === 'extract' || kind === 'pack'
    ? kind
    : 'copy';
}

/** Texts of the job UI (central for prompt 015). */
export const JOB_EN = {
  tasks: 'Tasks',
  jobsTitle: 'Tasks',
  noJobs: 'No tasks.',
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel',
  answer: 'Answer…',
  clearFinished: 'Remove finished',
  details: 'Details',
  colStatus: 'Status',
  colProgress: 'Progress',
  colBar: 'Done',
  colAction: 'Task',
  colButtons: 'Actions',
  detailsOf: (title: string) => `Details: ${title}`,
  selectHint: 'Click a task to see its details.',
  close: 'Close',
  errors: (n: number) => (n === 1 ? '1 error' : `${n} errors`),
  moreErrors: (n: number) => `… and ${n} more`,
  conflictTitle: 'File already exists',
  conflictIntro: 'The target folder already contains a file with this name.',
  readOnlyTitle: 'Write-protected',
  readOnlyIntro: 'This entry is write-protected. Delete it anyway?',
  entry: 'Entry',
  source: 'New',
  target: 'Existing',
  overwrite: 'Overwrite',
  skip: 'Skip',
  rename: 'Rename',
  newer: 'Overwrite if newer',
  cancelJob: 'Cancel copying',
  applyToAll: 'Apply to all further conflicts',
  newName: 'New name',
  later: 'Later',
  diskFullHint: 'Free some space, then choose Resume – or cancel.',
  copyTitle: 'Copy',
  copyMessage: (n: number) => (n === 1 ? 'Copy 1 entry to' : `Copy ${n} entries to`),
  copyConfirm: 'Copy',
  nothingToCopy: 'Nothing to copy – mark entries or put the cursor on one.',
  noTarget: 'The other panel shows no folder.',
  quitTitle: 'Tasks are running',
  quitMessage: (n: number) =>
    n === 1
      ? '1 task is still running. Cancel it and quit?'
      : `${n} tasks are still running. Cancel them and quit?`,
  quitConfirm: 'Cancel tasks and quit',
  startNow: 'Start now',
  startNowTitle: 'Start now?',
  startNowMessage: (n: number) =>
    n === 1
      ? 'This task works on the same files or folders as another unfinished task:'
      : `This task works on the same files or folders as ${n} other unfinished tasks:`,
  startNowDetail:
    'Running both at the same time can get in each other’s way – for example, a file may be moved while it is being copied.',
  startNowConfirm: 'Start anyway',
  undo: 'Undo',
  undoLabel: (title: string) => `Undo: ${title}`,
  of: (done: string, total: string) => `${done} of ${total}`,
  conflictHint: 'Alt+letter chooses · Esc:',
  /** Button labels as [before, Alt letter, after] (the letter is the key). */
  conflictKeys: {
    overwrite: ['', 'O', 'verwrite'],
    skip: ['', 'S', 'kip'],
    rename: ['', 'R', 'ename…'],
    newer: ['Overwrite if ', 'n', 'ewer'],
    deleteAnyway: ['', 'D', 'elete anyway'],
    /** Design 025 E8: the verb of the job (no "Cancel copying" when extracting). */
    cancel: (kind: CancelKind) => ['', 'C', `ancel ${CANCEL_VERBS[kind]}`],
  },
  summary: (done: number, skipped: number, failed: number) =>
    `${done} done · ${skipped} skipped · ${failed} failed`,
  left: (time: string) => `${time} left`,
  /** The summary in the table: two lines. */
  doneCount: (done: number) => `${done} done`,
  skippedFailed: (skipped: number, failed: number) => `${skipped} skipped · ${failed} failed`,
  states: {
    queued: 'Waiting',
    planning: 'Preparing',
    running: 'Running',
    paused: 'Paused',
    waitingForDecision: 'Waiting for your answer',
    done: 'Done',
    doneWithErrors: 'Done with errors',
    failed: 'Failed',
    cancelled: 'Cancelled',
  } satisfies Record<JobState, string>,
  titles: {
    entries: (n: number) => (n === 1 ? '1 entry' : `${n} entries`),
    folders: (n: number) => `${n} folders`,
    transfer: (kind: 'copy' | 'move', what: string, target: string, renameTo: string | null) =>
      `${kind === 'copy' ? 'Copy' : 'Move'} ${what} → ${target}${renameTo ? ` as ${renameTo}` : ''}`,
    delete: (what: string, trash: boolean) =>
      trash ? `Move ${what} to the trash` : `Delete ${what} permanently`,
    rename: (what: string, undo: boolean) => (undo ? `Undo renaming ${what}` : `Rename ${what}`),
    group: (transfer: 'copy' | 'move', what: string, root: string) =>
      `Group files: ${transfer === 'copy' ? 'Copy' : 'Move'} ${what} → ${root}`,
    clean: (where: string, n: number, trash: boolean) =>
      `Clean ${where}: ${n === 1 ? '1 entry' : `${n} entries`} ${trash ? 'to the trash' : 'permanently'}`,
    search: (name: string, where: string) => `Search "${name}" in ${where}`,
    extract: (what: string, target: string) => `Extract ${what} → ${target}`,
    entriesOf: (n: number, archive: string) => `${n} entries of ${archive}`,
    pack: (what: string, target: string, name: string) => `Pack ${what} → ${target} / ${name}`,
    link: (what: string, target: string, renameTo: string | null) =>
      `Link ${what} → ${target}${renameTo ? ` as ${renameTo}` : ''}`,
    duplicates: (where: string) => `Find duplicates in ${where}`,
    dedupe: (n: number, action: 'trash' | 'permanent' | 'move', target: string) =>
      `Remove ${n === 1 ? '1 duplicate' : `${n} duplicates`} ${
        action === 'trash' ? 'to the trash' : action === 'permanent' ? 'permanently' : `→ ${target}`
      }`,
    checksum: (what: string, algo: string) => `${algo} checksums of ${what}`,
    verifyChecksums: (file: string) => `Verify checksums of ${file}`,
    count: (what: string) => `Count ${what}`,
    dirSize: (path: string) => `Folder size of ${path}`,
    diskUsage: (what: string, rescan: boolean) =>
      rescan ? `Disk usage: scan again` : `Disk usage of ${what}`,
    volumeOf: (path: string) => `the drive of ${path}`,
    simulate: (n: number) => `Test job (${n} steps)`,
    shell: (command: string, cwd: string) => `Shell: ${command} (in ${cwd})`,
    viewEntry: (path: string) => `Open from the archive: ${path}`,
    attributes: (what: string, recursive: boolean) =>
      `Change attributes of ${what}${recursive ? ' and their contents' : ''}`,
  },
} as const;

export function stateLabel(state: JobState): string {
  return JOB_TEXTS.states[state];
}

/** "Copy 3 entries → Ziel" – paths stay opaque, only shown. */
export function jobTitle(job: JobInfo): string {
  const spec = job.spec;
  const t = JOB_TEXTS.titles;
  switch (spec.kind) {
    case 'copy':
    case 'move': {
      const n = spec.sources.length;
      const what = n === 1 ? spec.sources[0] : t.entries(n);
      return t.transfer(spec.kind, what, spec.targetDir, spec.options?.renameTo ?? null);
    }
    case 'delete': {
      const n = spec.paths.length;
      return t.delete(n === 1 ? spec.paths[0] : t.entries(n), spec.mode === 'trash');
    }
    case 'rename': {
      const n = spec.items.length;
      const what = n === 1 ? `${spec.items[0].path} → ${spec.items[0].newName}` : t.entries(n);
      return t.rename(what, !!spec.undoOf);
    }
    case 'group': {
      const n = spec.items.length;
      return t.group(spec.transfer, n === 1 ? spec.items[0].path : t.entries(n), spec.root);
    }
    case 'clean': {
      const n = spec.items.length;
      const where = spec.roots.length === 1 ? spec.roots[0] : t.folders(spec.roots.length);
      return t.clean(where, n, spec.mode === 'trash');
    }
    case 'search': {
      const c = spec.criteria;
      const where = c.roots.length === 1 ? c.roots[0] : t.folders(c.roots.length);
      return t.search(c.name || '*', where);
    }
    case 'extract': {
      const n = spec.entries.length;
      const what =
        n === 0 ? spec.archive : n === 1 ? spec.entries[0] : t.entriesOf(n, spec.archive);
      return t.extract(what, spec.targetDir);
    }
    case 'pack': {
      const n = spec.sources.length;
      return t.pack(n === 1 ? spec.sources[0] : t.entries(n), spec.targetDir, spec.name);
    }
    case 'link': {
      const n = spec.sources.length;
      const what = n === 1 ? spec.sources[0] : t.entries(n);
      return t.link(what, spec.targetDir, spec.options?.renameTo ?? null);
    }
    case 'duplicates': {
      const c = spec.criteria;
      return t.duplicates(c.roots.length === 1 ? c.roots[0] : t.folders(c.roots.length));
    }
    case 'dedupe': {
      const n = spec.groups.reduce((sum, g) => sum + g.remove.length, 0);
      return t.dedupe(n, spec.action, spec.targetDir ?? '');
    }
    case 'checksum': {
      const n = spec.paths.length;
      return t.checksum(n === 1 ? spec.paths[0] : t.entries(n), spec.algo.toUpperCase());
    }
    case 'verifyChecksums':
      return t.verifyChecksums(spec.file);
    case 'count':
      return t.count(spec.paths.length === 1 ? spec.paths[0] : t.entries(spec.paths.length));
    case 'dirSize':
      return t.dirSize(spec.path);
    case 'diskUsage': {
      const n = spec.roots.length;
      const what = spec.volume
        ? t.volumeOf(spec.roots[0] ?? '')
        : n === 1
          ? spec.roots[0]
          : t.folders(n);
      return t.diskUsage(what, !!spec.rescan);
    }
    case 'simulate':
      return t.simulate(spec.items);
    case 'shell':
      return t.shell(spec.command, spec.cwd);
    case 'viewEntry':
      return t.viewEntry(spec.path);
    case 'attributes': {
      const n = spec.paths.length;
      return t.attributes(n === 1 ? spec.paths[0] : t.entries(n), !!spec.recursive);
    }
  }
}

/** 0 … 1, or null if the total is not known yet. */
export function fraction(p: Progress): number | null {
  if (p.bytesTotal > 0) {
    return Math.min(1, p.bytesDone / p.bytesTotal);
  }
  if (p.itemsTotal > 0) {
    return Math.min(1, p.itemsDone / p.itemsTotal);
  }
  return null;
}

/** "1.2 MB of 5.0 MB" (or items) – empty while the total is unknown. */
export function amountText(p: Progress): string {
  if (p.bytesTotal > 0) {
    return JOB_TEXTS.of(formatSize(p.bytesDone), formatSize(p.bytesTotal));
  }
  if (p.itemsTotal > 0) {
    return JOB_TEXTS.of(String(p.itemsDone), String(p.itemsTotal));
  }
  return '';
}

/** "3.4 MB/s · 0:12 left" – only while running with a known rate. */
export function speedText(p: Progress, running = true): string {
  if (!running || p.rateBps <= 0) {
    return '';
  }
  const parts = [`${formatSize(p.rateBps)}/s`];
  const left = p.bytesTotal - p.bytesDone;
  if (left > 0) {
    parts.push(JOB_TEXTS.left(formatDuration(left / p.rateBps)));
  }
  return parts.join(' · ');
}

/** "1.2 MB of 5.0 MB · 3.4 MB/s · 0:12 left" – rate and time only while running. */
export function progressText(p: Progress, running = true): string {
  return [amountText(p), speedText(p, running)].filter((s) => s !== '').join(' · ');
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const JOB_TEXTS = translatable('jobs', JOB_EN, { de: JOB_DE });
