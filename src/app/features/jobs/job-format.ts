import { JobInfo, JobState, Progress } from '../../core/jobs/jobs.models';
import { formatSize } from '../../shared/format';

/** Texts of the job UI (central for prompt 015). */
export const JOB_TEXTS = {
  tasks: 'Tasks',
  jobsTitle: 'Tasks',
  noJobs: 'No tasks.',
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel',
  answer: 'Answer…',
  clearFinished: 'Remove finished',
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
  undo: 'Undo',
  undoLabel: (title: string) => `Undo: ${title}`,
} as const;

const STATE_LABELS: Readonly<Record<JobState, string>> = {
  queued: 'Waiting',
  planning: 'Preparing',
  running: 'Running',
  paused: 'Paused',
  waitingForDecision: 'Waiting for your answer',
  done: 'Done',
  doneWithErrors: 'Done with errors',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function stateLabel(state: JobState): string {
  return STATE_LABELS[state];
}

/** "Copy 3 entries → Ziel" – paths stay opaque, only shown. */
export function jobTitle(job: JobInfo): string {
  const spec = job.spec;
  switch (spec.kind) {
    case 'copy':
    case 'move': {
      const n = spec.sources.length;
      const what = n === 1 ? spec.sources[0] : `${n} entries`;
      const verb = spec.kind === 'copy' ? 'Copy' : 'Move';
      const as = spec.options?.renameTo ? ` as ${spec.options.renameTo}` : '';
      return `${verb} ${what} → ${spec.targetDir}${as}`;
    }
    case 'delete': {
      const n = spec.paths.length;
      const what = n === 1 ? spec.paths[0] : `${n} entries`;
      return spec.mode === 'trash' ? `Move ${what} to the trash` : `Delete ${what} permanently`;
    }
    case 'rename': {
      const n = spec.items.length;
      const what = n === 1 ? `${spec.items[0].path} → ${spec.items[0].newName}` : `${n} entries`;
      return spec.undoOf ? `Undo renaming ${what}` : `Rename ${what}`;
    }
    case 'group': {
      const n = spec.items.length;
      const verb = spec.transfer === 'copy' ? 'Copy' : 'Move';
      return `Group files: ${verb} ${n === 1 ? spec.items[0].path : `${n} entries`} → ${spec.root}`;
    }
    case 'clean': {
      const n = spec.items.length;
      const where = spec.roots.length === 1 ? spec.roots[0] : `${spec.roots.length} folders`;
      const how = spec.mode === 'trash' ? 'to the trash' : 'permanently';
      return `Clean ${where}: ${n === 1 ? '1 entry' : `${n} entries`} ${how}`;
    }
    case 'search': {
      const c = spec.criteria;
      const where = c.roots.length === 1 ? c.roots[0] : `${c.roots.length} folders`;
      return `Search "${c.name || '*'}" in ${where}`;
    }
    case 'count':
      return `Count ${spec.paths.length === 1 ? spec.paths[0] : `${spec.paths.length} entries`}`;
    case 'dirSize':
      return `Folder size of ${spec.path}`;
    case 'simulate':
      return `Test job (${spec.items} steps)`;
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

/** "1.2 MB of 5.0 MB · 3.4 MB/s · 0:12 left" – rate and time only while running. */
export function progressText(p: Progress, running = true): string {
  const parts: string[] = [];
  if (p.bytesTotal > 0) {
    parts.push(`${formatSize(p.bytesDone)} of ${formatSize(p.bytesTotal)}`);
  } else if (p.itemsTotal > 0) {
    parts.push(`${p.itemsDone} of ${p.itemsTotal}`);
  }
  if (running && p.rateBps > 0) {
    parts.push(`${formatSize(p.rateBps)}/s`);
    const left = p.bytesTotal - p.bytesDone;
    if (left > 0) {
      parts.push(`${formatDuration(left / p.rateBps)} left`);
    }
  }
  return parts.join(' · ');
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
