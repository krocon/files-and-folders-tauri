/**
 * Rows of the universal palette (design 043 E5) – pure: groups "Actions", "Folders",
 * "Files" with a header (count), the best few of a group and a "more …" row; the
 * order of the groups follows the query (a strong action match first).
 */
import { PaletteHit } from '../../core/palette/palette.models';
import { isNavigableDir } from '../../core/fs/fs.models';
import { fold, ParsedQuery } from './palette-query';

export type GroupId = 'actions' | 'folders' | 'files';

/** An action, tool, colour scheme or known folder (built by the palette component). */
export interface ItemRow {
  readonly kind: 'action' | 'extra' | 'theme' | 'folder';
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly shortcut: string;
  readonly ready: boolean;
  readonly hint: string;
  readonly score: number;
  readonly parts: readonly { readonly text: string; readonly hit: boolean }[];
}

export type PaletteRow =
  | {
      readonly kind: 'header';
      readonly key: string;
      readonly group: GroupId;
      readonly shown: number;
      readonly total: number;
    }
  | {
      readonly kind: 'more';
      readonly key: string;
      readonly group: GroupId;
      readonly hidden: number;
    }
  | ({ readonly group: GroupId } & ItemRow)
  | {
      readonly kind: 'hit';
      readonly key: string;
      readonly group: GroupId;
      readonly hit: PaletteHit;
    };

export type SelectableRow = Exclude<PaletteRow, { kind: 'header' }>;

/** Rows of a group before "more …" (until expanded). */
export const COLLAPSED: Readonly<Record<GroupId, number>> = { actions: 5, folders: 6, files: 400 };
/** Everything an action-only query (`>`) or an empty query lists. */
export const ALL_ACTIONS = 400;

export interface RowsInput {
  readonly query: ParsedQuery;
  /** Actions, tools, colour schemes – sorted by score. */
  readonly actions: readonly ItemRow[];
  /** Known folders (tabs, favourites, history) that match, and the typed path. */
  readonly folders: readonly ItemRow[];
  /** Hits from Rust, best first. */
  readonly hits: readonly PaletteHit[];
  readonly expanded: ReadonlySet<GroupId>;
  /** The query is plain words (no filter): actions can match. */
  readonly actionsMatch: boolean;
}

export function isSelectable(row: PaletteRow): row is SelectableRow {
  return row.kind !== 'header';
}

/** An action label contains the words at a word start: actions come first. */
export function strongAction(plain: string, label: string): boolean {
  const q = fold(plain.trim());
  if (!q) {
    return false;
  }
  const l = fold(label);
  const at = l.indexOf(q);
  return at === 0 || (at > 0 && !/[\p{L}\p{N}]/u.test(l[at - 1]));
}

export function buildRows(input: RowsInput): PaletteRow[] {
  const { query, expanded } = input;
  const out: PaletteRow[] = [];
  const group = (id: GroupId, items: readonly SelectableRow[], limit: number, header = true) => {
    if (items.length === 0) {
      return;
    }
    const shown = expanded.has(id) ? items.length : Math.min(items.length, limit);
    if (header) {
      out.push({ kind: 'header', key: `h:${id}`, group: id, shown, total: items.length });
    }
    out.push(...items.slice(0, shown));
    if (shown < items.length) {
      out.push({ kind: 'more', key: `m:${id}`, group: id, hidden: items.length - shown });
    }
  };
  const actionItems = input.actionsMatch ? input.actions : [];
  const actions: SelectableRow[] = actionItems.map((a) => ({ ...a, group: 'actions' as const }));
  // `>` and the empty query: the action list as before (no headers)
  if (
    query.mode === 'actions' ||
    (query.mode === 'files' && query.plain === '' && !input.hits.length && !input.folders.length)
  ) {
    group('actions', actions, ALL_ACTIONS, false);
    return out;
  }
  const seen = new Set<string>();
  const folders: SelectableRow[] = [];
  for (const f of input.folders) {
    seen.add(f.id);
    folders.push({ ...f, group: 'folders' });
  }
  const files: SelectableRow[] = [];
  for (const hit of input.hits) {
    if (seen.has(hit.path)) {
      continue;
    }
    seen.add(hit.path);
    const row = { kind: 'hit' as const, key: `hit:${hit.path}`, hit };
    if (query.mode !== 'path' && isNavigableDir(hit)) {
      folders.push({ ...row, group: 'folders' });
    } else {
      files.push({ ...row, group: 'files' });
    }
  }
  const strong = actionItems.length > 0 && strongAction(query.plain, actionItems[0].label);
  if (strong) {
    group('actions', actions, COLLAPSED.actions);
  }
  group('folders', folders, query.mode === 'path' ? COLLAPSED.files : COLLAPSED.folders);
  group('files', files, COLLAPSED.files);
  if (!strong) {
    group('actions', actions, COLLAPSED.actions);
  }
  return out;
}

/** The next selectable row from `from` in direction `step` (wrapping), -1 if none. */
export function nextSelectable(rows: readonly PaletteRow[], from: number, step: number): number {
  const n = rows.length;
  if (n === 0) {
    return -1;
  }
  let i = from;
  for (let k = 0; k < n; k++) {
    i = (((i + step) % n) + n) % n;
    if (isSelectable(rows[i])) {
      return i;
    }
  }
  return -1;
}

/** The first selectable row at or after `from` (or before, at the end). */
export function nearestSelectable(rows: readonly PaletteRow[], from: number): number {
  for (let i = Math.max(0, from); i < rows.length; i++) {
    if (isSelectable(rows[i])) {
      return i;
    }
  }
  for (let i = Math.min(from, rows.length - 1); i >= 0; i--) {
    if (isSelectable(rows[i])) {
      return i;
    }
  }
  return -1;
}

/** Name split into highlighted parts at the UTF-16 ranges from Rust. */
export function highlight(
  name: string,
  ranges: readonly (readonly [number, number])[],
): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    const start = Math.max(at, Math.min(a, name.length));
    const end = Math.max(start, Math.min(b, name.length));
    if (start > at) {
      parts.push({ text: name.slice(at, start), hit: false });
    }
    if (end > start) {
      parts.push({ text: name.slice(start, end), hit: true });
    }
    at = end;
  }
  if (at < name.length) {
    parts.push({ text: name.slice(at), hit: false });
  }
  return parts;
}

/**
 * A long folder shortened in the middle for one row (`/home/marc/…/2025`); the full
 * path goes into the tooltip. Works on the string – no path is split for logic.
 */
export function shortPath(path: string, max = 60): string {
  if (path.length <= max) {
    return path;
  }
  const keep = max - 1;
  const head = Math.ceil(keep * 0.4);
  return `${path.slice(0, head)}…${path.slice(path.length - (keep - head))}`;
}

/** Merges a batch into the hits: one per path (the better rank wins), best first, at most `limit`. */
export function mergeHits(
  current: readonly PaletteHit[],
  batch: readonly PaletteHit[],
  limit: number,
): PaletteHit[] {
  const byPath = new Map<string, PaletteHit>();
  for (const h of [...current, ...batch]) {
    const old = byPath.get(h.path);
    if (!old || h.score > old.score) {
      byPath.set(h.path, h);
    }
  }
  return [...byPath.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** The window of a virtualised list: first row and count (with some rows above and below). */
export function visibleWindow(
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  total: number,
  overscan = 6,
): { readonly first: number; readonly count: number } {
  const rows = Math.max(1, Math.ceil((viewport > 0 ? viewport : rowHeight * 16) / rowHeight));
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const count = Math.min(total - first, rows + 2 * overscan);
  return { first, count: Math.max(0, count) };
}
