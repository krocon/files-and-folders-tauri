import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { defaultArchiveName, withFormat } from '../../core/archive/archive-names';
import { ArchiveFormat, FsError } from '../../core/fs/fs.models';
import { Modal } from '../../shared/dialog/modal';
import { dialogError } from '../ops/ops-logic';
import { ArchiveStore } from './archive.store';
import { ARCHIVE_TEXTS } from './archive-texts';

const FORMATS: readonly ArchiveFormat[] = ['zip', 'tar', 'tarGz'];
const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Pack (Alt+F5, design 016 E5): archive name, format, compression, target
 * folder. Enter or Ctrl/⌘+Enter packs, Esc cancels.
 */
@Component({
  selector: 'app-pack-dialog',
  imports: [Modal],
  template: `
    @if (req(); as r) {
      <app-modal [heading]="t.packTitle" width="36rem" (closed)="store.close()">
        <form class="form" (submit)="submit($event)" (keydown)="onKeydown($event)">
          <p class="source">
            <strong>{{
              r.sources.length === 1 ? r.sources[0].name : t.entries(r.sources.length)
            }}</strong>
          </p>
          <label class="field">
            <span>{{ t.name }}</span>
            <input
              data-autofocus
              type="text"
              spellcheck="false"
              autocomplete="off"
              [value]="name()"
              aria-describedby="fnf-pack-error"
              [attr.aria-invalid]="error() ? 'true' : null"
              (input)="name.set($any($event.target).value); error.set(null)"
            />
          </label>
          <fieldset class="field radios">
            <legend>{{ t.format }}</legend>
            @for (f of formats; track f) {
              <label class="check">
                <input
                  type="radio"
                  name="fnf-pack-format"
                  [checked]="format() === f"
                  (change)="setFormat(f)"
                />
                {{ t.formats[f] }}
              </label>
            }
          </fieldset>
          @if (format() !== 'tar') {
            <label class="field">
              <span>{{ t.level }}</span>
              <select (change)="level.set(+$any($event.target).value)">
                @for (l of levels; track l) {
                  <option [value]="l" [selected]="l === level()">{{ t.levelHint(l) }}</option>
                }
              </select>
            </label>
          }
          <label class="field">
            <span>{{ t.to }}</span>
            <input
              type="text"
              spellcheck="false"
              autocomplete="off"
              [value]="target()"
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
          <p class="help">{{ t.linksHint }}</p>
          <p id="fnf-pack-error" class="error" role="alert">{{ errorText() }}</p>
          <div class="buttons">
            <button type="button" class="btn" (click)="store.close()">{{ t.cancel }}</button>
            <button type="submit" class="btn primary" [disabled]="busy()">{{ t.pack }}</button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrl: '../ops/ops-dialog.scss',
  styles: [
    `
      .radios {
        flex-direction: row;
        flex-wrap: wrap;
        gap: var(--spacing-3);
        border: 0;
        margin: 0;
        padding: 0;
      }
      .radios legend {
        width: 100%;
        padding: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PackDialog {
  protected readonly t = ARCHIVE_TEXTS;
  protected readonly formats = FORMATS;
  protected readonly levels = LEVELS;
  protected readonly store = inject(ArchiveStore);
  protected readonly req = this.store.pack;
  protected readonly format = signal<ArchiveFormat>('zip');
  protected readonly name = signal(
    this.req() ? defaultArchiveName(this.req()!.sources, this.req()!.folderName, 'zip') : '',
  );
  protected readonly level = signal(6);
  protected readonly target = signal(this.req()?.target ?? '');
  protected readonly error = signal<FsError | null>(null);
  protected readonly busy = signal(false);

  protected errorText(): string {
    const e = this.error();
    return e ? dialogError(e) : '';
  }

  /** The extension follows the format (a typed name keeps its base). */
  protected setFormat(f: ArchiveFormat): void {
    this.format.set(f);
    const next = withFormat(this.name(), f);
    if (next !== '') {
      this.name.set(next);
    }
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
        await this.store.runPack(req, {
          name: this.name(),
          format: this.format(),
          level: this.level(),
          target: this.target(),
        }),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
