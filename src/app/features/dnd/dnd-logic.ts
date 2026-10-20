import { DirEntry, DirectoryListing, isNavigableDir, isParentRow } from '../../core/fs/fs.models';
import { Side } from '../../core/session/session.models';
import { translatable } from '../../core/i18n/i18n';
import { DND_DE } from './dnd-texts.de';

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

/** What a panel shows, as far as drag and drop needs it (the panel store). */
export interface PanelView {
  /** The folder, null for a result tab. */
  path(): string | null;
  /** The folder or `search:<key>`. */
  locationKey(): string | null;
  listing(): DirectoryListing | null;
}

/** The zone hit of a panel: a result tab has no folder to drop into (review 012 #4a). */
export function panelZoneHit(side: Side, view: PanelView, row: DirEntry | null): ZoneHit {
  const dir = view.path();
  const listing = view.listing();
  return {
    side,
    panelDir: dir,
    panelName: dir === null ? '' : (listing?.segments.at(-1)?.name ?? dir),
    row,
  };
}

/** The folder dragged entries come from – for a result tab its location key (review 012 #4b). */
export function dragOriginDir(view: PanelView): string | null {
  return view.locationKey();
}

/**
 * The pointer is outside the window (design 028 E1) – a drag from a panel then
 * becomes a system drag. With pointer capture the webview keeps reporting moves
 * outside, with coordinates beyond the viewport.
 */
export function leftWindow(x: number, y: number, width: number, height: number): boolean {
  return x < 0 || y < 0 || x >= width || y >= height;
}

/**
 * A `mouseout` towards nothing (`relatedTarget` null) at the window's edge: the
 * fallback in case a platform reports no moves outside the window (design 028 E1).
 */
export function leavingAtEdge(
  evt: { readonly clientX: number; readonly clientY: number; readonly relatedTarget: unknown },
  width: number,
  height: number,
): boolean {
  const edge = 2;
  const { clientX: x, clientY: y } = evt;
  return (
    evt.relatedTarget === null && (x < edge || y < edge || x >= width - edge || y >= height - edge)
  );
}

/** A key while dragging: cancel (Esc), switch copy/move (modifiers) or swallow (review 012 #9). */
export function dragKeyAction(evt: {
  readonly key: string;
  readonly type: string;
}): 'cancel' | 'modifier' | 'swallow' {
  if (evt.key === 'Escape') {
    return evt.type === 'keydown' ? 'cancel' : 'swallow';
  }
  return ['Shift', 'Meta', 'Control', 'Alt', 'OS'].includes(evt.key) ? 'modifier' : 'swallow';
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

export const DND_EN = {
  copy: 'Copy',
  move: 'Move',
  what: (count: number, first: string) => (count === 1 ? first : `${count} entries`),
  label: (kind: DragKind, count: number, first: string, target: DropTarget | null) =>
    `${kind === 'copy' ? 'Copy' : 'Move'} ${count === 1 ? first : `${count} entries`}` +
    (target ? ` → ${target.name}` : ' – no target here'),
  hint: (isMac: boolean) =>
    `${isMac ? '⌘: move' : 'Shift: move'} · Esc: cancel · out of the window: other apps`,
  notFromArchive: 'Entries inside an archive cannot be dragged to other apps – unpack them first.',
  dropFromSystem: (count: number) => `Copy ${count === 1 ? '1 item' : `${count} items`} here`,
  nothingDropped: 'The dropped items do not exist (any more).',
  missingDropped: (n: number) => `${n} dropped item(s) do not exist and were left out.`,
};

export const DND_TEXTS = translatable('dnd', DND_EN, { de: DND_DE });
