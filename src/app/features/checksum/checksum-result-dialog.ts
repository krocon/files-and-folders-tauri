import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Modal } from '../../shared/dialog/modal';
import { GridColumn, PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { CS_TEXTS } from './checksum-texts';
import { ChecksumStore } from './checksum.store';

const LABEL_ID = 'fnf-cs-result-label';

interface ProblemRow {
  readonly name: string;
  readonly status: string;
  readonly bad: boolean;
}

/** Result of verifying a checksum file (CHECKSUM_VERIFY, design 039). */
@Component({
  selector: 'app-checksum-result-dialog',
  imports: [Modal, PreviewGrid],
  template: `
    @if (cs.result(); as r) {
      <app-modal
        [heading]="heading()"
        width="min(52rem, 92vw)"
        height="70vh"
        (closed)="cs.closeResult()"
      >
        <div class="tool">
          <p class="summary" role="status">
            @if (problemCount() === 0 && !r.cancelled) {
              {{ t.resultAllOk(r.summary.ok) }}
            } @else {
              {{ t.resultOk(r.summary.ok) }} · {{ t.resultProblems(problemCount()) }}
              @if (r.cancelled) {
                · {{ t.cancelled }}
              }
            }
          </p>
          @if (rows().length > 0) {
            <span [id]="labelId" class="preview-label">{{ t.resultProblems(problemCount()) }}</span>
            <app-preview-grid
              class="preview"
              [columns]="columns"
              [rows]="rows()"
              [rowClass]="rowClass"
              [labelledBy]="labelId"
            />
            @if (hidden() > 0) {
              <p class="help">{{ t.moreProblems(hidden()) }}</p>
            }
          }
          <div class="foot">
            <div class="buttons">
              @if (changed() > 0) {
                <button type="button" class="btn" (click)="cs.markChanged()">
                  {{ t.markChanged }}
                </button>
              }
              <button type="button" class="btn primary" data-autofocus (click)="cs.closeResult()">
                {{ t.close }}
              </button>
            </div>
          </div>
        </div>
      </app-modal>
    }
  `,
  styleUrl: '../../shared/dialog/tool-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChecksumResultDialog {
  protected readonly t = CS_TEXTS;
  protected readonly cs = inject(ChecksumStore);
  protected readonly labelId = LABEL_ID;
  protected get columns(): readonly GridColumn[] {
    return [
      { property: 'name', label: this.t.colName, width: null },
      { property: 'status', label: this.t.colStatus, width: 260 },
    ];
  }
  protected readonly rowClass = (r: ProblemRow): string | null => (r.bad ? 'fnf-mr-error' : null);

  protected readonly heading = computed(() =>
    this.t.resultTitle(this.cs.result()?.list.name ?? ''),
  );
  protected readonly problemCount = computed(() => {
    const s = this.cs.result()?.summary;
    return s ? s.mismatched + s.missing + s.unreadable + s.invalid + s.refused : 0;
  });
  protected readonly hidden = computed(
    () => this.problemCount() - (this.cs.result()?.summary.problems.length ?? 0),
  );
  protected readonly changed = computed(
    () =>
      this.cs
        .result()
        ?.summary.problems.filter((p) => p.kind === 'mismatch' || p.kind === 'unreadable').length ??
      0,
  );
  protected readonly rows = computed<readonly ProblemRow[]>(() =>
    (this.cs.result()?.summary.problems ?? []).map((p) => ({
      name: p.name,
      status: this.t.status[p.kind],
      bad: p.kind === 'mismatch' || p.kind === 'refused',
    })),
  );
}
