import { DiskUsageView, UsageNode } from '../../core/diskusage/disk-usage.models';
import { isVirtualPath } from '../../core/fs/fs.models';
import { dragSources } from '../dnd/dnd-logic';
import { selectionForAction } from '../ops/ops-logic';
import { basketView, withLevelMarks, withoutPaths } from './basket-logic';
import { arcPath, MIN_ANGLE, sunburst, TILE_HEAD, TILE_PAD, treemap } from './chart-layout';
import { usageStart } from './disk-usage-actions';
import { fillOf, labelOn, UsagePalette } from './usage-colors';
import {
  isUsageKey,
  largestRows,
  scanIdOf,
  shareText,
  upPath,
  usageKey,
  UsageRow,
  viewRows,
} from './usage-rows';

const T = { smallFiles: (n: number) => `${n} small`, rest: (n: number) => `${n} rest` };

function node(
  id: number,
  name: string,
  size: number,
  kind: UsageNode['kind'] = 'file',
  children?: UsageNode[],
): UsageNode {
  return {
    id,
    name,
    path: kind === 'files' || kind === 'rest' ? null : `/r/${name}`,
    kind,
    allocated: size,
    logical: size - 1,
    files: kind === 'dir' ? 3 : kind === 'files' || kind === 'rest' ? 7 : 1,
    dirs: kind === 'dir' ? 1 : 0,
    unreadable: 0,
    modifiedMs: 5,
    lossyName: false,
    ...(children ? { children } : {}),
  };
}

function view(n: UsageNode, crumbs = [{ id: 0, name: 'r' }]): DiskUsageView {
  return {
    node: n,
    crumbs,
    virtualTop: false,
    running: false,
    complete: true,
    simplified: false,
    scannedAtMs: 0,
    version: 1,
    sizeMode: 'allocated',
    volume: null,
    scannedAllocated: n.allocated,
  };
}

const TREE = node(0, 'r', 1000, 'dir', [
  node(1, 'big', 600, 'dir', [node(5, 'film.mkv', 500), node(6, 'x', 100)]),
  node(2, 'f.iso', 300),
  node(3, 'mnt', 0, 'mount'),
  node(4, '', 100, 'files'),
]);

describe('disk usage rows (design 033)', () => {
  it('maps children to list rows with share, kinds and virtual aggregates', () => {
    const rows = viewRows(view(TREE), 'j7', T);
    expect(rows.map((r) => [r.name, r.kind, r.size, r.usage.share])).toEqual([
      ['big', 'directory', 600, 0.6],
      ['f.iso', 'file', 300, 0.3],
      ['mnt', 'directory', 0, 0],
      ['7 small', 'unknown', 100, 0.1],
    ]);
    expect(rows[0].path).toBe('/r/big');
    expect(rows[0].usage.ancestors).toEqual([0]);
    expect(rows[3].usage.virtual).toBe(true);
    expect(isVirtualPath(rows[3].path)).toBe(true);
    expect(isVirtualPath(rows[0].path)).toBe(false);
    expect(rows[2].usage.kind).toBe('mount');
    // another drive is never marked or sent to Rust (review 033 #11)
    expect(isVirtualPath(rows[2].path)).toBe(true);
    expect(isVirtualPath(upPath('j7'))).toBe(true);
  });

  it('a lossy path is never sent to Rust (review 033 #7)', () => {
    const lossy = { ...node(9, 'a\ufffd', 50, 'dir'), lossyName: true };
    const rows = viewRows(view({ ...TREE, children: [lossy] }), 'j7', T);
    expect(isVirtualPath(rows[0].path)).toBe(true);
    expect(rows[0].usage.virtual).toBe(false);
  });

  it('a synthetic row cannot be dragged (review 033 #13)', () => {
    const rows = viewRows(view(TREE), 'j7', T);
    expect(dragSources(rows[3], () => false, [])).toBeNull();
    expect(dragSources(rows[0], () => true, [rows[0], rows[3]])).toEqual([rows[0]]);
  });

  it('keys of disk-usage tabs', () => {
    expect(usageKey('j3')).toBe('usage:j3');
    expect(isUsageKey('usage:j3')).toBe(true);
    expect(isUsageKey('s1')).toBe(false);
    expect(isUsageKey(null)).toBe(false);
    expect(scanIdOf('usage:j3')).toBe('j3');
  });

  it('largest files carry their folder and nesting', () => {
    const v = view(TREE);
    const rows = largestRows(
      [
        {
          id: 5,
          name: 'film.mkv',
          path: '/r/big/film.mkv',
          dir: 'big',
          dirId: 1,
          ancestors: [0, 1],
          allocated: 500,
          logical: 499,
          modifiedMs: 1,
          lossyName: false,
        },
        {
          id: 2,
          name: 'f.iso',
          path: '/r/f.iso',
          dir: '',
          dirId: 0,
          ancestors: [0],
          allocated: 300,
          logical: 300,
          modifiedMs: 1,
          lossyName: false,
        },
      ],
      v,
      'allocated',
    );
    expect(rows[0].dir).toBe('big');
    expect(rows[0].usage.ancestors).toEqual([0, 1]);
    expect(rows[1].usage.ancestors).toEqual([0]);
    expect(rows[0].usage.share).toBe(0.5);
  });

  it('formats shares', () => {
    expect(shareText(0)).toBe('0 %');
    expect(shareText(0.004)).toBe('< 1 %');
    expect(shareText(0.125, 'en')).toBe('12.5 %');
    expect(shareText(0.6, 'en')).toBe('60 %');
  });

  it('never selects a synthetic row for an operation', () => {
    const rows = viewRows(view(TREE), 'j7', T);
    const panel = (marked: UsageRow[], cursor: UsageRow | null) => ({
      markedEntries: () => marked,
      cursorEntry: () => cursor,
    });
    expect(selectionForAction(panel([], rows[3]))).toEqual([]);
    expect(selectionForAction(panel([rows[0], rows[3]], null))).toEqual([rows[0]]);
  });
});

describe('disk usage basket (design 033 E3)', () => {
  const rows = viewRows(view(TREE), 'j7', T);
  const inner = viewRows(
    view(TREE.children![0], [
      { id: 0, name: 'r' },
      { id: 1, name: 'big' },
    ]),
    'j7',
    T,
  );

  it('takes the marks of one level and keeps the others; aggregates never', () => {
    let b = withLevelMarks(new Map(), rows, new Set([rows[1].path, rows[3].path]));
    expect([...b.keys()]).toEqual([2]);
    b = withLevelMarks(b, inner, new Set([inner[0].path]));
    expect([...b.keys()]).toEqual([2, 5]);
    b = withLevelMarks(b, rows, new Set());
    expect([...b.keys()]).toEqual([5]);
  });

  it('entries inside a marked folder go with it and count once', () => {
    const b = withLevelMarks(
      withLevelMarks(new Map(), inner, new Set([inner[0].path])),
      rows,
      new Set([rows[0].path, rows[1].path]),
    );
    const v = basketView(b, 'allocated');
    expect(v.covered).toEqual(new Set([5]));
    expect(v.effective.map((r) => r.name)).toEqual(['big', 'f.iso']);
    expect(v.size).toBe(900);
    expect(basketView(b, 'logical').size).toBe(898);
    // deleting the folder drops what was inside it too
    expect([...withoutPaths(b, new Set(['/r/big'])).keys()]).toEqual([2]);
  });
});

describe('disk usage chart layout (design 033 E2)', () => {
  it('rings: angles follow the sizes, small ones fold into one rest per parent', () => {
    const arcs = sunburst(TREE, 'allocated');
    const top = arcs.filter((a) => a.depth === 1);
    expect(top.map((a) => a.node.id)).toEqual([1, 2, 4]);
    expect(top[0].a1 - top[0].a0).toBeCloseTo(2 * Math.PI * 0.6);
    const end = Math.max(...top.map((a) => a.a1));
    expect(end).toBeLessThanOrEqual(2 * Math.PI + 1e-9);
    const inner = arcs.filter((a) => a.depth === 2);
    expect(inner.map((a) => a.node.name)).toEqual(['film.mkv', 'x']);
    expect(inner.every((a) => a.branch === 0)).toBe(true);
    expect(inner.every((a) => a.parent === 1)).toBe(true);
    expect(arcs.find((a) => a.node.id === 4)?.virtual).toBe(true);
    // a tiny child is folded
    const many = node(0, 'r', 10_000, 'dir', [
      node(1, 'a', 9_990),
      node(2, 'b', 5),
      node(3, 'c', 5),
    ]);
    const folded = sunburst(many, 'allocated', 4, MIN_ANGLE);
    expect(folded.map((a) => a.node.kind)).toEqual(['file', 'rest']);
    expect(folded[1].node.files).toBe(2);
    expect(folded[1].node.allocated).toBe(10);
    // depth limit
    expect(sunburst(TREE, 'allocated', 1).every((a) => a.depth === 1)).toBe(true);
  });

  it('arc paths: a full ring is drawn as two halves', () => {
    expect(arcPath(50, 50, 10, 20, 0, 2 * Math.PI).match(/A /g)).toHaveLength(4);
    expect(arcPath(50, 50, 10, 20, 0, 1)).toContain('L ');
  });

  it('tiles: areas proportional, inside the box, no overlap, deterministic', () => {
    const t = treemap(TREE, 'allocated', 400, 300);
    const top = t.filter((x) => x.depth === 1);
    const area = (x: { w: number; h: number }) => x.w * x.h;
    const total = 400 * 300;
    const big = top.find((x) => x.node.id === 1)!;
    expect(area(big) / total).toBeCloseTo(0.6, 2);
    for (const x of t) {
      expect(x.x).toBeGreaterThanOrEqual(-1e-9);
      expect(x.y).toBeGreaterThanOrEqual(-1e-9);
      expect(x.x + x.w).toBeLessThanOrEqual(400 + 1e-6);
      expect(x.y + x.h).toBeLessThanOrEqual(300 + 1e-6);
    }
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const a = top[i];
        const b = top[j];
        const overlap =
          Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 &&
          Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6;
        expect(overlap).toBe(false);
      }
    }
    // children of a folder lie inside it
    const film = t.find((x) => x.node.id === 5)!;
    expect(film.depth).toBe(2);
    expect(film.x).toBeGreaterThanOrEqual(big.x);
    expect(film.x + film.w).toBeLessThanOrEqual(big.x + big.w + 1e-6);
    expect(treemap(TREE, 'allocated', 400, 300)).toEqual(t);
    // a tall first-level folder keeps room for its name above its children
    expect(film.y).toBeGreaterThanOrEqual(big.y + TILE_PAD + TILE_HEAD - 1e-6);
  });
});

describe('disk usage colours', () => {
  const p: UsagePalette = {
    branches: [{ r: 255, g: 0, b: 0, a: 1 }],
    files: { r: 0, g: 0, b: 255, a: 1 },
    rest: { r: 128, g: 128, b: 128, a: 1 },
    unreadable: { r: 0, g: 0, b: 0, a: 1 },
    surface: { r: 255, g: 255, b: 255, a: 1 },
  };
  it('one hue per branch, lighter below; fixed colours for aggregates', () => {
    const shape = (n: UsageNode, depth: number, branch = 0) => ({
      node: n,
      depth,
      branch,
      virtual: false,
      parent: 0,
    });
    expect(fillOf(shape(node(1, 'a', 1), 1), p)).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(fillOf(shape(node(1, 'a', 1), 2), p).g).toBeGreaterThan(0);
    expect(fillOf(shape(node(1, '', 1, 'files'), 1), p)).toEqual(p.files);
    expect(fillOf(shape(node(1, '', 1, 'rest'), 1), p)).toEqual(p.rest);
    expect(labelOn({ r: 250, g: 250, b: 250, a: 1 })).toBe('#000000');
    expect(labelOn({ r: 20, g: 20, b: 60, a: 1 })).toBe('#ffffff');
  });
});

describe('what a scan starts with (design 033 E8)', () => {
  const d = (name: string, kind: 'directory' | 'file' | 'symlink' = 'directory') => ({
    name,
    path: `/r/${name}`,
    kind,
    targetKind: kind === 'symlink' ? ('directory' as const) : null,
    size: null,
    modifiedMs: null,
    hidden: false,
    lossyName: false,
  });
  it('marked folders, else the folder under the cursor, else the shown folder', () => {
    expect(usageStart([d('a'), d('b')], null, '/r', 'r', 'Sel')).toEqual({
      roots: ['/r/a', '/r/b'],
      name: 'Sel',
      filesIgnored: false,
    });
    expect(usageStart([d('a'), d('f', 'file')], null, '/r', 'r', 'Sel')).toEqual({
      roots: ['/r/a'],
      name: 'a',
      filesIgnored: true,
    });
    expect(usageStart([d('f', 'file')], null, '/r', 'r', 'Sel')?.roots).toEqual(['/r']);
    expect(usageStart([], d('c'), '/r', 'r', 'Sel')).toEqual({
      roots: ['/r/c'],
      name: 'c',
      filesIgnored: false,
    });
    // a link to a folder is not followed – the shown folder is scanned
    expect(usageStart([], d('l', 'symlink'), '/r', 'r', 'Sel')?.roots).toEqual(['/r']);
    expect(usageStart([], null, null, '', 'Sel')).toBeNull();
  });
});
