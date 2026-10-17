import {
  AreaIdent,
  AreaModelIf,
  CellRendererIf,
  DomServiceIf,
  RendererCleanupFnType,
} from '@guiexpert/table';
import { DirEntry, isNavigableDir, isParentRow } from '../../../core/fs/fs.models';
import { formatModified, formatSize } from '../../../shared/format';

/**
 * Plain-DOM renderers (no Angular) for the file list. File names are user data:
 * they are only ever written as text nodes, never as HTML.
 */

function isMarked(areaModel: AreaModelIf, rowIndex: number): boolean {
  const model = areaModel as AreaModelIf & { isMarkedAt?: (row: number) => boolean };
  return model.isMarkedAt?.(rowIndex) ?? false;
}

function rowOf(areaModel: AreaModelIf, rowIndex: number): DirEntry | undefined {
  return areaModel.getRowByIndex(rowIndex) as DirEntry | undefined;
}

/** Visible icon per entry (decorative, `aria-hidden`). */
export function iconFor(entry: DirEntry): string {
  if (isParentRow(entry)) {
    return '↑';
  }
  if (isNavigableDir(entry)) {
    return entry.kind === 'symlink' ? '📁↗' : '📁';
  }
  switch (entry.kind) {
    case 'symlink':
      return entry.targetKind === null ? '⛓' : '📄↗';
    case 'unknown':
      return '⚠';
    default:
      return '📄';
  }
}

/** Own renderers bypass the table's label div – `fnf-cell` gives the same inner spacing. */
function setText(cellDiv: HTMLDivElement, domService: DomServiceIf, text: string): void {
  domService.addClass(cellDiv, 'fnf-cell');
  domService.appendChild(cellDiv, domService.createText(text));
}

export class NameCellRenderer implements CellRendererIf {
  render(
    cellDiv: HTMLDivElement,
    rowIndex: number,
    _columnIndex: number,
    _areaIdent: AreaIdent,
    areaModel: AreaModelIf,
    cellValue: unknown,
    domService: DomServiceIf,
  ): RendererCleanupFnType | undefined {
    const entry = rowOf(areaModel, rowIndex);
    domService.addClass(cellDiv, 'fnf-cell');
    const icon = domService.createElement<HTMLSpanElement>('span');
    domService.addClass(icon, 'fnf-icon');
    domService.setAttribute(icon, 'aria-hidden', 'true');
    const marked = isMarked(areaModel, rowIndex);
    domService.appendChild(icon, domService.createText(marked ? '✔' : entry ? iconFor(entry) : ''));
    domService.appendChild(cellDiv, icon);
    if (marked) {
      const srText = domService.createElement<HTMLSpanElement>('span');
      domService.addClass(srText, 'ge-table-sr-only');
      domService.appendChild(srText, domService.createText('marked, '));
      domService.appendChild(cellDiv, srText);
    }
    const name = domService.createElement<HTMLSpanElement>('span');
    domService.addClass(name, 'fnf-name');
    domService.appendChild(name, domService.createText(String(cellValue ?? '')));
    domService.appendChild(cellDiv, name);
    if (entry?.lossyName) {
      domService.setAttribute(
        cellDiv,
        'title',
        'Name contains invalid characters – navigation not supported yet',
      );
    }
    return undefined;
  }
}

/** `<DIR>` for folders until their size was calculated (Space, design 003 E7); nothing for "..". */
export function sizeText(entry: DirEntry): string {
  if (isParentRow(entry)) {
    return '';
  }
  if (isNavigableDir(entry) && entry.size === null) {
    return '<DIR>';
  }
  return formatSize(entry.size);
}

export class SizeCellRenderer implements CellRendererIf {
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
    if (entry) {
      setText(cellDiv, domService, sizeText(entry));
    }
    return undefined;
  }
}

export class DateCellRenderer implements CellRendererIf {
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
    if (entry) {
      setText(cellDiv, domService, formatModified(entry.modifiedMs));
    }
    return undefined;
  }
}
