import { describe, expect, it } from 'vitest';
import { DirEntry } from '../../core/fs/fs.models';
import { dir, entry } from '../../../testing/fs-fixtures';
import {
  entriesInPanel,
  logTime,
  MAX_REPORTED_MARKED,
  panelState,
  tabKind,
  withClient,
} from './mcp-logic';

describe('mcp logic (design 071)', () => {
  const a = entry('a.txt', { path: '/src/a.txt', size: 5, modifiedMs: 9 });
  /** The ".." row of the list (a `ListRow`). */
  const up = { ...dir('..', { path: '/' }), parentLink: true } as DirEntry;

  it('reports a panel: folder, cursor, marks – never the ".." row', () => {
    const p = panelState({
      tabs: [{ id: 't1', kind: 'folder', title: 'src', path: '/src' }],
      activeTab: 0,
      folder: '/src',
      cursor: up,
      marked: [up, a],
      unchecked: true,
    });
    expect(p.cursor).toBeNull();
    expect(p.marked).toEqual([
      { name: 'a.txt', path: '/src/a.txt', kind: 'file', size: 5, modifiedMs: 9 },
    ]);
    expect(p.markedTotal).toBe(1);
    expect(p.unchecked).toBe(true);
    // only what an agent needs: no permissions, no hidden flag
    expect(Object.keys(p.marked[0]).sort()).toEqual(['kind', 'modifiedMs', 'name', 'path', 'size']);
  });

  it('cuts a huge selection and says how many there are', () => {
    const many = Array.from({ length: MAX_REPORTED_MARKED + 10 }, (_, i) =>
      entry(`f${i}`, { path: `/src/f${i}` }),
    );
    const p = panelState({
      tabs: [],
      activeTab: 0,
      folder: '/src',
      cursor: many[0],
      marked: many,
      unchecked: false,
    });
    expect(p.marked).toHaveLength(MAX_REPORTED_MARKED);
    expect(p.markedTotal).toBe(MAX_REPORTED_MARKED + 10);
  });

  it('names the kind of a tab', () => {
    const kind = (key: string) => (key.startsWith('u') ? 'usage' : 'search');
    expect(tabKind(null, kind)).toBe('folder');
    expect(tabKind(undefined, kind)).toBe('folder');
    expect(tabKind({ key: 's1' }, kind)).toBe('search');
    expect(tabKind({ key: 'u1' }, kind)).toBe('usage');
    expect(tabKind({ key: 's2', flat: { root: '/x' } }, kind)).toBe('flat');
  });

  it('accepts only entries the panel lists', () => {
    const entries = [up, a, entry('b.txt', { path: '/src/b.txt' })];
    expect(entriesInPanel(['/src/b.txt', '/etc/passwd', '/', '/src/a.txt'], entries)).toEqual([
      '/src/b.txt',
      '/src/a.txt',
    ]);
    expect(entriesInPanel([], entries)).toEqual([]);
  });

  it('keeps the "always" list free of duplicates and bounded', () => {
    expect(withClient([], 'Claude')).toEqual(['Claude']);
    expect(withClient(['Claude', 7, null], 'Claude')).toEqual(['Claude']);
    const full = Array.from({ length: 16 }, (_, i) => `c${i}`);
    const next = withClient(full, 'new');
    expect(next).toHaveLength(16);
    expect(next.at(-1)).toBe('new');
  });

  it('formats the time of a log line', () => {
    expect(logTime(new Date(2026, 10, 25, 7, 5, 9).getTime())).toBe('07:05:09');
  });
});
