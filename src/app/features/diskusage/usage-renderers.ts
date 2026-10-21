import {
  AreaIdent,
  AreaModelIf,
  CellRendererIf,
  DomServiceIf,
  RendererCleanupFnType,
} from '@guiexpert/table';
import { DirEntry, isParentRow } from '../../core/fs/fs.models';
import { formatCount } from '../../shared/format';
import { USAGE_TEXTS } from './disk-usage-texts';
import { shareText, usageOf } from './usage-rows';

/**
 * Renderers of the disk-usage columns (design 033): plain DOM, text nodes only.
 * "Share" is a bar plus the percentage; "Objects" counts files and folders.
 */
function rowOf(areaModel: AreaModelIf, rowIndex: number): DirEntry | undefined {
  return areaModel.getRowByIndex(rowIndex) as DirEntry | undefined;
}

export class ShareCellRenderer implements CellRendererIf {
  render(
    cellDiv: HTMLDivElement,
    rowIndex: number,
    _columnIndex: number,
    _areaIdent: AreaIdent,
    areaModel: AreaModelIf,
    _cellValue: unknown,
    domService: DomServiceIf,
  ): RendererCleanupFnType | undefined {
    const entry = rowOf(areaModel, rowIndex);
    const u = usageOf(entry);
    domService.addClass(cellDiv, 'fnf-cell');
    if (!entry || !u || isParentRow(entry)) {
      return undefined;
    }
    domService.addClass(cellDiv, 'fnf-share');
    const track = domService.createElement<HTMLSpanElement>('span');
    domService.addClass(track, 'fnf-share-track');
    domService.setAttribute(track, 'aria-hidden', 'true');
    const bar = domService.createElement<HTMLSpanElement>('span');
    domService.addClass(bar, 'fnf-share-bar');
    if (u.virtual) {
      domService.addClass(bar, 'fnf-share-virtual');
    }
    domService.setStyle(bar, 'width', `${(Math.max(0, Math.min(1, u.share)) * 100).toFixed(1)}%`);
    domService.appendChild(track, bar);
    domService.appendChild(cellDiv, track);
    const text = domService.createElement<HTMLSpanElement>('span');
    domService.addClass(text, 'fnf-share-text');
    domService.appendChild(text, domService.createText(shareText(u.share)));
    domService.appendChild(cellDiv, text);
    if (u.kind === 'mount') {
      domService.setAttribute(cellDiv, 'title', USAGE_TEXTS.mountNote);
    } else if (u.unreadable > 0 && u.kind === 'dir') {
      domService.addClass(cellDiv, 'fnf-share-unreadable');
      domService.setAttribute(cellDiv, 'title', USAGE_TEXTS.unreadable(u.unreadable));
    }
    return undefined;
  }
}

export class ItemsCellRenderer implements CellRendererIf {
  render(
    cellDiv: HTMLDivElement,
    rowIndex: number,
    _columnIndex: number,
    _areaIdent: AreaIdent,
    areaModel: AreaModelIf,
    _cellValue: unknown,
    domService: DomServiceIf,
  ): RendererCleanupFnType | undefined {
    const entry = rowOf(areaModel, rowIndex);
    const u = usageOf(entry);
    domService.addClass(cellDiv, 'fnf-cell');
    if (!entry || !u || isParentRow(entry) || u.kind === 'file' || u.kind === 'link') {
      return undefined;
    }
    const n = u.kind === 'dir' ? u.files + u.dirs : u.files;
    domService.appendChild(cellDiv, domService.createText(formatCount(n)));
    return undefined;
  }
}

/** Value of the "Objects" column (sorting). */
export function itemsOf(entry: DirEntry): number {
  const u = usageOf(entry);
  return u ? (u.kind === 'dir' ? u.files + u.dirs : u.kind === 'file' ? 0 : u.files) : 0;
}
