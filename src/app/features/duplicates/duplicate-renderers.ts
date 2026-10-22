import {
  AreaIdent,
  AreaModelIf,
  CellRendererIf,
  DomServiceIf,
  RendererCleanupFnType,
} from '@guiexpert/table';
import { DirEntry } from '../../core/fs/fs.models';
import { SearchHit } from '../../core/search/search.models';
import { formatCount } from '../../shared/format';
import type { FileBodyModel } from '../browser/file-list/file-table-model';
import { DUP_TEXTS } from './duplicates-texts';

/** What the "Decision" column shows (computed by the file list, design 042 E1). */
export interface DecisionView {
  readonly kind: 'keep' | 'delete' | 'same' | 'spare' | 'undecided';
  readonly text: string;
  /** The rule that decided (short), "by you", … – empty if none. */
  readonly reason: string;
  readonly title: string | null;
}

/**
 * "Decision" column of a duplicate tab: symbol + word (never colour alone) + reason.
 * Text nodes only – reasons may contain user patterns.
 */
export class DecisionCellRenderer implements CellRendererIf {
  render(
    cellDiv: HTMLDivElement,
    rowIndex: number,
    _columnIndex: number,
    _areaIdent: AreaIdent,
    areaModel: AreaModelIf,
    _cellValue: unknown,
    domService: DomServiceIf,
  ): RendererCleanupFnType | undefined {
    domService.addClass(cellDiv, 'fnf-cell');
    const view = (areaModel as unknown as FileBodyModel).dupDecisionAt?.(rowIndex) ?? null;
    if (!view) {
      return undefined;
    }
    domService.addClass(cellDiv, `fnf-dup-${view.kind}`);
    const icon = domService.createElement<HTMLSpanElement>('span');
    domService.setAttribute(icon, 'aria-hidden', 'true');
    domService.addClass(icon, 'fa');
    domService.addClass(
      icon,
      {
        keep: 'fa-check',
        delete: 'fa-trash-o',
        same: 'fa-link',
        spare: 'fa-link',
        undecided: 'fa-question',
      }[view.kind],
    );
    domService.appendChild(cellDiv, icon);
    domService.appendChild(cellDiv, domService.createText(` ${view.text}`));
    if (view.reason) {
      const r = domService.createElement<HTMLSpanElement>('span');
      domService.addClass(r, 'fnf-dup-reason');
      domService.appendChild(r, domService.createText(` · ${view.reason}`));
      domService.appendChild(cellDiv, r);
    }
    // the reason is cut in a narrow column: the tooltip has it whole
    const tip = [view.reason ? `${view.text} · ${view.reason}` : view.text, view.title]
      .filter((t) => !!t)
      .join(' – ');
    domService.setAttribute(cellDiv, 'title', tip);
    return undefined;
  }
}

/** "Pixels" column of similar images/comics: `4000 × 3000`, comics with pages. */
export function pixelsOf(row: DirEntry): string {
  const h = row as SearchHit;
  if (h.width === undefined || h.height === undefined) {
    return '';
  }
  const px = `${formatCount(h.width)} × ${formatCount(h.height)}`;
  return h.pages !== undefined ? `${px} · ${DUP_TEXTS.pages(h.pages)}` : px;
}

/** Sort value of the pixels column. */
export function pixelCount(row: DirEntry): number {
  const h = row as SearchHit;
  return (h.width ?? 0) * (h.height ?? 0);
}
