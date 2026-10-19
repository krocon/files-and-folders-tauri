import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { describeFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { Modal } from '../../shared/dialog/modal';
import { GridColumn, PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { CL_TEXTS } from './clean-texts';
import { CleanFoldersStore, CleanForm } from './clean.store';

const LABEL_ID = 'fnf-cl-preview-label';

const COLUMNS: readonly GridColumn[] = [
  { property: 'nr', label: CL_TEXTS.colNr, width: 56, align: 'end' },
  { property: 'kind', label: CL_TEXTS.colKind, width: 72 },
  { property: 'path', label: CL_TEXTS.colPath, width: null },
  { property: 'info', label: CL_TEXTS.colInfo, width: 160 },
];

/**
 * Clean folders (OPEN_DELETE_EMPTY_FOLDERS_DLG, design 008 §4): start
 * folders, options, the list of what goes (searched in Rust), trash
 * (default) or permanent. Strg/⌘+Enter deletes to the trash only.
 */
@Component({
  selector: 'app-clean-folders-dialog',
  imports: [Modal, PreviewGrid],
  template: `
    @if (cl.request(); as req) {
      <app-modal [heading]="heading()" width="min(64rem, 92vw)" height="80vh" (closed)="cl.close()">
        <div class="tool">
          @if (req.roots.length > 1) {
            <p class="help">
              {{ t.startFolders }}:
              @for (r of req.roots; track r; let last = $last) {
                <span class="path">{{ r }}</span
                >{{ last ? '' : ' · ' }}
              }
            </p>
          }
          <div class="row options">
            <label class="check">
              <input
                type="checkbox"
                data-autofocus
                [checked]="f().emptyDirs"
                (change)="set('emptyDirs', checked($event))"
              />
              {{ t.emptyDirs }}
            </label>
            <label class="check">
              <input
                type="checkbox"
                [checked]="f().includeRoots"
                [disabled]="!f().emptyDirs"
                (change)="set('includeRoots', checked($event))"
              />
              {{ t.includeRoots }}
            </label>
          </div>
          <div class="row">
            <label class="check">
              <input
                type="checkbox"
                [checked]="f().junkOn"
                [disabled]="!f().emptyDirs"
                (change)="set('junkOn', checked($event))"
              />
              {{ t.junk }}
            </label>
            <label class="inline grow">
              <span class="sr-only">{{ t.junkField }}</span>
              <input
                type="text"
                class="mono wide"
                spellcheck="false"
                [attr.aria-label]="t.junkField"
                [disabled]="!f().junkOn || !f().emptyDirs"
                [value]="f().junkText"
                (input)="set('junkText', text($event))"
              />
            </label>
          </div>
          <div class="row">
            <label class="check">
              <input
                type="checkbox"
                [checked]="f().patternsOn"
                (change)="set('patternsOn', checked($event))"
              />
              {{ t.patterns }}
            </label>
            <label class="inline grow">
              <input
                type="text"
                class="mono wide"
                spellcheck="false"
                [attr.aria-label]="t.patternsField"
                [disabled]="!f().patternsOn"
                [value]="f().patternsText"
                (input)="set('patternsText', text($event))"
              />
            </label>
          </div>
          <span [id]="labelId" class="preview-label">{{ t.preview }}</span>
          <app-preview-grid
            class="preview"
            [columns]="columns"
            [rows]="cl.rows()"
            [labelledBy]="labelId"
          />
          <div class="foot">
            <p class="summary" aria-live="polite">{{ summary() }}</p>
            <p class="error" role="alert">{{ errorText() }}</p>
            <fieldset class="modes">
              <legend class="sr-only">{{ t.mode }}</legend>
              <label class="check">
                <input
                  type="radio"
                  name="fnf-cl-mode"
                  [checked]="cl.mode() === 'trash'"
                  (change)="cl.mode.set('trash')"
                />
                {{ t.trash }}
              </label>
              <label class="check">
                <input
                  type="radio"
                  name="fnf-cl-mode"
                  [checked]="cl.mode() === 'permanent'"
                  (change)="cl.mode.set('permanent')"
                />
                {{ t.permanent }}
              </label>
            </fieldset>
            <div class="buttons">
              <button type="button" class="btn" (click)="cl.close()">{{ t.cancel }}</button>
              <button
                type="button"
                class="btn"
                [class.primary]="cl.mode() === 'trash'"
                [class.danger]="cl.mode() === 'permanent'"
                [disabled]="!cl.canRun()"
                (click)="cl.run()"
              >
                {{ cl.mode() === 'trash' ? t.delete : t.deletePermanent }}
              </button>
            </div>
          </div>
        </div>
      </app-modal>
    }
  `,
  styleUrl: '../../shared/dialog/tool-dialog.css',
  styles: `
    .grow {
      flex: 1;
      min-width: 12rem;
    }
    .wide {
      flex: 1;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
})
export class CleanFoldersDialog {
  protected readonly t = CL_TEXTS;
  protected readonly cl = inject(CleanFoldersStore);
  protected readonly f = this.cl.form;
  protected readonly columns = COLUMNS;
  protected readonly labelId = LABEL_ID;

  protected readonly heading = computed(() => {
    const req = this.cl.request();
    if (!req) {
      return '';
    }
    return this.t.title(req.roots.length === 1 ? req.roots[0] : this.t.folders(req.roots.length));
  });

  protected readonly summary = computed(() => {
    if (this.cl.scanning()) {
      return this.t.scanning;
    }
    const scan = this.cl.scan();
    if (!scan) {
      return '';
    }
    const c = this.cl.counts();
    const parts = [scan.items.length === 0 ? this.t.nothing : this.t.summary(c.dirs, c.files)];
    const unreadable = scan.unreadable.length + scan.unreadableMore;
    if (unreadable > 0) {
      parts.push(this.t.unreadable(unreadable));
    }
    if (scan.truncated) {
      parts.push(this.t.truncated);
    }
    return parts.join(' · ');
  });

  protected readonly errorText = computed(() => {
    const e: FsError | null = this.cl.runError() ?? this.cl.scanError();
    return e ? `${describeFsError(e)} ${e.message}` : '';
  });

  protected set<K extends keyof CleanForm>(key: K, value: CleanForm[K]): void {
    this.cl.update({ [key]: value } as Partial<CleanForm>);
  }

  protected text(evt: Event): string {
    return (evt.target as HTMLInputElement).value;
  }

  protected checked(evt: Event): boolean {
    return (evt.target as HTMLInputElement).checked;
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) {
      evt.preventDefault();
      evt.stopPropagation();
      if (this.cl.mode() === 'trash') {
        void this.cl.run();
      }
    }
  }
}
