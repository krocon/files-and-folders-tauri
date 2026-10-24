import { isFinished, JobInfo, JobState } from '../../core/jobs/jobs.models';
import { amountText, fraction, JOB_TEXTS, jobTitle, speedText, stateLabel } from './job-format';

/** What a button in the last column does. */
export type JobAct = 'answer' | 'startNow' | 'pause' | 'resume' | 'cancel' | 'undo' | 'details';

export interface JobButton {
  readonly act: JobAct;
  readonly label: string;
  /** Spoken name (the label plus the task). */
  readonly ariaLabel: string;
  /**
   * Stays the same when the button changes its meaning (Pause ⇄ Resume) – the table
   * gives the keyboard focus back to the same slot after a repaint.
   */
  readonly slot: string;
  readonly look: 'normal' | 'primary' | 'danger';
  /** Toggle state for Pause/Resume (`aria-pressed`). */
  readonly pressed?: boolean;
}

/** One row of the task table (pure view model, design 005 + Marc 2026-10-24). */
export interface JobRow {
  readonly id: string;
  readonly state: JobState;
  readonly status: string;
  readonly finished: boolean;
  /** A problem to look at: failed, with errors, paused because the disk is full. */
  readonly problem: boolean;
  /** Column 2, first line: "29 MB of 46 MB" – or the summary of a finished task. */
  readonly amount: string;
  /** Column 2, second line: "48 MB/s · 0:00 left". */
  readonly speed: string;
  /** 0–100, null = unknown (indeterminate bar). */
  readonly percent: number | null;
  /** Column 4: "Move /home/marc/Downloads/setup.exe → /home/marc/Documents". */
  readonly action: string;
  /** Column 4, second line: the current file while running. */
  readonly current: string;
  readonly buttons: readonly JobButton[];
}

function buttonsOf(job: JobInfo, title: string): JobButton[] {
  const t = JOB_TEXTS;
  const b = (
    act: JobAct,
    label: string,
    slot: string,
    look: JobButton['look'] = 'normal',
    extra: Partial<JobButton> = {},
  ): JobButton => ({ act, label, ariaLabel: `${label}: ${title}`, slot, look, ...extra });
  if (isFinished(job.state)) {
    const out: JobButton[] = [];
    if (job.undoAvailable) {
      out.push({ ...b('undo', t.undo, 'undo'), ariaLabel: t.undoLabel(title) });
    }
    const failed = job.summary?.itemsFailed ?? 0;
    if (failed > 0 || job.summary?.error) {
      out.push(b('details', failed > 0 ? t.errors(failed) : t.details, 'details'));
    }
    return out;
  }
  const out: JobButton[] = [];
  // waiting in the queue: may run at once, next to the others (Marc 2026-10-24)
  if (job.state === 'queued') {
    out.push(b('startNow', t.startNow, 'start', 'primary'));
  }
  if (job.state === 'waitingForDecision') {
    out.push(b('answer', t.answer, 'toggle', 'primary'));
  } else {
    const paused = job.state === 'paused';
    out.push(
      b(paused ? 'resume' : 'pause', paused ? t.resume : t.pause, 'toggle', 'normal', {
        pressed: paused,
      }),
    );
  }
  out.push(b('cancel', t.cancel, 'cancel', 'danger'));
  return out;
}

/** The rows of the task table, in the order of the store. */
export function jobRows(jobs: readonly JobInfo[]): JobRow[] {
  return jobs.map((job) => {
    const finished = isFinished(job.state);
    const title = jobTitle(job);
    const f = fraction(job.progress);
    const s = job.summary;
    return {
      id: job.id,
      state: job.state,
      status: stateLabel(job.state),
      finished,
      problem: job.state === 'failed' || job.state === 'doneWithErrors' || job.pauseReason !== null,
      amount: finished && s ? JOB_TEXTS.doneCount(s.itemsDone) : amountText(job.progress),
      speed:
        finished && s
          ? JOB_TEXTS.skippedFailed(s.itemsSkipped, s.itemsFailed)
          : finished
            ? ''
            : speedText(job.progress, job.state === 'running'),
      percent: finished
        ? job.state === 'done'
          ? 100
          : null
        : f === null
          ? null
          : Math.round(f * 100),
      action: title,
      current: finished ? '' : (job.progress.current ?? ''),
      buttons: buttonsOf(job, title),
    };
  });
}
