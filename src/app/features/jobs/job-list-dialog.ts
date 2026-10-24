import {
  afterEveryRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { JobsStore } from '../../core/jobs/jobs.store';
import { describeFsError } from '../../core/fs/fs-error';
import { DialogService } from '../../shared/dialog/dialog.service';
import { MultiRenameStore } from '../multirename/multirename.store';
import { Modal } from '../../shared/dialog/modal';
import { JOB_TEXTS, jobTitle } from './job-format';
import { JobAct, jobRows } from './job-rows';
import { JobTable } from './job-table';

const SHOWN_ERRORS = 50;

/**
 * Tasks (OPEN_TASK_DLG): every job as a row of a GuiExpert Table (state, amount + rate
 * and time left, progress bar, task + current file, buttons – Marc, 2026-10-24); below
 * it the details of the chosen task (errors, why it paused). The state lives in the
 * JobsStore – closing the list loses nothing.
 */
@Component({
  selector: 'app-job-list-dialog',
  imports: [Modal, JobTable],
  template: `
    <app-modal [heading]="t.jobsTitle" width="96vw" [fill]="true" (closed)="dialogs.close()">
      <!-- only finished counts are announced, not the progress (10×/s) -->
      <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
      <app-job-table
        [rows]="rows()"
        [selectedId]="detail()?.id ?? null"
        (act)="onAct($event.id, $event.act)"
        (rowClick)="selected.set($event)"
      />
      <!-- the chosen task: errors, why it paused, what failed -->
      <section class="detail" [attr.aria-label]="detail() ? t.detailsOf(detailTitle()) : null">
        @if (detail(); as job) {
          <h3 class="detail-title" [attr.title]="detailTitle()">{{ detailTitle() }}</h3>
          @if (job.pauseReason; as reason) {
            <p class="error" role="alert">{{ describe(reason) }} {{ t.diskFullHint }}</p>
          }
          @if (job.summary; as s) {
            <p class="summary">{{ t.summary(s.itemsDone, s.itemsSkipped, s.itemsFailed) }}</p>
            @if (s.error; as e) {
              <p class="error">{{ describe(e) }} {{ e.message }}</p>
            }
            @if (s.errors.length) {
              <p class="errors-title">{{ t.errors(s.itemsFailed) }}</p>
              <ul class="errors">
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
            }
          } @else if (job.progress.current; as cur) {
            <p class="path">{{ cur }}</p>
          }
        } @else if (rows().length) {
          <p class="hint">{{ t.selectHint }}</p>
        }
      </section>
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
  styleUrl: './job-list-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobListDialog {
  protected readonly t = JOB_TEXTS;
  protected readonly jobs = inject(JobsStore);
  protected readonly dialogs = inject(DialogService);
  protected readonly mr = inject(MultiRenameStore);
  protected readonly shownErrors = SHOWN_ERRORS;
  protected readonly describe = describeFsError;

  protected readonly rows = computed(() => jobRows(this.jobs.visible()));
  /** The task whose details are shown: the clicked one, else the first with a problem. */
  protected readonly selected = signal<string | null>(null);
  protected readonly detail = computed(() => {
    const all = this.jobs.visible();
    const id = this.selected();
    return (
      all.find((j) => j.id === id) ??
      all.find(
        (j) =>
          j.pauseReason !== null ||
          j.state === 'failed' ||
          j.state === 'doneWithErrors' ||
          !!j.summary?.error,
      ) ??
      null
    );
  });
  protected readonly detailTitle = computed(() => {
    const d = this.detail();
    return d ? jobTitle(d) : '';
  });
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

  /** A button in the table. */
  protected onAct(id: string, act: JobAct): void {
    switch (act) {
      case 'pause':
        void this.jobs.pause(id);
        break;
      case 'resume':
        void this.jobs.resume(id);
        break;
      case 'cancel':
        void this.jobs.cancel(id);
        break;
      case 'answer':
        this.jobs.reopenConflict(id);
        this.dialogs.show('conflict');
        break;
      case 'undo':
        void this.mr.undo(id);
        break;
      case 'details':
        this.selected.set(id);
        break;
    }
  }
}
