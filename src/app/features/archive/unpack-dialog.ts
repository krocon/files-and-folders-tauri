import { TargetField } from '../ops/target-field';
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
  imports: [Modal, TargetField],
  template: `
    @if (req(); as r) {
      <app-modal
        [heading]="r.fromArchive ? t.extractTitle : t.unpackTitle"
        width="min(52rem, 94vw)"
        (closed)="store.close()"
      >
        <form class="form" (submit)="submit($event)" (keydown)="onKeydown($event)">
          <p class="source">
            <strong>{{
              r.fromArchive ? t.entries(r.entryCount) : t.archives(r.entryCount)
            }}</strong>
          </p>
          <app-target-field
            [label]="t.to"
            [suggestionsLabel]="t.suggestions"
            [value]="target()"
            [targets]="r.targets"
            [autofocus]="true"
            [invalid]="!!error()"
            describedBy="fnf-unpack-error"
            (valueChange)="target.set($event); error.set(null)"
          />
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
          @if (r.askPassword) {
            <label class="field">
              <span>{{ r.fromArchive ? t.password : t.passwordOptional }}</span>
              <input
                type="password"
                autocomplete="off"
                spellcheck="false"
                [value]="password()"
                (input)="password.set($any($event.target).value); error.set(null)"
              />
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

          <p id="fnf-unpack-error" class="error" role="alert">{{ errorText() }}</p>
          <div class="buttons">
            <div class="help">{{ t.unpackHint }}</div>
            <div class="spacer"></div>
            <button type="button" class="btn" (click)="store.close()">{{ t.cancel }}</button>
            <button type="submit" class="btn primary" [disabled]="busy()">{{ t.unpack }}</button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrl: '../ops/ops-dialog.css',
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
  protected readonly password = signal('');

  protected errorText(): string {
    const e = this.error();
    return e ? dialogError(e) : '';
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
          password: this.password(),
        }),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
