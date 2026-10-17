import { ColumnDef, ColumnDefIf, Size, TrueFn, ValueRowSortComparator } from '@guiexpert/table';
import { DirEntry, isNavigableDir, isParentRow } from '../../../core/fs/fs.models';
import { DateCellRenderer, NameCellRenderer, SizeCellRenderer } from './file-renderers';

/** Column properties of the file list. `ext` is computed from the name. */
export type FileColumn = 'name' | 'ext' | 'size' | 'modifiedMs';

const COLLATOR_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };

/**
 * Natural, case-insensitive collator in the user's language. Some runtimes resolve
 * a POSIX/"C" locale (e.g. WebKitGTK with `LANG=C.UTF-8`) to code-point order, where
 * `B` sorts before `a` – then fall back to English rules (self-check, no locale sniffing).
 */
export function createNameCollator(
  make: (locale?: string) => Intl.Collator = (locale) =>
    new Intl.Collator(locale, COLLATOR_OPTIONS),
): Intl.Collator {
  const preferred = make(undefined);
  const sane = preferred.compare('a', 'B') < 0 && preferred.compare('file2', 'file10') < 0;
  return sane ? preferred : make('en');
}

const collator = createNameCollator();

/** Natural, case-insensitive name order (`file2` < `file10`), stable for equal names. */
export function compareNames(a: DirEntry, b: DirEntry): number {
  return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** Extension without dot for files (`archive.tar.gz` → `gz`), empty for folders and dot-files. */
export function extensionOf(entry: DirEntry): string {
  if (isNavigableDir(entry)) {
    return '';
  }
  const dot = entry.name.lastIndexOf('.');
  return dot > 0 && dot < entry.name.length - 1 ? entry.name.slice(dot + 1) : '';
}

/**
 * Wraps a row comparator for the GuiExpert Table. The table calls
 * `f * comparator(valueA, valueB, rowA, rowB, f)` with `f = 1` (asc) or `-1` (desc).
 * Returning `f * x` therefore yields `x` regardless of the direction – used to keep
 * folders on top and empty values (`isEmpty`) at the end in both directions.
 * Ties are broken by name (ascending in the current direction).
 */
function fileComparator(
  primary: (a: DirEntry, b: DirEntry) => number,
  isEmpty: (e: DirEntry) => boolean = () => false,
): ValueRowSortComparator {
  return (_va: unknown, _vb: unknown, rowA?: DirEntry, rowB?: DirEntry, f = 1) => {
    if (!rowA || !rowB) {
      return 0;
    }
    // ".." stays on top in both directions (design 003 E1)
    if (isParentRow(rowA) !== isParentRow(rowB)) {
      return f * (isParentRow(rowA) ? -1 : 1);
    }
    const dirA = isNavigableDir(rowA);
    const dirB = isNavigableDir(rowB);
    if (dirA !== dirB) {
      return f * (dirA ? -1 : 1);
    }
    const emptyA = isEmpty(rowA);
    const emptyB = isEmpty(rowB);
    if (emptyA !== emptyB) {
      return f * (emptyA ? 1 : -1);
    }
    return (emptyA ? 0 : primary(rowA, rowB)) || compareNames(rowA, rowB);
  };
}

/** Comparators per column, exported for unit tests. */
export const fileComparators: Record<FileColumn, ValueRowSortComparator> = {
  name: fileComparator(compareNames),
  ext: fileComparator((a, b) => collator.compare(extensionOf(a), extensionOf(b))),
  size: fileComparator(
    (a, b) => (a.size as number) - (b.size as number),
    (e) => e.size === null,
  ),
  modifiedMs: fileComparator(
    (a, b) => (a.modifiedMs as number) - (b.modifiedMs as number),
    (e) => e.modifiedMs === null,
  ),
};

const px = (value: number) => new Size(value, 'px');

/** Column definitions of the file list (created once per table). */
export function createFileColumns(): ColumnDefIf[] {
  return [
    ColumnDef.create({
      property: 'name',
      headerLabel: 'Name',
      // fills the remaining width (weight), never narrower than 160 px
      width: new Size(1, 'weight'),
      minWidth: px(160),
      sortable: TrueFn,
      sortState: 'asc',
      sortComparator: fileComparators.name,
      bodyRenderer: new NameCellRenderer(),
      headerClasses: ['ge-table-text-align-start'],
      bodyClasses: ['ge-table-text-align-start'],
    }),
    ColumnDef.create({
      property: 'ext',
      headerLabel: 'Ext',
      width: px(70),
      sortable: TrueFn,
      sortComparator: fileComparators.ext,
      valueGetter: (row: DirEntry) => extensionOf(row),
      headerClasses: ['ge-table-text-align-start'],
      bodyClasses: ['ge-table-text-align-start'],
    }),
    ColumnDef.create({
      property: 'size',
      headerLabel: 'Size',
      width: px(90),
      sortable: TrueFn,
      sortComparator: fileComparators.size,
      bodyRenderer: new SizeCellRenderer(),
      headerClasses: ['ge-table-text-align-end'],
      bodyClasses: ['ge-table-text-align-end'],
    }),
    ColumnDef.create({
      property: 'modifiedMs',
      headerLabel: 'Modified',
      width: px(160),
      sortable: TrueFn,
      sortComparator: fileComparators.modifiedMs,
      bodyRenderer: new DateCellRenderer(),
      headerClasses: ['ge-table-text-align-start'],
      bodyClasses: ['ge-table-text-align-start'],
    }),
  ];
}
