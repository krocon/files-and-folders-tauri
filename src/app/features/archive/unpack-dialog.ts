import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FsError } from '../../core/fs/fs.models';
import { ConflictDefault } from '../../core/jobs/jobs.models';
import { Modal } from '../../shared/dialog/modal';
import { dialogError } from '../ops/ops-logic';
import { OPS_TEXTS } from '../ops/ops-texts';
import { ArchiveStore } from './archive.store';
import { ARCHIVE_TEXTS } from './archive-texts';

const DEFAULTS: readonly ConflictDefault[] = [
  'ask',
  'overwrite',
  'skip',
  'overwriteIfNewer',
  'rename',
];

/**
 * Unpack (Alt+F9 on archives) and extract (F5 / Alt+F9 inside an archive),
 * design 016 E4: target folder, "into a subfolder", what to do with existing
 * files. Enter or Ctrl/⌘+Enter starts, Esc cancels.
 */
@Component({
  selector: 'app-unpack-dialog',
  imports: [Modal],
  template: `
    @if (req(); as r) {
      <app-modal
        [heading]="r.fromArchive ? t.extractTitle : t.unpackTitle"
        width="36rem"
        (closed)="store.close()"
      >
        <form class="form" (submit)="submit($event)" (keydown)="onKeydown($event)">
          <p class="source">
            <strong>{{
              r.fromArchive ? t.entries(r.entryCount) : t.archives(r.entryCount)
            }}</strong>
          </p>
          <label class="field">
            <span>{{ t.to }}</span>
            <input
              data-autofocus
              type="text"
              spellcheck="false"
              autocomplete="off"
              [value]="target()"
              aria-describedby="fnf-unpack-error"
              [attr.aria-invalid]="error() ? 'true' : null"
              (input)="target.set($any($event.target).value); error.set(null)"
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
          @if (!r.fromArchive) {
            <label class="check">
              <input
                type="checkbox"
                [checked]="intoSubfolder()"
                (change)="intoSubfolder.set(!intoSubfolder())"
              />
              {{ r.archiveName !== null ? t.intoSubfolder(r.archiveName) : t.intoSubfolderMany }}
            </label>
          }
          <label class="field">
            <span>{{ t.ifExists }}</span>
            <select (change)="conflictDefault.set($any($event.target).value)">
              @for (d of defaults; track d) {
                <option [value]="d" [selected]="d === conflictDefault()">
                  {{ ops.conflictDefaults[d] }}
                </option>
              }
            </select>
          </label>
          <p class="help">{{ t.unpackHint }}</p>
          <p id="fnf-unpack-error" class="error" role="alert">{{ errorText() }}</p>
          <div class="buttons">
            <button type="button" class="btn" (click)="store.close()">{{ t.cancel }}</button>
            <button type="submit" class="btn primary" [disabled]="busy()">{{ t.unpack }}</button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrl: '../ops/ops-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnpackDialog {
  protected readonly t = ARCHIVE_TEXTS;
  protected readonly ops = OPS_TEXTS;
  protected readonly defaults = DEFAULTS;
  protected readonly store = inject(ArchiveStore);
  protected readonly req = this.store.unpack;
  protected readonly target = signal(this.req()?.target ?? '');
  protected readonly intoSubfolder = signal(!(this.req()?.fromArchive ?? false));
  protected readonly conflictDefault = signal<ConflictDefault>('ask');
  protected readonly error = signal<FsError | null>(null);
  protected readonly busy = signal(false);

  protected errorText(): string {
    const e = this.error();
    return e ? dialogError(e) : '';
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
    if (!req || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      this.error.set(
        await this.store.runUnpack(req, {
          target: this.target(),
          intoSubfolder: !req.fromArchive && this.intoSubfolder(),
          conflictDefault: this.conflictDefault(),
        }),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
