import type { TableColumnStateIf, TableStateIf } from '@guiexpert/table';

/**
 * Which columns the file list shows, and in which order (design 041 E1/E2) – pure.
 * The choice is global (setting `view.columns`); widths belong to a tab (its table
 * state in the session). {@link columnLayout} merges both with what the kind of tab
 * needs into one `columns` state for `TableApi.applyState`.
 */
export const USER_COLUMNS = [
  'name',
  'ext',
  'size',
  'modifiedMs',
  'createdMs',
  'accessedMs',
  'attrs',
  'type',
] as const;

export type UserColumn = (typeof USER_COLUMNS)[number];

/** The columns of a new installation – those the list always had. */
export const DEFAULT_COLUMNS: readonly UserColumn[] = ['name', 'ext', 'size', 'modifiedMs'];

/** Columns showing a date: their width follows the date format (E3). */
export const DATE_COLUMNS: readonly UserColumn[] = ['modifiedMs', 'createdMs', 'accessedMs'];

/** Columns of result tabs, shown by the kind of tab – behind the chosen ones, in this order. */
export const SPECIAL_COLUMNS = [
  'group',
  'decision',
  'pixels',
  'share',
  'items',
  'dir',
  'relDir',
] as const;

export type SpecialColumn = (typeof SPECIAL_COLUMNS)[number];

/** What the tab shows – decides the special columns (designs 009, 033, 038, 042). */
export interface ColumnContext {
  /** Disk usage: name, size, share, objects (design 033). */
  readonly usage?: boolean;
  /** Duplicates: the group, no extension column (design 042). */
  readonly duplicates?: boolean;
  readonly decision?: boolean;
  readonly pixels?: boolean;
  /** Folder of a hit (search results). */
  readonly dir?: boolean;
  /** Folder relative to the root (flat view). */
  readonly relDir?: boolean;
}

export function isUserColumn(value: unknown): value is UserColumn {
  return typeof value === 'string' && (USER_COLUMNS as readonly string[]).includes(value);
}

/**
 * The chosen columns from a stored value: known ones, each once, in their order; the
 * name is always there (first, if it was missing). Anything else → the defaults.
 */
export function sanitizeColumns(raw: unknown): UserColumn[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_COLUMNS];
  }
  const out: UserColumn[] = [];
  for (const v of raw) {
    if (isUserColumn(v) && !out.includes(v)) {
      out.push(v);
    }
  }
  if (!out.includes('name')) {
    out.unshift('name');
  }
  return out;
}

/**
 * Shows or hides one column. The name stays. A column shown again goes behind the last
 * chosen column that stands before it in {@link USER_COLUMNS} (where one expects it).
 */
export function toggleColumn(chosen: readonly UserColumn[], column: UserColumn): UserColumn[] {
  if (chosen.includes(column)) {
    return column === 'name' ? [...chosen] : chosen.filter((c) => c !== column);
  }
  const rank = USER_COLUMNS.indexOf(column);
  let at = 0;
  chosen.forEach((c, i) => {
    if (USER_COLUMNS.indexOf(c) < rank) {
      at = i + 1;
    }
  });
  return [...chosen.slice(0, at), column, ...chosen.slice(at)];
}

/** Moves the entry at `index` by `delta` places (clamped); the same list if nothing moves. */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const to = Math.max(0, Math.min(list.length - 1, index + delta));
  if (index < 0 || index >= list.length || to === index) {
    return [...list];
  }
  const out = [...list];
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item);
  return out;
}

/** All user columns for the dialog: the chosen ones in their order, then the others. */
export function allColumnsInOrder(chosen: readonly UserColumn[]): UserColumn[] {
  return [...chosen, ...USER_COLUMNS.filter((c) => !chosen.includes(c))];
}

function userVisible(column: UserColumn, chosen: readonly UserColumn[], c: ColumnContext): boolean {
  if (c.usage) {
    // the share bar and the objects are the content: name and size with them (design 033)
    return column === 'name' || column === 'size';
  }
  if (c.duplicates && column === 'ext') {
    return false; // the decision needs the room – the name shows the extension (design 042)
  }
  return chosen.includes(column);
}

function specialVisible(column: SpecialColumn, c: ColumnContext): boolean {
  switch (column) {
    case 'group':
      return !!c.duplicates;
    case 'decision':
      return !!c.decision;
    case 'pixels':
      return !!c.pixels;
    case 'share':
    case 'items':
      return !!c.usage;
    case 'dir':
      return !!c.dir;
    case 'relDir':
      return !!c.relDir;
  }
}

/**
 * Order, visibility and widths of all columns as one table state part. `widths` are
 * those the user set in this tab, `auto` the measured widths of the date columns (E3);
 * a column without either keeps the width of the code.
 */
export function columnLayout(
  chosen: readonly UserColumn[],
  context: ColumnContext,
  widths: Readonly<Record<string, number>> = {},
  auto: Readonly<Record<string, number>> = {},
): TableColumnStateIf[] {
  const out: TableColumnStateIf[] = [];
  const add = (property: string, visible: boolean) => {
    const width = widths[property] ?? auto[property];
    out.push(width === undefined ? { property, visible } : { property, visible, width });
  };
  for (const c of allColumnsInOrder(chosen)) {
    add(c, userVisible(c, chosen, context));
  }
  for (const c of SPECIAL_COLUMNS) {
    add(c, specialVisible(c, context));
  }
  return out;
}

/** The widths a table state carries, by property. */
export function widthsOf(state: Partial<TableStateIf> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of state?.columns ?? []) {
    if (c && typeof c.property === 'string' && typeof c.width === 'number' && c.width >= 0) {
      out[c.property] = c.width;
    }
  }
  return out;
}

/**
 * A table state without the widths we set ourselves (E3): a date column that is as wide
 * as its measured width was not resized by the user – it follows the next format.
 */
export function stripAutoWidths<T extends Partial<TableStateIf>>(
  state: T,
  auto: Readonly<Record<string, number>>,
): T {
  if (!state.columns) {
    return state;
  }
  return {
    ...state,
    columns: state.columns.map((c) => {
      const a = auto[c.property];
      if (a === undefined || c.width === undefined || Math.abs(c.width - a) >= 1) {
        return c;
      }
      const rest = { ...c };
      delete rest.width;
      return rest;
    }),
  };
}

/** Inner spacing of a cell (`.fnf-cell`: 10 px on each side). */
export const CELL_PADDING = 20;
/** A date column is never narrower than its title with the sort arrow. */
export const MIN_DATE_WIDTH = 110;

/**
 * Width of a date column for `sample`, a wide date in the current format (E3, the bug
 * of TODO §4: 160 px cut the US format `12/28/2026, 10:48 PM`). Digits are not equally
 * wide in every font: the sample is measured with each digit in all its places.
 */
export function dateColumnWidth(sample: string, measure: (text: string) => number): number {
  let widest = 0;
  for (let digit = 0; digit <= 9; digit++) {
    widest = Math.max(widest, measure(sample.replace(/\d/g, String(digit))));
  }
  return Math.max(MIN_DATE_WIDTH, Math.ceil(widest) + CELL_PADDING);
}

/** A date that is wide in every format: two-digit day, month and hour, afternoon. */
export const WIDE_DATE_MS = new Date(2028, 11, 28, 22, 48).getTime();

/** Text width without a layout (tests, no canvas): 8 px per character. */
export function roughTextWidth(text: string): number {
  return text.length * 8;
}
