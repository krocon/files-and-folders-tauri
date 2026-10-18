import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { describeFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { Modal } from '../../shared/dialog/modal';
import { GridColumn, PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { GROUP_MODES, GroupMode, MIN_SIZES } from './group-engine';
import { GF_TEXTS } from './groupfiles-texts';
import { GroupFilesStore, GroupRow } from './groupfiles.store';

const LABEL_ID = 'fnf-gf-preview-label';

const COLUMNS: readonly GridColumn[] = [
  { property: 'nr', label: GF_TEXTS.colNr, width: 56, align: 'end' },
  { property: 'name', label: GF_TEXTS.colName, width: null },
  { property: 'group', label: GF_TEXTS.colGroup, width: 260 },
  { property: 'info', label: GF_TEXTS.colInfo, width: 240 },
];

function rowClass(r: GroupRow): string | null {
  return r.status === 'error' ? 'fnf-mr-error' : r.status === 'ok' ? null : 'fnf-mr-unchanged';
}

/**
 * Group files (OPEN_GROUPFILES_DLG, design 008 §4): mode, options, root,
 * preview grid; Copy or Move start one `group` job (conflicts via 005).
 * Strg/⌘+Enter = Move (legacy default action).
 */
@Component({
  selector: 'app-group-files-dialog',
  imports: [Modal, PreviewGrid],
  template: `
    @if (gf.request(); as req) {
      <app-modal [heading]="heading()" width="min(64rem, 92vw)" height="80vh" (closed)="gf.close()">
        <div class="tool">
          <div class="row">
            <label class="field">
              <span>{{ t.mode }}</span>
              <select data-autofocus [value]="o().mode" (change)="setMode($event)">
                @for (m of modes; track m) {
                  <option [value]="m" [selected]="m === o().mode">{{ t.modes[m] }}</option>
                }
              </select>
            </label>
            @if (o().mode === 'newFolder') {
              <label class="field grow">
                <span>{{ t.newFolder }}</span>
                <input
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  [value]="o().newFolder"
                  (input)="gf.update({ newFolder: text($event) })"
                />
              </label>
            } @else {
              <label class="field">
                <span>{{ t.minSize }}</span>
                <select (change)="gf.update({ minSize: +text($event) })">
                  @for (n of minSizes; track n) {
                    <option [value]="n" [selected]="n === o().minSize">
                      {{ n === 0 ? t.minSizeNone : n }}
                    </option>
                  }
                </select>
              </label>
            }
          </div>
          <div class="row options">
            <label class="check">
              <input
                type="checkbox"
                [checked]="o().ignoreBrackets"
                (change)="gf.update({ ignoreBrackets: checked($event) })"
              />
              {{ t.ignoreBrackets }}
            </label>
            <label class="check">
              <input
                type="checkbox"
                [checked]="o().useSourceDir || req.otherDir === null"
                [disabled]="req.otherDir === null"
                (change)="gf.update({ useSourceDir: checked($event) })"
              />
              {{ t.useSourceDir }}
            </label>
            <span class="help">
              {{ t.root }}: <span class="path">{{ gf.root() }}</span>
              @if (req.otherDir === null) {
                {{ t.noOtherPanel }}
              }
            </span>
          </div>
          <span [id]="labelId" class="preview-label">{{ t.preview }}</span>
          <app-preview-grid
            class="preview"
            [columns]="columns"
            [rows]="gf.rows()"
            [rowClass]="rowClass"
            [labelledBy]="labelId"
          />
          <div class="foot">
            <p class="summary" aria-live="polite">{{ summary() }}</p>
            <p class="error" role="alert">{{ errorText() }}</p>
            <div class="buttons">
              <button type="button" class="btn" (click)="gf.close()">{{ t.cancel }}</button>
              <button type="button" class="btn" [disabled]="!gf.canRun()" (click)="gf.run('copy')">
                {{ t.copy }}
              </button>
              <button
                type="button"
                class="btn primary"
                [disabled]="!gf.canRun()"
                aria-keyshortcuts="Control+Enter Meta+Enter"
                (click)="gf.run('move')"
              >
                {{ t.move }}
              </button>
            </div>
          </div>
        </div>
      </app-modal>
    }
  `,
  styleUrl: '../../shared/dialog/tool-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
})
export class GroupFilesDialog {
  protected readonly t = GF_TEXTS;
  protected readonly gf = inject(GroupFilesStore);
  protected readonly o = this.gf.options;
  protected readonly modes = GROUP_MODES;
  protected readonly minSizes = MIN_SIZES;
  protected readonly columns = COLUMNS;
  protected readonly rowClass = rowClass;
  protected readonly labelId = LABEL_ID;

  protected readonly heading = computed(() =>
    this.t.title(this.gf.request()?.entries.length ?? 0, this.gf.outcome().groupCount),
  );
  protected readonly summary = computed(() => {
    const rows = this.gf.rows();
    const ok = this.gf.items().length;
    return this.t.summary(this.gf.outcome().groupCount, ok, rows.length - ok);
  });
  protected readonly errorText = computed(() => {
    const e: FsError | null = this.gf.runError();
    return e ? `${describeFsError(e)} ${e.message}` : '';
  });

  protected text(evt: Event): string {
    return (evt.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected checked(evt: Event): boolean {
    return (evt.target as HTMLInputElement).checked;
  }

  protected setMode(evt: Event): void {
    this.gf.update({ mode: this.text(evt) as GroupMode });
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) {
      evt.preventDefault();
      evt.stopPropagation();
      void this.gf.run('move');
    }
  }
}
