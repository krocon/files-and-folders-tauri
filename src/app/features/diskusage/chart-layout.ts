import { SizeMode, sizeOf, UsageNode } from '../../core/diskusage/disk-usage.models';

/**
 * Pure layouts of the disk-usage chart (design 033 E2): rings (sunburst) and tiles
 * (squarified treemap). Input is the (pruned) tree Rust sends; output are plain
 * shapes the SVG component draws. Small children are folded into one `rest` shape
 * per parent so the drawing stays light.
 */

export interface Shape {
  readonly node: UsageNode;
  /** 1 = a child of the shown node. */
  readonly depth: number;
  /** Index of the top-level child the shape belongs to (colour). */
  readonly branch: number;
  /** An aggregate or a folded rest – nothing to navigate to. */
  readonly virtual: boolean;
  /** Id of the folder the shape lies in (shapes come parents first). */
  readonly parent: number;
}

export interface Arc extends Shape {
  /** Angles in radians, clockwise from 12 o'clock. */
  readonly a0: number;
  readonly a1: number;
}

export interface Tile extends Shape {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const RING_DEPTH = 4;
/** Arcs narrower than this are folded (0.5°). */
export const MIN_ANGLE = (0.5 * Math.PI) / 180;
export const TILE_DEPTH = 3;
/** Tiles smaller than this (px²) are folded. */
export const MIN_AREA = 24;
/** Inner padding of a folder tile around its children. */
export const TILE_PAD = 2;
/** Room for the name of a first-level folder tile above its children. */
export const TILE_HEAD = 14;

function isVirtual(n: UsageNode): boolean {
  return n.kind === 'files' || n.kind === 'rest' || n.path === null;
}

/** A folded rest of `parent`: what was too small to draw. */
function restNode(parent: UsageNode, count: number, allocated: number, logical: number): UsageNode {
  return {
    id: parent.id,
    name: '',
    path: null,
    kind: 'rest',
    allocated,
    logical,
    files: count,
    dirs: 0,
    unreadable: 0,
    modifiedMs: null,
    lossyName: false,
  };
}

/** Rings: the children of `root` around its centre, `depth` rings deep. */
export function sunburst(
  root: UsageNode,
  mode: SizeMode,
  depth = RING_DEPTH,
  minAngle = MIN_ANGLE,
): Arc[] {
  const out: Arc[] = [];
  const walk = (node: UsageNode, level: number, a0: number, a1: number, branch: number) => {
    const total = sizeOf(node, mode);
    if (total <= 0 || !node.children || level > depth) {
      return;
    }
    let a = a0;
    let restCount = 0;
    let restA = 0;
    let restL = 0;
    let restSpan = 0;
    node.children.forEach((c, i) => {
      const span = ((a1 - a0) * sizeOf(c, mode)) / total;
      if (span <= 0) {
        return;
      }
      if (span < minAngle) {
        restCount += c.kind === 'rest' ? c.files : 1;
        restA += c.allocated;
        restL += c.logical;
        restSpan += span;
        return;
      }
      const b = level === 1 ? i : branch;
      out.push({
        node: c,
        depth: level,
        branch: b,
        virtual: isVirtual(c),
        parent: node.id,
        a0: a,
        a1: a + span,
      });
      if (c.kind === 'dir') {
        walk(c, level + 1, a, a + span, b);
      }
      a += span;
    });
    if (restSpan > 0) {
      out.push({
        node: restNode(node, restCount, restA, restL),
        depth: level,
        branch: level === 1 ? -1 : branch,
        virtual: true,
        parent: node.id,
        a0: a,
        a1: a + restSpan,
      });
    }
  };
  walk(root, 1, 0, 2 * Math.PI, 0);
  return out;
}

/** SVG path of a ring segment; radii in px around (cx, cy). */
export function arcPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): string {
  const full = a1 - a0 >= 2 * Math.PI - 1e-6;
  const p = (r: number, a: number) =>
    `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  if (full) {
    // two half arcs (an arc cannot start and end at the same point)
    const m = a0 + Math.PI;
    return (
      `M ${p(r1, a0)} A ${r1} ${r1} 0 1 1 ${p(r1, m)} A ${r1} ${r1} 0 1 1 ${p(r1, a0)} ` +
      `M ${p(r0, a0)} A ${r0} ${r0} 0 1 0 ${p(r0, m)} A ${r0} ${r0} 0 1 0 ${p(r0, a0)} Z`
    );
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return (
    `M ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} ` +
    `L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`
  );
}

interface Item {
  readonly node: UsageNode;
  readonly area: number;
  readonly index: number;
}

/** Worst aspect ratio of a row of areas laid along a side of length `side`. */
function worst(row: readonly Item[], side: number): number {
  const sum = row.reduce((s, r) => s + r.area, 0);
  let max = 0;
  for (const r of row) {
    const a = (side * side * r.area) / (sum * sum);
    max = Math.max(max, a, 1 / a);
  }
  return max;
}

/** Squarified layout of `items` (areas in px², largest first) into a rectangle. */
function squarify(
  items: readonly Item[],
  x: number,
  y: number,
  w: number,
  h: number,
): { item: Item; x: number; y: number; w: number; h: number }[] {
  const out: { item: Item; x: number; y: number; w: number; h: number }[] = [];
  let rest = [...items];
  while (rest.length > 0 && w > 0 && h > 0) {
    const side = Math.min(w, h);
    const row: Item[] = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) {
      row.push(rest[i]);
      i++;
    }
    rest = rest.slice(i);
    const sum = row.reduce((s, r) => s + r.area, 0);
    if (w >= h) {
      // a column at the left
      const cw = sum / h;
      let cy = y;
      for (const r of row) {
        const rh = r.area / cw;
        out.push({ item: r, x, y: cy, w: cw, h: rh });
        cy += rh;
      }
      x += cw;
      w -= cw;
    } else {
      // a row at the top
      const rh = sum / w;
      let cx = x;
      for (const r of row) {
        const rw = r.area / rh;
        out.push({ item: r, x: cx, y, w: rw, h: rh });
        cx += rw;
      }
      y += rh;
      h -= rh;
    }
  }
  return out;
}

/** Tiles: the children of `root` in a `width` × `height` rectangle, `depth` levels deep. */
export function treemap(
  root: UsageNode,
  mode: SizeMode,
  width: number,
  height: number,
  depth = TILE_DEPTH,
  minArea = MIN_AREA,
): Tile[] {
  const out: Tile[] = [];
  const walk = (
    node: UsageNode,
    level: number,
    x: number,
    y: number,
    w: number,
    h: number,
    branch: number,
  ) => {
    const total = sizeOf(node, mode);
    if (total <= 0 || !node.children || level > depth || w <= 0 || h <= 0) {
      return;
    }
    // the children's sizes may add up to less than the node (a folder's own blocks)
    const kidsTotal = node.children.reduce((s, c) => s + sizeOf(c, mode), 0);
    const scale = (w * h) / Math.max(total, kidsTotal);
    const items: Item[] = [];
    let restCount = 0;
    let restA = 0;
    let restL = 0;
    let restArea = 0;
    node.children.forEach((c, index) => {
      const area = sizeOf(c, mode) * scale;
      if (area <= 0) {
        return;
      }
      if (area < minArea) {
        restCount += c.kind === 'rest' ? c.files : 1;
        restA += c.allocated;
        restL += c.logical;
        restArea += area;
      } else {
        items.push({ node: c, area, index });
      }
    });
    if (restArea > 0) {
      items.push({ node: restNode(node, restCount, restA, restL), area: restArea, index: -1 });
    }
    items.sort((a, b) => b.area - a.area);
    for (const r of squarify(items, x, y, w, h)) {
      const b = level === 1 ? r.item.index : branch;
      const n = r.item.node;
      out.push({
        node: n,
        depth: level,
        branch: b,
        virtual: isVirtual(n),
        parent: node.id,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
      });
      if (n.kind === 'dir' && r.w > 4 * TILE_PAD && r.h > 4 * TILE_PAD) {
        const head = level === 1 && r.w > 40 && r.h > 3 * TILE_HEAD ? TILE_HEAD : 0;
        walk(
          n,
          level + 1,
          r.x + TILE_PAD,
          r.y + TILE_PAD + head,
          r.w - 2 * TILE_PAD,
          r.h - 2 * TILE_PAD - head,
          b,
        );
      }
    }
  };
  walk(root, 1, 0, 0, width, height, 0);
  return out;
}
