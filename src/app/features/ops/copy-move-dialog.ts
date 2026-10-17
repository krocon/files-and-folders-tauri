import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FsError } from '../../core/fs/fs.models';
import { ConflictDefault, isFinished } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { Modal } from '../../shared/dialog/modal';
import { formatSize } from '../../shared/format';
import { dialogError } from './ops-logic';
import { OPS_TEXTS } from './ops-texts';
import { OpsStore } from './ops.store';

const DEFAULTS: readonly ConflictDefault[] = [
  'ask',
  'overwrite',
  'skip',
  'overwriteIfNewer',
  'rename',
];

/**
 * F5 / F6 (design 006 E4): source with a live count, target folder (text +
 * suggestions), name in the target for a single source, conflict default,
 * background. Enter or Ctrl/⌘+Enter starts, Esc cancels.
 */
@Component({
  selector: 'app-copy-move-dialog',
  imports: [Modal],
  template: `
    @if (req(); as r) {
      <app-modal
        [heading]="r.kind === 'copy' ? t.copy : t.move"
        width="38rem"
        (closed)="ops.close()"
      >
        <form class="form" (submit)="submit($event)" (keydown)="onKeydown($event)">
          <p class="source">
            <strong>{{
              r.sources.length === 1 ? r.sources[0].name : t.entries(r.sources.length)
            }}</strong>
            <span class="count" aria-live="polite">{{ countText() }}</span>
          </p>
          <label class="field">
            <span>{{ t.to }}</span>
            <input
              data-autofocus
              type="text"
              spellcheck="false"
              autocomplete="off"
              [value]="target()"
              (input)="target.set($any($event.target).value); error.set(null)"
              [attr.aria-invalid]="error() ? 'true' : null"
              aria-describedby="fnf-copy-error"
            />
          </label>
          @if (r.targets.length > 0) {
            <label class="field">
              <span>{{ t.suggestions }}</span>
              <select (change)="pick($event)">
                <option value="" selected>{{ t.chooseTarget }}</option>
                @for (o of r.targets; track o.path) {
                  <option [value]="o.path">{{ o.group }}: {{ o.path }}</option>
                }
              </select>
            </label>
          }
          @if (r.sources.length === 1) {
            <label class="field">
              <span>{{ t.newName }}</span>
              <input
                type="text"
                spellcheck="false"
                autocomplete="off"
                [value]="name()"
                (input)="name.set($any($event.target).value); error.set(null)"
              />
            </label>
          }
          <label class="field">
            <span>{{ t.ifExists }}</span>
            <select (change)="conflictDefault.set($any($event.target).value)">
              @for (d of defaults; track d) {
                <option [value]="d" [selected]="d === conflictDefault()">
                  {{ t.conflictDefaults[d] }}
                </option>
              }
            </select>
          </label>
          <label class="check">
            <input
              type="checkbox"
              [checked]="background()"
              (change)="background.set(!background())"
            />
            {{ t.background }}
          </label>
          @if (r.dangers.length > 0) {
            <div class="danger-box" role="group" [attr.aria-label]="t.dangerTitle">
              <strong>{{ t.dangerTitle }}</strong>
              <ul>
                @for (d of r.dangers; track d.path) {
                  <li>
                    <span class="path">{{ d.path }}</span> – {{ t.danger(d.danger!) }}
                  </li>
                }
              </ul>
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="allowDangerous()"
                  (change)="allowDangerous.set(!allowDangerous())"
                />
                {{ t.dangerConfirm }}
              </label>
            </div>
          }
          <p id="fnf-copy-error" class="error" role="alert">
            @if (error(); as e) {
              {{ errorText(e) }}
            }
          </p>
          <p class="help">{{ t.ctrlEnter }}</p>
          <div class="buttons">
            <button type="button" class="btn" (click)="ops.close()">{{ t.cancel }}</button>
            <button
              type="submit"
              class="btn primary"
              [disabled]="busy() || (r.dangers.length > 0 && !allowDangerous())"
            >
              {{ r.kind === 'copy' ? t.copy : t.move }}
            </button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrl: './ops-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyMoveDialog {
  protected readonly t = OPS_TEXTS;
  protected readonly defaults = DEFAULTS;
  protected readonly ops = inject(OpsStore);
  private readonly jobs = inject(JobsStore);
  protected readonly req = this.ops.copyMove;

  protected readonly target = signal(this.req()?.target ?? '');
  protected readonly name = signal(
    this.req()?.sources.length === 1 ? this.req()!.sources[0].name : '',
  );
  protected readonly conflictDefault = signal<ConflictDefault>('ask');
  protected readonly background = signal(false);
  protected readonly allowDangerous = signal(false);
  protected readonly error = signal<FsError | null>(null);
  protected readonly busy = signal(false);

  /** The live count runs as a helper job; it is cancelled when the dialog closes. */
  private readonly countId = signal<string | null>(null);
  private readonly countJob = computed(() => {
    const id = this.countId();
    return id === null ? undefined : this.jobs.jobs().find((j) => j.id === id);
  });
  protected readonly countText = computed(() => {
    const job = this.countJob();
    if (!job) {
      return '';
    }
    const size = job.summary?.dirSize;
    if (size) {
      return (
        ' · ' +
        this.t.counted(size.files, size.dirs, formatSize(size.bytes)) +
        (size.unreadable > 0 ? this.t.unreadable(size.unreadable) : '')
      );
    }
    if (isFinished(job.state)) {
      return '';
    }
    const p = job.progress;
    return p.itemsDone > 0
      ? ` · ${p.itemsDone} … ${formatSize(p.bytesDone)} (${this.t.counting})`
      : ` · ${this.t.counting}`;
  });

  constructor() {
    const req = this.req();
    if (req) {
      this.jobs
        .start({ kind: 'count', paths: req.sources.map((e) => e.path) })
        .then((id) => this.countId.set(id))
        .catch(() => undefined);
    }
    inject(DestroyRef).onDestroy(() => {
      const job = this.countJob();
      if (job && !isFinished(job.state)) {
        void this.jobs.cancel(job.id);
      }
    });
  }

  protected errorText(e: FsError): string {
    return dialogError(e);
  }

  protected pick(evt: Event): void {
    const select = evt.target as HTMLSelectElement;
    if (select.value) {
      this.target.set(select.value);
      this.error.set(null);
    }
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) {
      evt.preventDefault();
      void this.start();
    }
  }

  protected submit(evt: Event): void {
    evt.preventDefault();
    void this.start();
  }

  private async start(): Promise<void> {
    const req = this.req();
    if (!req || this.busy() || (req.dangers.length > 0 && !this.allowDangerous())) {
      return;
    }
    this.busy.set(true);
    try {
      const error = await this.ops.runCopyMove(req, {
        target: this.target(),
        name: req.sources.length === 1 ? this.name() : null,
        conflictDefault: this.conflictDefault(),
        background: this.background(),
        allowDangerous: this.allowDangerous(),
      });
      this.error.set(error);
    } finally {
      this.busy.set(false);
    }
  }
}
