import { DirEntry, isNavigableDir, isParentRow } from '../../core/fs/fs.models';
import { Side } from '../../core/session/session.models';

/** Copy or move – a link (design 012 E5) needs a job kind that does not exist yet. */
export type DragKind = 'copy' | 'move';

/** Pixels the pointer must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 6;

/** Where a drag would land. */
export interface DropTarget {
  readonly side: Side;
  /** The folder the entries go into. */
  readonly dir: string;
  /** The folder row under the pointer (highlighted), null = the panel's folder. */
  readonly rowPath: string | null;
  /** Display name of the target folder. */
  readonly name: string;
}

/** What lies under the pointer in a panel. */
export interface ZoneHit {
  readonly side: Side;
  /** Folder shown by the panel. */
  readonly panelDir: string | null;
  /** Its display name (last path segment). */
  readonly panelName: string;
  /** The row under the pointer, if any. */
  readonly row: DirEntry | null;
}

/** Where the dragged entries come from (null side: from the system). */
export interface DragOrigin {
  readonly side: Side | null;
  /** Their folder (null: several folders). */
  readonly dir: string | null;
  readonly paths: ReadonlySet<string>;
}

/**
 * The entries a drag takes (Explorer/TC): the marked entries if the pressed row
 * is marked, otherwise only the pressed row. Never "..". Null = no drag.
 */
export function dragSources(
  row: DirEntry | null,
  isMarked: (path: string) => boolean,
  markedEntries: readonly DirEntry[],
): readonly DirEntry[] | null {
  if (!row || isParentRow(row)) {
    return null;
  }
  if (isMarked(row.path)) {
    const marked = markedEntries.filter((e) => !isParentRow(e));
    return marked.length > 0 ? marked : [row];
  }
  return [row];
}

/** Copy without modifier; move with Shift (Windows/Linux) or ⌘ (macOS, as in the Finder). */
export function dragKind(
  mods: { readonly shiftKey: boolean; readonly metaKey: boolean },
  isMac: boolean,
): DragKind {
  return (isMac ? mods.metaKey : mods.shiftKey) ? 'move' : 'copy';
}

/**
 * The drop target for a hit (design 012 E5): a folder row (also "..") that is
 * not one of the dragged entries; otherwise the panel's folder – but not the
 * dragged entries' own folder (nothing to do there).
 */
export function resolveDropTarget(hit: ZoneHit | null, origin: DragOrigin): DropTarget | null {
  if (!hit) {
    return null;
  }
  const row = hit.row;
  if (row && isNavigableDir(row) && !row.lossyName && !origin.paths.has(row.path)) {
    const name = isParentRow(row) ? '..' : row.name;
    if (row.path !== origin.dir) {
      return { side: hit.side, dir: row.path, rowPath: row.path, name };
    }
  }
  if (hit.panelDir === null || hit.panelDir === origin.dir) {
    return null;
  }
  return { side: hit.side, dir: hit.panelDir, rowPath: null, name: hit.panelName };
}

export const DND_TEXTS = {
  copy: 'Copy',
  move: 'Move',
  what: (count: number, first: string) => (count === 1 ? first : `${count} entries`),
  label: (kind: DragKind, count: number, first: string, target: DropTarget | null) =>
    `${kind === 'copy' ? 'Copy' : 'Move'} ${DND_TEXTS.what(count, first)}` +
    (target ? ` → ${target.name}` : ' – no target here'),
  hint: (isMac: boolean) => (isMac ? '⌘: move · Esc: cancel' : 'Shift: move · Esc: cancel'),
  dropFromSystem: (count: number) => `Copy ${count === 1 ? '1 item' : `${count} items`} here`,
  nothingDropped: 'The dropped items do not exist (any more).',
  missingDropped: (n: number) => `${n} dropped item(s) do not exist and were left out.`,
};
