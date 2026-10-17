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
    case 'copy': {
      const n = spec.sources.length;
      const what = n === 1 ? spec.sources[0] : `${n} entries`;
      return `Copy ${what} → ${spec.targetDir}`;
    }
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

/** "1.2 MB of 5.0 MB · 3.4 MB/s · 0:12 left" */
export function progressText(p: Progress): string {
  const parts: string[] = [];
  if (p.bytesTotal > 0) {
    parts.push(`${formatSize(p.bytesDone)} of ${formatSize(p.bytesTotal)}`);
  } else if (p.itemsTotal > 0) {
    parts.push(`${p.itemsDone} of ${p.itemsTotal}`);
  }
  if (p.rateBps > 0) {
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
