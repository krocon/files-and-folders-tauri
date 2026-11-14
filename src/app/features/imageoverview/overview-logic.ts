import { THUMB_STEPS, OverviewItem } from '../../core/imageoverview/image-overview.models';
import { DirEntry } from '../../core/fs/fs.models';

/** Pure helpers of the image overview (design 074) – tested without Angular. */

export type OverviewSort = 'name' | 'date' | 'size' | 'type';

/** Tile widths (E12). */
export const MIN_TILE = 96;
export const MAX_TILE = 640;
/** One step of Mod+= / Mod+- / Mod+wheel (E12). */
export const TILE_FACTOR = 1.25;
/** Height of the name line below the picture. */
export const NAME_LINE = 24;
/** The picture is 4 : 3 (landscape photos fill it, portraits sit in the middle). */
export const PICTURE_RATIO = 3 / 4;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * The images in `sort` order; ties by name (natural: `IMG_2` before `IMG_10`), then by the
 * relative path, so the order is stable with subfolders.
 */
export function sortItems(items: readonly OverviewItem[], sort: OverviewSort): OverviewItem[] {
  const byName = (a: OverviewItem, b: OverviewItem) =>
    collator.compare(a.name, b.name) || collator.compare(a.rel, b.rel);
  const key: Record<OverviewSort, (a: OverviewItem, b: OverviewItem) => number> = {
    name: (a, b) => collator.compare(a.rel, b.rel) || byName(a, b),
    date: (a, b) => (a.modifiedMs ?? 0) - (b.modifiedMs ?? 0) || byName(a, b),
    size: (a, b) => a.size - b.size || byName(a, b),
    type: (a, b) => collator.compare(extensionOf(a.name), extensionOf(b.name)) || byName(a, b),
  };
  return [...items].sort(key[sort]);
}

/** Lower case, NFC, without diacritics – for the filter and the type-ahead. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').toLowerCase();
}

/** The images whose name contains `filter` (folded); empty filter = all. */
export function filterItems(items: readonly OverviewItem[], filter: string): OverviewItem[] {
  const f = fold(filter.trim());
  return f === '' ? [...items] : items.filter((i) => fold(i.name).includes(f));
}

/** The tile width, kept within the limits. */
export function clampTile(width: number): number {
  return Math.round(Math.min(MAX_TILE, Math.max(MIN_TILE, width)));
}

/** The next tile width for Mod+= (`+1`) or Mod+- (`-1`). */
export function zoomTile(width: number, direction: 1 | -1): number {
  return clampTile(direction > 0 ? width * TILE_FACTOR : width / TILE_FACTOR);
}

/** Height of a tile of `width` px: the 4 : 3 picture and the name line. */
export function tileHeight(width: number): number {
  return Math.round(width * PICTURE_RATIO) + NAME_LINE;
}

/**
 * The thumbnail step to load for a tile of `width` px (E4): the smallest of the three small
 * steps at least `width × dpr` wide, else the largest small step – CSS scales between them.
 */
export function thumbStep(width: number, dpr: number): number {
  const need = width * Math.max(1, dpr);
  const small = THUMB_STEPS.length - 1;
  for (let s = 0; s < small; s++) {
    if (THUMB_STEPS[s] >= need) {
      return s;
    }
  }
  return small - 1;
}

/** Index of `path` in `items`, or -1. */
export function indexOfPath(items: readonly OverviewItem[], path: string | null): number {
  return path === null ? -1 : items.findIndex((i) => i.path === path);
}

/** The paths from `a` to `b` (both included, either order) – Shift+move/click marks a range. */
export function rangePaths(items: readonly OverviewItem[], a: number, b: number): string[] {
  if (items.length === 0) {
    return [];
  }
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(items.length - 1, Math.max(a, b));
  return items.slice(lo, hi + 1).map((i) => i.path);
}

/**
 * Type-ahead (like the list): the first image from `from` on (wrapping) whose name starts with
 * `prefix`; -1 if none.
 */
export function findByPrefix(items: readonly OverviewItem[], prefix: string, from: number): number {
  const p = fold(prefix);
  if (p === '' || items.length === 0) {
    return -1;
  }
  const n = items.length;
  const start = ((from % n) + n) % n;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (fold(items[i].name).startsWith(p)) {
      return i;
    }
  }
  return -1;
}

/** An image as a `DirEntry` – what the operations (copy, move, delete) work on (E15). */
export function toEntry(item: OverviewItem): DirEntry {
  return {
    name: item.name,
    path: item.path,
    kind: 'file',
    targetKind: null,
    size: item.size,
    modifiedMs: item.modifiedMs,
    hidden: false,
    lossyName: false,
  };
}

/** The items without the removed paths, or the same array when none was there. */
export function withoutPaths(
  items: readonly OverviewItem[],
  removed: ReadonlySet<string>,
): readonly OverviewItem[] {
  return items.some((i) => removed.has(i.path)) ? items.filter((i) => !removed.has(i.path)) : items;
}
