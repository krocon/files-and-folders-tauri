import { describe, expect, it } from 'vitest';
import { paletteHit } from '../../../testing/fake-palette-api';
import {
  buildRows,
  highlight,
  ItemRow,
  mergeHits,
  nearestSelectable,
  nextSelectable,
  PaletteRow,
  shortPath,
  strongAction,
  visibleWindow,
} from './palette-logic';
import { parseQuery } from './palette-query';

const item = (label: string, kind: ItemRow['kind'] = 'action'): ItemRow => ({
  kind,
  key: `${kind}:${label}`,
  id: label,
  label,
  category: '',
  shortcut: '',
  ready: true,
  hint: '',
  score: 1,
  parts: [{ text: label, hit: false }],
});

const kinds = (rows: PaletteRow[]) =>
  rows.map((r) =>
    r.kind === 'header' ? `#${r.group}` : r.kind === 'more' ? `+${r.hidden}` : r.kind,
  );

describe('palette rows (design 043 E5)', () => {
  const q = (text: string) => parseQuery(text, 0, 0);

  it('groups folders and files, actions last without a strong match', () => {
    const rows = buildRows({
      query: q('invoice'),
      actions: [item('Reinvoice')],
      folders: [item('/home/u/invoices', 'folder')],
      hits: [
        paletteHit('/a', 'invoice.pdf'),
        paletteHit('/a', 'Invoices', { kind: 'directory' }),
        paletteHit('/home/u', 'invoices', { kind: 'directory' }), // the known folder again
      ],
      expanded: new Set(),
      actionsMatch: true,
    });
    expect(kinds(rows)).toEqual([
      '#folders',
      'folder',
      'hit',
      '#files',
      'hit',
      '#actions',
      'action',
    ]);
  });

  it('a strong action match comes first, collapsed to five', () => {
    const actions = [
      'Copy',
      'Copy names',
      'Copy full names',
      'Copy as JSON',
      'Copy path',
      'Copy x',
    ].map((l) => item(l));
    const rows = buildRows({
      query: q('copy'),
      actions,
      folders: [],
      hits: [paletteHit('/a', 'copy.txt')],
      expanded: new Set(),
      actionsMatch: true,
    });
    expect(kinds(rows)).toEqual(['#actions', ...Array(5).fill('action'), '+1', '#files', 'hit']);
    const expanded = buildRows({
      query: q('copy'),
      actions,
      folders: [],
      hits: [],
      expanded: new Set(['actions']),
      actionsMatch: true,
    });
    expect(expanded.filter((r) => r.kind === 'action')).toHaveLength(6);
  });

  it('`>` and the empty query: the plain action list; filters: no actions', () => {
    const actions = [item('Copy'), item('Move')];
    for (const text of ['> c', '']) {
      const rows = buildRows({
        query: q(text),
        actions,
        folders: [],
        hits: [],
        expanded: new Set(),
        actionsMatch: true,
      });
      expect(kinds(rows)).toEqual(['action', 'action']);
    }
    const rows = buildRows({
      query: q('ext:pdf'),
      actions: [],
      folders: [],
      hits: [paletteHit('/a', 'x.pdf')],
      expanded: new Set(),
      actionsMatch: false,
    });
    expect(kinds(rows)).toEqual(['#files', 'hit']);
  });

  it('path mode: the "go to" row and the entries of the folder', () => {
    const rows = buildRows({
      query: q('/home/u/Do'),
      actions: [],
      folders: [item('Go to /home/u/Do', 'folder')],
      hits: [
        paletteHit('/home/u', 'Docs', { kind: 'directory' }),
        paletteHit('/home/u', 'Doc.txt'),
      ],
      expanded: new Set(),
      actionsMatch: false,
    });
    expect(kinds(rows)).toEqual(['#folders', 'folder', '#files', 'hit', 'hit']);
  });

  it('moves over headers and wraps', () => {
    const rows = buildRows({
      query: q('a'),
      actions: [],
      folders: [item('/a', 'folder')],
      hits: [paletteHit('/a', 'a.txt')],
      expanded: new Set(),
      actionsMatch: false,
    });
    // #folders folder #files hit
    expect(nextSelectable(rows, 1, 1)).toBe(3);
    expect(nextSelectable(rows, 3, 1)).toBe(1);
    expect(nextSelectable(rows, 1, -1)).toBe(3);
    expect(nearestSelectable(rows, 0)).toBe(1);
    expect(nearestSelectable(rows, 2)).toBe(3);
    expect(nextSelectable([], 0, 1)).toBe(-1);
  });

  it('strong action matches start at a word', () => {
    expect(strongAction('copy', 'Copy names')).toBe(true);
    expect(strongAction('names', 'Copy names')).toBe(true);
    expect(strongAction('opy', 'Copy names')).toBe(false);
    expect(strongAction('', 'Copy')).toBe(false);
  });
});

describe('palette helpers', () => {
  it('highlights UTF-16 ranges and clamps bad ones', () => {
    expect(
      highlight('invoice_2025.pdf', [
        [0, 7],
        [8, 12],
      ]),
    ).toEqual([
      { text: 'invoice', hit: true },
      { text: '_', hit: false },
      { text: '2025', hit: true },
      { text: '.pdf', hit: false },
    ]);
    expect(highlight('ab', [[1, 99]])).toEqual([
      { text: 'a', hit: false },
      { text: 'b', hit: true },
    ]);
    expect(highlight('😀x', [[2, 3]])).toEqual([
      { text: '😀', hit: false },
      { text: 'x', hit: true },
    ]);
  });

  it('shortens long paths in the middle', () => {
    expect(shortPath('/short')).toBe('/short');
    const long = `/home/marc/${'x'.repeat(80)}/2025`;
    const s = shortPath(long, 30);
    expect(s).toHaveLength(30);
    expect(s.startsWith('/home/marc/')).toBe(true);
    expect(s.endsWith('/2025')).toBe(true);
    expect(s).toContain('…');
  });

  it('merges batches: one per path, the better rank, best first, limited', () => {
    const a = paletteHit('/d', 'a', { score: 10 });
    const b = paletteHit('/d', 'b', { score: 20 });
    const a2 = paletteHit('/d', 'a', { score: 30, source: 'live' });
    expect(mergeHits([a], [b, a2], 10).map((h) => [h.name, h.score])).toEqual([
      ['a', 30],
      ['b', 20],
    ]);
    expect(mergeHits([a, b], [], 1)).toHaveLength(1);
  });

  it('the visible window of the virtual list', () => {
    expect(visibleWindow(0, 300, 30, 1000)).toEqual({ first: 0, count: 22 });
    expect(visibleWindow(3000, 300, 30, 1000)).toEqual({ first: 94, count: 22 });
    expect(visibleWindow(0, 0, 30, 5)).toEqual({ first: 0, count: 5 });
    expect(visibleWindow(0, 0, 30, 0)).toEqual({ first: 0, count: 0 });
  });
});
