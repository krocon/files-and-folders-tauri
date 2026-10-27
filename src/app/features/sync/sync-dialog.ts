import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CompareRow, CompareSide } from '../../core/sync/sync.models';
import { Modal } from '../../shared/dialog/modal';
import { formatModified, formatSize } from '../../shared/format';
import { GridColumn, PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { RowAction, SyncMode, ViewFilter } from './sync-logic';
import { SYNC_TEXTS } from './sync-texts';
import { SyncForm, SyncStore } from './sync.store';

const LABEL_ID = 'fnf-sync-list-label';
const HELP_ID = 'fnf-sync-keys';
const PAGE = 20;

interface GridRow {
  readonly lname: string;
  readonly lsize: string;
  readonly ldate: string;
  readonly action: string;
  readonly rdate: string;
  readonly rsize: string;
  readonly rname: string;
  readonly cls: string | null;
}

/** Symbol of an action; without one the status shows (= equal, ≠ different). */
export function actionSymbol(row: CompareRow, action: RowAction): string {
  switch (action) {
    case 'copyToRight':
      return '→';
    case 'copyToLeft':
      return '←';
    case 'deleteLeft':
      return '✕ ·';
    case 'deleteRight':
      return '· ✕';
    case 'none':
      return row.status === 'equal'
        ? '='
        : row.status === 'differs' || row.status === 'kindMismatch'
          ? '≠'
          : '·';
  }
}

function rowClass(row: CompareRow, action: RowAction): string | null {
  if (action === 'deleteLeft' || action === 'deleteRight') {
    return 'fnf-diff-removed';
  }
  if (action === 'copyToLeft' || action === 'copyToRight') {
    return 'fnf-diff-added';
  }
  return row.status === 'equal' ? 'fnf-sync-equal' : 'fnf-diff-changed';
}

const name = (row: CompareRow, side: CompareSide | null) =>
  side ? (side.kind === 'directory' ? `${row.rel}/` : row.rel) : '';

/** Synchronise folders (OPEN_SYNC_DIRS_DLG, design 036 E5). */
@Component({
  selector: 'app-sync-dialog',
  imports: [Modal, PreviewGrid],
  template: `
    @if (sync.pair(); as pair) {
      <app-modal [heading]="t.title" width="min(84rem, 97vw)" [fill]="true" (closed)="sync.close()">
        <div class="tool">
          @if (!sync.confirming()) {
            <div class="row pair">
              <p class="side">
                <span class="lbl">{{ t.left }}</span> <span class="path">{{ pair.left }}</span>
              </p>
              <button
                type="button"
                class="btn"
                [attr.aria-label]="t.swap"
                [title]="t.swap"
                (click)="sync.swap()"
              >
                ⇄
              </button>
              <p class="side">
                <span class="lbl">{{ t.right }}</span> <span class="path">{{ pair.right }}</span>
              </p>
            </div>
            <div class="row options">
              <label class="check">
                <input
                  type="checkbox"
                  data-autofocus
                  [checked]="f().recursive"
                  (change)="set('recursive', $event)"
                />
                {{ t.recursive }}
              </label>
              <label class="check">
                <input type="checkbox" [checked]="f().content" (change)="set('content', $event)" />
                {{ t.content }}
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="f().ignoreDate"
                  (change)="set('ignoreDate', $event)"
                />
                {{ t.ignoreDate }}
              </label>
              <label class="inline">
                {{ t.tolerance }}
                <input
                  type="number"
                  class="num"
                  min="0"
                  max="86400"
                  [value]="f().toleranceSecs"
                  (change)="setTolerance($event)"
                />
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="f().ignoreHour"
                  (change)="set('ignoreHour', $event)"
                />
                {{ t.ignoreHour }}
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="f().ignoreCase"
                  (change)="set('ignoreCase', $event)"
                />
                {{ t.ignoreCase }}
              </label>
              <label class="check">
                <input type="checkbox" [checked]="f().hidden" (change)="set('hidden', $event)" />
                {{ t.hidden }}
              </label>
            </div>
            <div class="row options">
              <label class="inline grow">
                {{ t.filter }}
                <input
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  [placeholder]="t.filterPlaceholder"
                  [value]="f().filter"
                  (change)="setText('filter', $event)"
                />
              </label>
              <label class="inline grow">
                {{ t.exclude }}
                <input
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  [value]="f().exclude"
                  (change)="setText('exclude', $event)"
                />
              </label>
              @if (sync.running()) {
                <button type="button" class="btn" (click)="sync.stop()">{{ t.stop }}</button>
              } @else {
                <button type="button" class="btn primary" (click)="sync.compare()">
                  {{ t.compare }}
                </button>
              }
            </div>
            <fieldset class="row options" role="radiogroup" [attr.aria-label]="t.direction">
              <span class="lbl">{{ t.direction }}</span>
              @for (m of modes(); track m.mode) {
                <label class="check">
                  <input
                    type="radio"
                    name="fnf-sync-mode"
                    [checked]="f().mode === m.mode"
                    (change)="sync.update({ mode: m.mode })"
                  />
                  {{ m.label }}
                </label>
              }
              <label class="check">
                <input
                  type="checkbox"
                  [disabled]="f().mode === 'both'"
                  [checked]="f().mirror"
                  (change)="set('mirror', $event)"
                />
                {{ t.mirror }}
              </label>
            </fieldset>
            <div class="row options" role="group" [attr.aria-label]="t.show">
              <span class="lbl">{{ t.show }}</span>
              @for (v of views(); track v.key) {
                <label class="check">
                  <input
                    type="checkbox"
                    [checked]="sync.view()[v.key]"
                    (change)="setView(v.key, $event)"
                  />
                  {{ v.label }}
                </label>
              }
            </div>
            <span [id]="labelId" class="preview-label">{{ t.listLabel }}</span>
            <div
              class="list"
              tabindex="0"
              [attr.aria-labelledby]="labelId"
              [attr.aria-describedby]="helpId"
              (keydown)="onKey($event)"
            >
              <app-preview-grid
                class="preview"
                [columns]="columns"
                [rows]="gridRows()"
                [rowClass]="cls"
                [activeIndex]="sync.active()"
                [labelledBy]="labelId"
                (rowClick)="onRowClick($event)"
              />
            </div>
            <p [id]="helpId" class="help">{{ t.keysHelp }}</p>
            <p class="sr-only" aria-live="polite">{{ activeText() }}</p>
            <div class="foot">
              <p class="summary" role="status">
                @if (sync.running()) {
                  <span class="spinner" aria-hidden="true"></span>
                  {{ t.running(sync.stats().rows) }}
                } @else if (sync.compared()) {
                  {{ resultText() }}
                  @if (sync.stats().truncated) {
                    · {{ t.truncated }}
                  }
                  @if (sync.stats().unreadable > 0) {
                    · {{ t.unreadable(sync.stats().unreadable) }}
                  }
                } @else {
                  {{ t.notCompared }}
                }
              </p>
              <p class="error" role="alert">{{ sync.error() ?? '' }}</p>
              <div class="row">
                <span class="lbl">{{ t.allTo }}</span>
                <button
                  type="button"
                  class="btn"
                  [disabled]="!sync.canEdit()"
                  [attr.aria-label]="t.setRightLabel"
                  (click)="sync.applyToShown('copyToRight')"
                >
                  {{ t.setRight }}
                </button>
                <button
                  type="button"
                  class="btn"
                  [disabled]="!sync.canEdit()"
                  [attr.aria-label]="t.setLeftLabel"
                  (click)="sync.applyToShown('copyToLeft')"
                >
                  {{ t.setLeft }}
                </button>
                <button
                  type="button"
                  class="btn"
                  [disabled]="!sync.canEdit()"
                  [attr.aria-label]="t.setNoneLabel"
                  (click)="sync.applyToShown('none')"
                >
                  {{ t.setNone }}
                </button>
                <span class="sums">{{ sumsText() }}</span>
              </div>
              <div class="buttons">
                <label class="check">
                  <input type="checkbox" [checked]="f().trash" (change)="set('trash', $event)" />
                  {{ t.trash }}
                </label>
                <button type="button" class="btn" (click)="sync.close()">{{ t.close }}</button>
                <button
                  type="button"
                  class="btn primary"
                  [disabled]="!sync.canSync()"
                  (click)="sync.askSync()"
                >
                  {{ t.synchronise }}
                </button>
              </div>
            </div>
          } @else {
            <h3 class="confirm">{{ t.confirmTitle }}</h3>
            <ul class="confirm-list">
              @for (line of confirmLines(); track $index) {
                <li>{{ line }}</li>
              }
            </ul>
            <div class="foot">
              <div class="buttons">
                <button type="button" class="btn" (click)="sync.back()">{{ t.back }}</button>
                <button
                  type="button"
                  class="btn primary"
                  data-autofocus
                  [disabled]="sync.busy()"
                  (click)="sync.runSync()"
                >
                  {{ t.start }}
                </button>
              </div>
            </div>
          }
        </div>
      </app-modal>
    }
  `,
  styleUrls: ['../../shared/dialog/tool-dialog.css', './sync-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SyncDialog {
  protected readonly t = SYNC_TEXTS;
  protected readonly sync = inject(SyncStore);
  protected readonly labelId = LABEL_ID;
  protected readonly helpId = HELP_ID;
  protected readonly f = computed(() => this.sync.form());

  protected get columns(): readonly GridColumn[] {
    return [
      { property: 'lname', label: this.t.colLeft, width: null },
      { property: 'lsize', label: this.t.colSize, width: 80, align: 'end' },
      { property: 'ldate', label: this.t.colDate, width: 130 },
      { property: 'action', label: this.t.colAction, width: 64 },
      { property: 'rdate', label: this.t.colDate, width: 130 },
      { property: 'rsize', label: this.t.colSize, width: 80, align: 'end' },
      { property: 'rname', label: this.t.colRight, width: null },
    ];
  }

  protected readonly cls = (r: GridRow): string | null => r.cls;

  protected modes(): readonly { mode: SyncMode; label: string }[] {
    return [
      { mode: 'both', label: this.t.modeBoth },
      { mode: 'leftToRight', label: this.t.modeLeftToRight },
      { mode: 'rightToLeft', label: this.t.modeRightToLeft },
    ];
  }

  protected views(): readonly { key: keyof ViewFilter; label: string }[] {
    return [
      { key: 'equal', label: this.t.viewEqual },
      { key: 'leftNewer', label: this.t.viewLeftNewer },
      { key: 'rightNewer', label: this.t.viewRightNewer },
      { key: 'differs', label: this.t.viewDiffers },
      { key: 'onlyLeft', label: this.t.viewOnlyLeft },
      { key: 'onlyRight', label: this.t.viewOnlyRight },
    ];
  }

  /** Grid rows of what is shown (no texts – names, sizes, dates and symbols only). */
  protected readonly gridRows = computed<readonly GridRow[]>(() => {
    const rows = this.sync.rows();
    const actions = this.sync.actions();
    return this.sync.shown().map((i) => {
      const r = rows[i];
      const a = actions[i] ?? 'none';
      return {
        lname: name(r, r.left),
        lsize: r.left ? formatSize(r.left.size) : '',
        ldate: r.left ? formatModified(r.left.modifiedMs) : '',
        action: actionSymbol(r, a),
        rdate: r.right ? formatModified(r.right.modifiedMs) : '',
        rsize: r.right ? formatSize(r.right.size) : '',
        rname: name(r, r.right),
        cls: rowClass(r, a),
      };
    });
  });

  protected readonly activeText = computed(() => {
    const i = this.sync.activeRow();
    const r = this.sync.rows()[i];
    if (!r) {
      return '';
    }
    const a = this.sync.actions()[i] ?? 'none';
    return `${r.rel}: ${this.t.status[r.status]}, ${this.t.action[a]}`;
  });

  protected readonly resultText = computed(() => {
    const s = this.sync.stats();
    return s.rows === 0
      ? this.t.noRows
      : this.t.result(s.rows, s.differences, this.sync.shown().length);
  });

  protected readonly sumsText = computed(() => {
    const s = this.sync.sums();
    return this.t.sums(
      s.toRight,
      formatSize(s.toRightBytes),
      s.toLeft,
      formatSize(s.toLeftBytes),
      s.deleteLeft,
      s.deleteRight,
    );
  });

  protected readonly confirmLines = computed(() => {
    const s = this.sync.sums();
    const trash = this.sync.form().trash;
    const out: string[] = [];
    if (s.toRight > 0) {
      out.push(this.t.confirmCopyRight(s.toRight, formatSize(s.toRightBytes)));
    }
    if (s.toLeft > 0) {
      out.push(this.t.confirmCopyLeft(s.toLeft, formatSize(s.toLeftBytes)));
    }
    if (s.deleteLeft > 0) {
      out.push(this.t.confirmDelete(s.deleteLeft, 'left', trash));
    }
    if (s.deleteRight > 0) {
      out.push(this.t.confirmDelete(s.deleteRight, 'right', trash));
    }
    return out.length > 0 ? out : [this.t.confirmNothing];
  });

  protected set(key: keyof SyncForm, evt: Event): void {
    this.sync.update({ [key]: (evt.target as HTMLInputElement).checked } as Partial<SyncForm>);
  }

  protected setText(key: 'filter' | 'exclude', evt: Event): void {
    this.sync.update({ [key]: (evt.target as HTMLInputElement).value });
  }

  protected setTolerance(evt: Event): void {
    const v = Math.round(Number((evt.target as HTMLInputElement).value));
    this.sync.update({ toleranceSecs: Number.isFinite(v) ? Math.max(0, Math.min(86_400, v)) : 2 });
  }

  protected setView(key: keyof ViewFilter, evt: Event): void {
    this.sync.setView({ [key]: (evt.target as HTMLInputElement).checked });
  }

  protected onRowClick(evt: { index: number; clickCount: number; column: string | null }): void {
    this.sync.moveActive(evt.index);
    if (evt.column === 'action') {
      this.sync.cycle(this.sync.activeRow());
    }
  }

  /** The list is a widget (APG grid): its keys stay here (CLAUDE.md §4 exception). */
  protected onKey(evt: KeyboardEvent): void {
    const s = this.sync;
    const i = s.activeRow();
    const handled = (() => {
      switch (evt.key) {
        case 'ArrowDown':
          s.moveActive(s.active() + 1);
          return true;
        case 'ArrowUp':
          s.moveActive(s.active() - 1);
          return true;
        case 'PageDown':
          s.moveActive(s.active() + PAGE);
          return true;
        case 'PageUp':
          s.moveActive(s.active() - PAGE);
          return true;
        case 'Home':
          s.moveActive(0);
          return true;
        case 'End':
          s.moveActive(s.shown().length - 1);
          return true;
        case 'ArrowRight':
          s.setAction(i, 'copyToRight');
          return true;
        case 'ArrowLeft':
          s.setAction(i, 'copyToLeft');
          return true;
        case 'Delete':
          s.toggleDelete(i);
          return true;
        case ' ':
          s.cycle(i);
          return true;
        case '=':
        case 'Backspace':
          s.setAction(i, 'none');
          return true;
      }
      return false;
    })();
    if (handled) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  }
}
