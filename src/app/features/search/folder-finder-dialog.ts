import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Modal } from '../../shared/dialog/modal';
import { GridColumn, PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { FolderFinderStore, MAX_SLIDER_DEPTH } from './folder-finder.store';
import { SEARCH_TEXTS } from './search-texts';

const LABEL_ID = 'fnf-ff-label';
const COLUMNS: readonly GridColumn[] = [
  { property: 'name', label: SEARCH_TEXTS.name, width: 200 },
  { property: 'path', label: SEARCH_TEXTS.folderColumn, width: null },
];

/**
 * Folder finder (Alt+F10, design 009 E6): the focus stays in the filter field;
 * ↑/↓/PgUp/PgDn move the highlighted row, Enter (or a double click) opens it.
 */
@Component({
  selector: 'app-folder-finder-dialog',
  imports: [Modal, PreviewGrid],
  template: `
    @if (ff.request(); as req) {
      <app-modal
        [heading]="t.finderTitle(req.root)"
        width="min(52rem, 94vw)"
        height="75vh"
        (closed)="ff.close()"
      >
        <div class="tool">
          <div class="row">
            <label class="field grow">
              <span [id]="labelId">{{ t.filter }}</span>
              <input
                type="text"
                data-autofocus
                spellcheck="false"
                autocomplete="off"
                aria-describedby="fnf-ff-active"
                [placeholder]="t.filterPlaceholder"
                [value]="ff.filter()"
                (input)="ff.setFilter(text($event))"
                (keydown)="onKey($event)"
              />
            </label>
            <label class="field">
              <span>{{ t.depth }}: {{ depthLabel() }}</span>
              <input
                type="range"
                min="1"
                [max]="maxDepth + 1"
                [value]="ff.depth()"
                [attr.aria-valuetext]="depthLabel()"
                (change)="ff.setDepth(+text($event))"
              />
            </label>
          </div>
          <app-preview-grid
            class="preview"
            [columns]="columns"
            [rows]="ff.shown()"
            [activeIndex]="ff.active()"
            [labelledBy]="labelId"
            (rowClick)="onRowClick($event)"
          />
          <div class="foot">
            <!-- the counter changes constantly: no live region; the end is announced below -->
            <p class="summary">
              {{ t.finderCount(ff.shown().length, ff.folders().length) }}
              @if (ff.running()) {
                <span class="spinner" aria-hidden="true"></span>
              }
              @if (ff.unreadable() > 0) {
                · {{ t.unreadable(ff.unreadable()) }}
              }
            </p>
            <p class="sr-only" role="status">{{ ff.announcement() }}</p>
            <p class="error" role="alert">{{ ff.error()?.message ?? '' }}</p>
            <p id="fnf-ff-active" class="sr-only" aria-live="polite">
              {{ ff.activeFolder()?.path ?? '' }}
            </p>
            <div class="buttons">
              <button type="button" class="btn" (click)="ff.close()">{{ t.cancel }}</button>
              <button
                type="button"
                class="btn primary"
                [disabled]="!ff.activeFolder()"
                (click)="ff.choose()"
              >
                {{ t.open }}
              </button>
            </div>
          </div>
        </div>
      </app-modal>
    }
  `,
  styleUrl: '../../shared/dialog/tool-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderFinderDialog {
  protected readonly t = SEARCH_TEXTS;
  protected readonly ff = inject(FolderFinderStore);
  protected readonly columns = COLUMNS;
  protected readonly labelId = LABEL_ID;
  protected readonly maxDepth = MAX_SLIDER_DEPTH;
  protected readonly depthLabel = computed(() =>
    this.ff.depth() > MAX_SLIDER_DEPTH ? SEARCH_TEXTS.depthAll : String(this.ff.depth()),
  );

  protected onKey(evt: KeyboardEvent): void {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      this.ff.choose();
    } else if (this.ff.key(evt.key)) {
      evt.preventDefault();
    }
  }

  protected onRowClick(evt: { index: number; clickCount: number }): void {
    this.ff.select(evt.index);
    if (evt.clickCount >= 2) {
      this.ff.choose(evt.index);
    }
  }

  protected text(evt: Event): string {
    return (evt.target as HTMLInputElement).value;
  }
}
