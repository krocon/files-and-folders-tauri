import {
  AreaIdent,
  AreaModelIf,
  CellRendererIf,
  DomServiceIf,
  RendererCleanupFnType,
} from '@guiexpert/table';
import { iconFor, iconNameForEntry } from '../../../core/file-icon/file-icon.service';
import { DirEntry, isNavigableDir, isParentRow } from '../../../core/fs/fs.models';
import { formatModified, formatSize } from '../../../shared/format';
import { DISPLAY } from '../../../core/settings/display';
import { TEXTS } from '../../workspace/texts';

export { iconFor };

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
    if (marked) {
      const i = domService.createElement<HTMLElement>('i');
      domService.addClass(i, 'fa');
      domService.addClass(i, 'fa-check');
      domService.appendChild(icon, i);
    } else if (entry) {
      const i = domService.createElement<HTMLElement>('i');
      domService.addClass(i, 'fa');
      domService.addClass(i, iconNameForEntry(entry));
      domService.appendChild(icon, i);
    }
    domService.appendChild(cellDiv, icon);
    if (marked) {
      const srText = domService.createElement<HTMLSpanElement>('span');
      domService.addClass(srText, 'ge-table-sr-only');
      domService.appendChild(srText, domService.createText(TEXTS.marked));
      domService.appendChild(cellDiv, srText);
    }
    const name = domService.createElement<HTMLSpanElement>('span');
    domService.addClass(name, 'fnf-name');
    domService.appendChild(
      name,
      domService.createText(entry ? displayName(entry) : String(cellValue ?? '')),
    );
    domService.appendChild(cellDiv, name);
    if (entry?.lossyName) {
      domService.setAttribute(cellDiv, 'title', TEXTS.lossyName);
    }
    return undefined;
  }
}

/**
 * The name as shown (design 015): folders as `[Name]`, files without extension –
 * if chosen in the settings. Sorting and operations keep the real name.
 */
export function displayName(entry: DirEntry): string {
  if (isParentRow(entry)) {
    return entry.name;
  }
  if (isNavigableDir(entry)) {
    return DISPLAY.folderBrackets() ? `[${entry.name}]` : entry.name;
  }
  if (DISPLAY.hideExtension()) {
    const dot = entry.name.lastIndexOf('.');
    if (dot > 0 && dot < entry.name.length - 1) {
      return entry.name.slice(0, dot);
    }
  }
  return entry.name;
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
