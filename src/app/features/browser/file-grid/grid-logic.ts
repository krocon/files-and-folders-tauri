import { DirEntry } from '../../../core/fs/fs.models';

/**
 * Arithmetic of the tile views of a panel (design 041 E5/E6) – pure. Brief: one line
 * per tile (icon + name), several tiles side by side. Thumbnails: a picture (or the
 * big icon) with the name below. Both fill row by row and scroll vertically – what the
 * GuiExpert cover grid lays out.
 */
export type GridMode = 'brief' | 'thumbnails';

/** A brief tile is at least this wide (px); the width left over is shared. */
export const BRIEF_MIN_WIDTH = 220;
/** Space around the picture of a thumbnail tile (px, each side). */
export const TILE_PADDING = 6;
/** Height of the name under a thumbnail (px). */
export const TILE_LABEL = 22;
/** Picture box: 4:3 like the image overview (design 074). */
export const PICTURE_RATIO = 3 / 4;

export interface TileLayout {
  readonly cols: number;
  readonly cellWidth: number;
  readonly rowHeight: number;
  /** Height of the picture box of a thumbnail tile, 0 in the brief view. */
  readonly pictureHeight: number;
}

/**
 * Columns and tile size for `width` px: as many tiles of the wanted width as fit, then
 * stretched to the full width (no free stripe on the right). At least one column.
 */
export function tileLayout(
  mode: GridMode,
  width: number,
  listRowHeight: number,
  thumbSize: number,
): TileLayout {
  const w = Math.max(1, Math.floor(width));
  const wanted = mode === 'brief' ? BRIEF_MIN_WIDTH : Math.max(32, thumbSize) + 2 * TILE_PADDING;
  const cols = Math.max(1, Math.floor(w / wanted));
  const cellWidth = Math.max(1, Math.floor(w / cols));
  if (mode === 'brief') {
    return { cols, cellWidth, rowHeight: Math.max(1, listRowHeight), pictureHeight: 0 };
  }
  const pictureHeight = Math.round((cellWidth - 2 * TILE_PADDING) * PICTURE_RATIO);
  return {
    cols,
    cellWidth,
    rowHeight: pictureHeight + 2 * TILE_PADDING + TILE_LABEL,
    pictureHeight,
  };
}

/** Index of the entry in a cell, -1 for the empty cells behind the last entry. */
export function cellIndex(row: number, col: number, cols: number, count: number): number {
  if (row < 0 || col < 0 || col >= cols) {
    return -1;
  }
  const i = row * cols + col;
  return i < count ? i : -1;
}

/** Rows the grid needs for `count` tiles. */
export function rowCount(count: number, cols: number): number {
  return Math.ceil(Math.max(0, count) / Math.max(1, cols));
}

/**
 * Changes when a listing may show other pictures: another folder, another number of
 * entries, or a file written anew (thumbnails are listed by Rust per folder, E6).
 */
export function listingStamp(path: string, entries: readonly DirEntry[]): string {
  let newest = 0;
  let bytes = 0;
  for (const e of entries) {
    if (e.modifiedMs !== null && e.modifiedMs > newest) {
      newest = e.modifiedMs;
    }
    bytes += e.size ?? 0;
  }
  return `${entries.length}|${newest}|${bytes}|${path}`;
}
