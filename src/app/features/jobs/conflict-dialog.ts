import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Decision } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { formatModified, formatSize } from '../../shared/format';
import { JOB_TEXTS } from './job-format';

/**
 * Asks how to handle an existing target (design 005 E6): `role="alertdialog"`,
 * both files with size and date, "apply to all". Keyboard: Alt+letter per
 * button (underlined), Enter = the focused button – "Skip" by default (safe);
 * Esc only hides the question ("Later"), the job keeps waiting.
 */
@Component({
  selector: 'app-conflict-dialog',
  imports: [Modal],
  template: `
    @if (job(); as j) {
      @if (j.conflict; as c) {
        <app-modal role="alertdialog" [heading]="t.conflictTitle" width="36rem" (closed)="later()">
          <p class="intro">{{ t.conflictIntro }}</p>
          <dl class="files">
            <dt>{{ t.source }}</dt>
            <dd>
              <span class="path">{{ c.source }}</span>
              <span class="meta"
                >{{ size(c.sourceMeta.size) }} · {{ date(c.sourceMeta.modifiedMs) }}</span
              >
            </dd>
            <dt>{{ t.target }}</dt>
            <dd>
              <span class="path">{{ c.target }}</span>
              <span class="meta"
                >{{ size(c.targetMeta.size) }} · {{ date(c.targetMeta.modifiedMs) }}</span
              >
            </dd>
          </dl>
          @if (renaming()) {
            <form class="rename" (submit)="submitRename($event, nameInput.value)">
              <label>
                <span>{{ t.newName }}</span>
                <input
                  #nameInput
                  data-autofocus
                  type="text"
                  spellcheck="false"
                  [value]="c.suggestedName"
                />
              </label>
              <button type="submit" class="btn primary">{{ t.rename }}</button>
            </form>
          }
          <label class="all">
            <input
              type="checkbox"
              [checked]="applyToAll()"
              (change)="applyToAll.set(!applyToAll())"
            />
            {{ t.applyToAll }}
          </label>
          <div class="buttons">
            <button type="button" class="btn" (click)="decide({ type: 'overwrite' })">
              <u>O</u>verwrite
            </button>
            <button
              type="button"
              class="btn"
              [attr.data-autofocus]="renaming() ? null : ''"
              (click)="decide({ type: 'skip' })"
            >
              <u>S</u>kip
            </button>
            <button type="button" class="btn" (click)="startRename()"><u>R</u>ename…</button>
            <button type="button" class="btn" (click)="decide({ type: 'overwriteIfNewer' })">
              Overwrite if <u>n</u>ewer
            </button>
            <button type="button" class="btn danger" (click)="decide({ type: 'cancel' })">
              <u>C</u>ancel copying
            </button>
          </div>
          <p class="hint">Alt+letter chooses · Esc: {{ t.later }}</p>
        </app-modal>
      }
    }
  `,
  styleUrl: './conflict-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
})
export class ConflictDialog {
  protected readonly t = JOB_TEXTS;
  private readonly jobs = inject(JobsStore);
  private readonly dialogs = inject(DialogService);
  protected readonly job = computed(() => this.jobs.pendingConflict());
  protected readonly applyToAll = signal(false);
  protected readonly renaming = signal(false);

  protected size(bytes: number | null): string {
    return bytes === null ? '–' : formatSize(bytes);
  }

  protected date(ms: number | null): string {
    return formatModified(ms) || '–';
  }

  protected decide(decision: Decision): void {
    const job = this.job();
    const conflict = job?.conflict;
    if (!job || !conflict) {
      return;
    }
    void this.jobs.resolveConflict(job.id, conflict.conflictId, decision, this.applyToAll());
    this.renaming.set(false);
    this.applyToAll.set(false);
    this.dialogs.close();
  }

  protected startRename(): void {
    this.renaming.set(true);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('app-conflict-dialog .rename input');
      input?.focus();
      input?.select();
    });
  }

  protected submitRename(evt: Event, name: string): void {
    evt.preventDefault();
    const trimmed = name.trim();
    if (trimmed) {
      this.decide({ type: 'rename', newName: this.applyToAll() ? null : trimmed });
    }
  }

  /** "Later": hide the question, the job keeps waiting (Tasks list → Answer…). */
  protected later(): void {
    this.jobs.postpone(this.job()?.id ?? null);
    this.dialogs.close();
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (!evt.altKey || evt.ctrlKey || evt.metaKey) {
      return;
    }
    const key = evt.code.replace('Key', '').toLowerCase();
    const actions: Record<string, () => void> = {
      o: () => this.decide({ type: 'overwrite' }),
      s: () => this.decide({ type: 'skip' }),
      r: () => this.startRename(),
      n: () => this.decide({ type: 'overwriteIfNewer' }),
      c: () => this.decide({ type: 'cancel' }),
    };
    const run = actions[key];
    if (run) {
      evt.preventDefault();
      evt.stopPropagation();
      run();
    }
  }
}
