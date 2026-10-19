import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
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
        <app-modal
          dialogRole="alertdialog"
          describedBy="fnf-conflict-intro"
          [heading]="readOnly() ? t.readOnlyTitle : t.conflictTitle"
          width="36rem"
          (closed)="later()"
        >
          <p class="intro" id="fnf-conflict-intro">
            {{ readOnly() ? t.readOnlyIntro : t.conflictIntro }}
          </p>
          @if (readOnly()) {
            <dl class="files">
              <dt>{{ t.entry }}</dt>
              <dd>
                <span class="path">{{ c.source }}</span>
                <span class="meta"
                  >{{ size(c.sourceMeta.size) }} · {{ date(c.sourceMeta.modifiedMs) }}</span
                >
              </dd>
            </dl>
          } @else {
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
          }
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
            @for (b of buttons(); track b.key) {
              <button
                type="button"
                class="btn"
                [class.danger]="b.action === 'cancel'"
                [attr.data-autofocus]="b.action === 'skip' && !renaming() ? '' : null"
                [attr.aria-keyshortcuts]="'Alt+' + b.key.toUpperCase()"
                (click)="press(b.key)"
              >
                <!-- one flex item: the button's gap must not split the word -->
                <span class="label"
                  >{{ b.before }}<u>{{ b.letter }}</u
                  >{{ b.after }}</span
                >
              </button>
            }
          </div>
          <p class="hint">{{ t.conflictHint }} {{ t.later }}</p>
        </app-modal>
      }
    }
  `,
  styleUrl: './conflict-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
})
export class ConflictDialog {
  protected readonly t = JOB_TEXTS;
  private readonly jobs = inject(JobsStore);
  private readonly dialogs = inject(DialogService);
  protected readonly job = computed(() => this.jobs.conflictToShow());

  constructor() {
    // the question was answered or the job ended elsewhere: no invisible modal may stay open
    effect(() => {
      if (this.job() === null) {
        untracked(() => {
          if (this.dialogs.open() === 'conflict') {
            this.dialogs.close();
          }
        });
      }
    });
  }
  protected readonly applyToAll = signal(false);
  /** Permanent delete of a write-protected entry (design 006 E6). */
  protected readonly readOnly = computed(() => this.job()?.conflict?.kind === 'readOnly');
  /** Label split around the Alt letter (underlined); letters per language. */
  protected readonly buttons = computed(() => {
    const kind = this.job()?.spec.kind;
    const keys = this.t.conflictKeys;
    const b = (action: ConflictAction, [before, letter, after]: readonly string[]) => ({
      action,
      key: letter.toLowerCase(),
      before,
      letter,
      after,
    });
    const cancel = b('cancel', keys.cancel(kind === 'move' || kind === 'delete' ? kind : 'copy'));
    if (this.readOnly()) {
      return [b('overwrite', keys.deleteAnyway), b('skip', keys.skip), cancel];
    }
    return [
      b('overwrite', keys.overwrite),
      b('skip', keys.skip),
      b('rename', keys.rename),
      b('newer', keys.newer),
      cancel,
    ];
  });
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

  protected press(key: string): boolean {
    const button = this.buttons().find((b) => b.key === key);
    switch (button?.action) {
      case 'overwrite':
        this.decide({ type: 'overwrite' });
        return true;
      case 'skip':
        this.decide({ type: 'skip' });
        return true;
      case 'rename':
        this.startRename();
        return true;
      case 'newer':
        this.decide({ type: 'overwriteIfNewer' });
        return true;
      case 'cancel':
        this.decide({ type: 'cancel' });
        return true;
      default:
        return false;
    }
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (!evt.altKey || evt.ctrlKey || evt.metaKey) {
      return;
    }
    if (this.press(evt.code.replace('Key', '').toLowerCase())) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  }
}

type ConflictAction = 'overwrite' | 'skip' | 'rename' | 'newer' | 'cancel';
