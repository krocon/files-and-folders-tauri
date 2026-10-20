import { Side } from '../../core/session/session.models';

/**
 * Pure rules of dragging tabs (design 031 E1–E4). Indexes are insertion
 * positions *before* the dragged tab is taken out: 0 = before the first tab,
 * `count` = after the last one.
 */

/** Where a dragged tab would land. */
export interface TabDropTarget {
  readonly side: Side;
  readonly index: number;
}

/** Most tabs per side (re-exported by `WorkspaceStore`). */
export const MAX_TABS = 50;

/** Why a point is no target although it lies over a tab bar or panel. */
export type TabDropBlock = 'lastTab' | 'full';

/**
 * The insertion position for pointer `x` in a tab bar: before the first tab
 * whose middle lies right of `x`, else after the last one.
 */
export function insertionIndex(middles: readonly number[], x: number): number {
  const i = middles.findIndex((m) => x < m);
  return i < 0 ? middles.length : i;
}

/** The index of the moved tab after taking it out at `from` and inserting at `insertAt` (same side). */
export function placeIndex(from: number, insertAt: number): number {
  return insertAt > from ? insertAt - 1 : insertAt;
}

export interface TabDropQuery {
  readonly from: Side;
  readonly fromIndex: number;
  readonly fromCount: number;
  readonly to: Side;
  readonly toCount: number;
  readonly index: number;
  readonly copy: boolean;
}

/**
 * Whether a drop changes something (E4): `null` = allowed; `'noop'` = the tab
 * would stay where it is; otherwise the reason it is refused.
 */
export function tabDropCheck(q: TabDropQuery): TabDropBlock | 'noop' | null {
  const sameSide = q.from === q.to;
  if (!q.copy && sameSide) {
    return q.index === q.fromIndex || q.index === q.fromIndex + 1 ? 'noop' : null;
  }
  if (!q.copy && q.fromCount <= 1) {
    return 'lastTab'; // the last tab of a side stays
  }
  return q.toCount >= MAX_TABS ? 'full' : null;
}

/** Copy instead of move: ⌥ on macOS (Finder), Ctrl on Windows/Linux (Explorer, browsers). */
export function tabDragCopies(
  mods: { readonly ctrlKey: boolean; readonly altKey: boolean },
  isMac: boolean,
): boolean {
  return isMac ? mods.altKey : mods.ctrlKey;
}
