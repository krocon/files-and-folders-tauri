/**
 * Arithmetic of the tile grid – taken from Comic Commander (design 004 E6/E7/E10, MIT, same
 * author) for the image overview (design 074 E2). Pure, tested without the table.
 */

export interface Size {
  width: number;
  height: number;
}

export interface GridLayout {
  cols: number;
  coverWidth: number;
  coverHeight: number;
}

/**
 * Columns and cover size for `width` px (E6): as many covers of the chosen size as fit, then
 * stretched to the full width – no free stripe on the right (the template left up to one cover
 * width free). At least one column.
 */
export function gridLayout(width: number, dim: Size): GridLayout {
  const w = Math.max(1, Math.floor(width));
  const cols = Math.max(1, Math.floor(w / Math.max(1, dim.width)));
  const coverWidth = Math.max(1, Math.floor(w / cols));
  const coverHeight = Math.max(1, Math.round((coverWidth * dim.height) / Math.max(1, dim.width)));
  return { cols, coverWidth, coverHeight };
}

/**
 * The thumbnail size to load (E2): the smallest of `dims` at least `displayWidth × dpr` wide,
 * else the largest. Retina loads `_xl` instead of an upscaled 200 px cover.
 */
export function loadDimIndex(dims: readonly Size[], displayWidth: number, dpr: number): number {
  if (!dims.length) return 0;
  const need = displayWidth * Math.max(1, dpr);
  let best = -1;
  let largest = 0;
  dims.forEach((d, i) => {
    if (d.width > dims[largest].width) largest = i;
    if (d.width >= need && (best < 0 || d.width < dims[best].width)) best = i;
  });
  return best >= 0 ? best : largest;
}

export type CursorMove = 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'pageUp' | 'pageDown';

/** The cursor after `move` (E7); `index < 0` = no cursor yet → the first book. */
export function moveCursor(
  index: number,
  move: CursorMove,
  cols: number,
  count: number,
  pageRows: number,
): number {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return 0;
  const last = count - 1;
  const page = Math.max(1, pageRows) * cols;
  switch (move) {
    case 'left':
      return Math.max(0, index - 1);
    case 'right':
      return Math.min(last, index + 1);
    case 'up':
      return index - cols >= 0 ? index - cols : index;
    case 'down':
      // into a shorter last row: its last cover
      return index + cols <= last
        ? index + cols
        : Math.floor(index / cols) < Math.floor(last / cols)
          ? last
          : index;
    case 'home':
      return 0;
    case 'end':
      return last;
    case 'pageUp':
      return index - page >= 0 ? index - page : index % cols;
    case 'pageDown':
      return Math.min(last, index + page);
  }
}

/** Full rows in the visible part below the toolbar. */
export function pageRows(viewHeight: number, coverHeight: number, paddingTop: number): number {
  return Math.max(1, Math.floor((viewHeight - paddingTop) / Math.max(1, coverHeight)));
}

/**
 * Scroll position that shows cover `index` completely below the floating toolbar, or `null`
 * when it is visible already. Row `r` starts at `paddingTop + r × coverHeight` (row 0 is
 * `paddingTop` higher, the cover sits at its bottom).
 */
export function scrollToShow(
  index: number,
  cols: number,
  coverHeight: number,
  paddingTop: number,
  viewHeight: number,
  scrollTop: number,
): number | null {
  if (index < 0) return null;
  const row = Math.floor(index / cols);
  const top = paddingTop + row * coverHeight;
  if (top < scrollTop + paddingTop) return row * coverHeight;
  if (top + coverHeight > scrollTop + viewHeight) {
    return Math.max(0, top + coverHeight - viewHeight);
  }
  return null;
}

/** Index of the first cover in the first (partly) visible row (E10). */
export function topIndex(scrollTop: number, cols: number, coverHeight: number): number {
  return Math.max(0, Math.floor(Math.max(0, scrollTop) / Math.max(1, coverHeight))) * cols;
}

/** Scroll position that puts the row of `index` right below the toolbar (E10). */
export function scrollForTop(index: number, cols: number, coverHeight: number): number {
  return index <= 0 ? 0 : Math.floor(index / cols) * coverHeight;
}
