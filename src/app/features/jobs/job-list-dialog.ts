import {
  afterEveryRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
} from '@angular/core';
import { isFinished, JobInfo } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { describeFsError } from '../../core/fs/fs-error';
import { DialogService } from '../../shared/dialog/dialog.service';
import { MultiRenameStore } from '../multirename/multirename.store';
import { Modal } from '../../shared/dialog/modal';
import { fraction, JOB_TEXTS, jobTitle, progressText, stateLabel } from './job-format';

const SHOWN_ERRORS = 50;

/**
 * Tasks (OPEN_TASK_DLG): every job with state, progress bar, bytes, rate and
 * time left, the current file, pause/resume/cancel and the error list. The
 * state lives in the JobsStore – closing the list loses nothing.
 */
@Component({
  selector: 'app-job-list-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.jobsTitle" width="44rem" (closed)="dialogs.close()">
      <!-- only finished counts are announced, not the progress (10×/s) -->
      <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
      <ul class="jobs">
        @for (row of rows(); track row.job.id) {
          <li class="job" [class.finished]="row.finished" [attr.data-state]="row.job.state">
            <div class="head">
              <span class="title" [attr.title]="row.title">{{ row.title }}</span>
              <span class="state">{{ row.state }}</span>
            </div>
            @if (!row.finished) {
              <div
                class="bar"
                role="progressbar"
                [attr.aria-label]="row.title"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-valuenow]="row.percent"
              >
                <span
                  [style.width.%]="row.percent ?? 0"
                  [class.indeterminate]="row.percent === null"
                ></span>
              </div>
              @if (row.job.pauseReason; as reason) {
                <p class="error" role="alert">{{ describe(reason) }} {{ t.diskFullHint }}</p>
              }
              <div class="detail">
                <span>{{ row.progress }}</span>
                @if (row.job.progress.current; as cur) {
                  <span class="current" [attr.title]="cur">{{ cur }}</span>
                }
              </div>
            } @else if (row.job.summary; as s) {
              <div class="detail">
                <span
                  >{{ s.itemsDone }} done · {{ s.itemsSkipped }} skipped ·
                  {{ s.itemsFailed }} failed</span
                >
              </div>
              @if (s.error; as e) {
                <p class="error">{{ describe(e) }} {{ e.message }}</p>
              }
              @if (row.job.undoAvailable) {
                <div class="actions">
                  <button
                    type="button"
                    class="btn"
                    [attr.aria-label]="t.undoLabel(row.title)"
                    (click)="mr.undo(row.job.id)"
                  >
                    {{ t.undo }}
                  </button>
                </div>
              }
              @if (s.errors.length) {
                <details class="errors">
                  <summary>{{ t.errors(s.itemsFailed) }}</summary>
                  <ul>
                    @for (e of s.errors.slice(0, shownErrors); track $index) {
                      <li>
                        <span class="path">{{ e.path }}</span> – {{ describe(e.error) }} ({{
                          e.error.message
                        }})
                      </li>
                    }
                    @if (s.itemsFailed > shownErrors) {
                      <li>{{ t.moreErrors(s.itemsFailed - shownErrors) }}</li>
                    }
                  </ul>
                </details>
              }
            }
            @if (!row.finished) {
              <div class="actions">
                @if (row.job.state === 'waitingForDecision') {
                  <button type="button" class="btn primary" (click)="answer(row.job)">
                    {{ t.answer }}
                  </button>
                }
                @if (row.job.state !== 'waitingForDecision') {
                  <!-- one button for both: toggling keeps the keyboard focus on it -->
                  <button
                    type="button"
                    class="btn"
                    [attr.aria-pressed]="row.paused"
                    (click)="togglePause(row.job)"
                  >
                    {{ row.paused ? t.resume : t.pause }}
                  </button>
                }
                <button type="button" class="btn danger" (click)="jobs.cancel(row.job.id)">
                  {{ t.cancel }}
                </button>
              </div>
            }
          </li>
        } @empty {
          <li class="empty">{{ t.noJobs }}</li>
        }
      </ul>
      <div class="buttons">
        <button
          type="button"
          class="btn"
          [disabled]="!hasFinished()"
          (click)="jobs.clearFinished()"
        >
          {{ t.clearFinished }}
        </button>
        <button type="button" class="btn" data-autofocus (click)="dialogs.close()">
          {{ t.close }}
        </button>
      </div>
    </app-modal>
  `,
  styleUrl: './job-list-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobListDialog {
  protected readonly t = JOB_TEXTS;
  protected readonly jobs = inject(JobsStore);
  protected readonly dialogs = inject(DialogService);
  protected readonly mr = inject(MultiRenameStore);
  protected readonly shownErrors = SHOWN_ERRORS;
  protected readonly describe = describeFsError;

  protected readonly rows = computed(() =>
    this.jobs.visible().map((job: JobInfo) => {
      const f = fraction(job.progress);
      return {
        job,
        title: jobTitle(job),
        state: stateLabel(job.state),
        finished: isFinished(job.state),
        percent: f === null ? null : Math.round(f * 100),
        paused: job.state === 'paused',
        progress: progressText(job.progress, job.state === 'running'),
      };
    }),
  );
  protected readonly hasFinished = computed(() => this.rows().some((r) => r.finished));
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // a focused button can vanish (the job ended): keep the focus inside the dialog
    afterEveryRender(() => {
      const active = document.activeElement;
      if (!active || active === document.body) {
        this.host.nativeElement.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      }
    });
  }

  protected readonly announcement = computed(() => {
    const rows = this.rows();
    const done = rows.filter((r) => r.finished).length;
    return rows.length ? `${done} of ${rows.length} tasks finished` : '';
  });

  protected togglePause(job: JobInfo): void {
    void (job.state === 'paused' ? this.jobs.resume(job.id) : this.jobs.pause(job.id));
  }

  protected answer(job: JobInfo): void {
    this.jobs.reopenConflict(job.id);
    this.dialogs.show('conflict');
  }
}
