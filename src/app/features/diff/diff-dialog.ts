import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formatSize } from '../../shared/format';
import { Modal } from '../../shared/dialog/modal';
import { GridColumn, PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { DiffSide } from '../../core/diff/diff.models';
import { hexLines } from './compare-files-logic';
import { DIFF_TEXTS } from './diff-texts';
import { DiffGridRow, DiffStore } from './diff.store';

const LABEL_ID = 'fnf-diff-label';

function rowClass(r: DiffGridRow): string {
  return r.kind === 'equal' ? 'fnf-diff' : `fnf-diff fnf-diff-${r.kind}`;
}

/**
 * Compare files (design 037): two columns with line numbers, differences coloured,
 * F7 / Shift+F7 (or the buttons) step through them; binaries as counts and hex.
 * Read-only – no editor (023 stays dropped).
 */
@Component({
  selector: 'app-diff-dialog',
  imports: [Modal, PreviewGrid],
  template: `
    @if (diff.pair(); as p) {
      <app-modal
        [heading]="t.title(p.left.name, p.right.name)"
        width="min(90rem, 96vw)"
        height="88vh"
        (closed)="diff.close()"
      >
        <div class="tool">
          <div class="sides">
            <p class="help">
              <span class="path">{{ p.left.path }}</span>
              @if (diff.result(); as r) {
                <br />{{ sideText(r.left) }}
              }
            </p>
            <p class="help">
              <span class="path">{{ p.right.path }}</span>
              @if (diff.result(); as r) {
                <br />{{ sideText(r.right) }}
              }
            </p>
          </div>
          <div class="row options">
            <label class="check">
              <input
                type="checkbox"
                data-autofocus
                [checked]="o().ignoreWhitespace"
                (change)="diff.setOptions({ ignoreWhitespace: $any($event.target).checked })"
              />
              {{ t.ignoreWhitespace }}
            </label>
            <label class="check">
              <input
                type="checkbox"
                [checked]="o().ignoreCase"
                (change)="diff.setOptions({ ignoreCase: $any($event.target).checked })"
              />
              {{ t.ignoreCase }}
            </label>
            <label class="check">
              <input
                type="checkbox"
                [checked]="o().wholeFile"
                (change)="diff.setOptions({ wholeFile: $any($event.target).checked })"
              />
              {{ t.wholeFile }}
            </label>
          </div>
          <p class="summary" role="status" aria-live="polite">{{ summary() }}</p>
          @if (diff.result(); as r) {
            @if (r.kind === 'text') {
              @if (diff.gridRows().length > 0 && !(r.changes === 0 && !o().wholeFile)) {
                <span [id]="labelId" class="sr-only">{{ t.changes(r.changes) }}</span>
                <app-preview-grid
                  class="preview"
                  [columns]="columns"
                  [rows]="diff.gridRows()"
                  [rowClass]="rowClass"
                  [activeIndex]="diff.activeRow()"
                  [labelledBy]="labelId"
                />
              }
              @if (r.truncated) {
                <p class="help">{{ t.truncated }}</p>
              }
            } @else if (!r.identical) {
              <div class="hex">
                <pre class="mono" aria-label="left">{{ hexOf(r.leftWindow, r.windowOffset) }}</pre>
                <pre class="mono" aria-label="right">{{
                  hexOf(r.rightWindow, r.windowOffset)
                }}</pre>
              </div>
            }
          }
          <div class="foot">
            <p class="error" role="alert">{{ diff.error() ?? '' }}</p>
            <div class="buttons">
              <button
                type="button"
                class="btn"
                aria-keyshortcuts="Shift+F7"
                [disabled]="diff.current() <= 0"
                (click)="diff.previous()"
              >
                {{ t.previous }}
              </button>
              <button
                type="button"
                class="btn"
                aria-keyshortcuts="F7"
                [disabled]="diff.current() >= diff.starts().length - 1"
                (click)="diff.next()"
              >
                {{ t.next }}
              </button>
              @if (diff.externalTool(); as tool) {
                <button type="button" class="btn" (click)="diff.openExternal()">
                  {{ t.external(tool.label) }}
                </button>
              }
              <button type="button" class="btn primary" (click)="diff.close()">
                {{ t.close }}
              </button>
            </div>
          </div>
        </div>
      </app-modal>
    }
  `,
  styleUrl: '../../shared/dialog/tool-dialog.css',
  styles: `
    .sides {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-2);
    }
    .hex {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--spacing-2);
      flex: 1;
      min-height: 0;
      pre {
        margin: 0;
        min-width: 0;
        overflow: auto;
        padding: var(--spacing-1);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
})
export class DiffDialog {
  protected readonly t = DIFF_TEXTS;
  protected readonly diff = inject(DiffStore);
  protected readonly o = this.diff.options;
  protected readonly labelId = LABEL_ID;
  protected readonly rowClass = rowClass;

  protected get columns(): readonly GridColumn[] {
    return [
      { property: 'ln', label: this.t.colLine, width: 56, align: 'end' },
      { property: 'lt', label: this.diff.pair()?.left.name ?? '', width: null },
      { property: 'rn', label: this.t.colLine, width: 56, align: 'end' },
      { property: 'rt', label: this.diff.pair()?.right.name ?? '', width: null },
    ];
  }

  protected readonly summary = computed(() => {
    const r = this.diff.result();
    if (this.diff.loading()) {
      return this.t.loading;
    }
    if (!r) {
      return '';
    }
    if (r.kind === 'binary') {
      if (r.identical) {
        return this.t.binaryIdentical;
      }
      const parts = [this.t.binaryDiffer(r.differingBytes, r.ranges.length)];
      if (r.left.size !== r.right.size) {
        parts.push(this.t.binarySizes);
      }
      const first = r.ranges[0]?.offset ?? Math.min(r.left.size, r.right.size);
      parts.push(this.t.firstAt(`0x${first.toString(16)}`));
      return parts.join(' · ');
    }
    if (r.changes === 0) {
      const o = this.o();
      return o.ignoreCase || o.ignoreWhitespace ? this.t.identicalWith : this.t.identical;
    }
    const i = this.diff.current();
    return i >= 0
      ? `${this.t.changes(r.changes)} · ${this.t.position(i + 1, this.diff.starts().length)}`
      : this.t.changes(r.changes);
  });

  protected sideText(s: DiffSide): string {
    return this.t.side(formatSize(s.size), s.encoding, s.eol);
  }

  protected hexOf(bytes: readonly number[], base: number): string {
    return hexLines(bytes, base).join('\n');
  }

  protected onKeydown(evt: KeyboardEvent): void {
    const down = evt.key === 'F7' && !evt.shiftKey;
    const up = evt.key === 'F7' && evt.shiftKey;
    if (down || up) {
      evt.preventDefault();
      evt.stopPropagation();
      if (down) {
        this.diff.next();
      } else {
        this.diff.previous();
      }
    }
  }
}
