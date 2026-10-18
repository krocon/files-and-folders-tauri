import { ValueRowSortComparator } from '@guiexpert/table';
import { DirEntry } from '../../../core/fs/fs.models';
import { dir, entry } from '../../../../testing/fs-fixtures';
import {
  compareNames,
  createFileColumns,
  createNameCollator,
  extensionOf,
  fileComparators,
} from './file-columns';

/** Sorts like the GuiExpert Table does: `f * comparator(va, vb, a, b, f)`. */
function sortLikeTable(
  rows: DirEntry[],
  cmp: ValueRowSortComparator,
  direction: 'asc' | 'desc',
): string[] {
  const f = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => f * cmp(undefined, undefined, a, b, f)).map((r) => r.name);
}

describe('compareNames', () => {
  it('sorts naturally and case-insensitively', () => {
    const rows = ['file10.txt', 'File2.txt', 'file1.txt', 'apple'].map((n) => entry(n));
    expect(rows.sort(compareNames).map((r) => r.name)).toEqual([
      'apple',
      'file1.txt',
      'File2.txt',
      'file10.txt',
    ]);
  });

  it('handles umlauts and is stable for names differing only in case', () => {
    expect(compareNames(entry('Äpfel'), entry('Birnen'))).toBeLessThan(0);
    expect(compareNames(entry('a'), entry('A'))).not.toBe(0);
  });
});

describe('createNameCollator', () => {
  it('falls back to English rules when the default locale sorts by code point (POSIX)', () => {
    const codePoint = {
      compare: (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
    } as Intl.Collator;
    const english = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    const make = (locale?: string) => (locale === 'en' ? english : codePoint);
    expect(createNameCollator(make)).toBe(english);
  });

  it('keeps the user locale when it sorts case-insensitively and naturally', () => {
    const good = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
    expect(createNameCollator(() => good)).toBe(good);
  });
});

describe('extensionOf', () => {
  it.each([
    ['report.pdf', 'pdf'],
    ['archive.tar.gz', 'gz'],
    ['.gitignore', ''],
    ['README', ''],
    ['trailing.', ''],
  ])('%s → "%s"', (name, ext) => {
    expect(extensionOf(entry(name))).toBe(ext);
  });

  it('is empty for folders and symlinks to folders', () => {
    expect(extensionOf(dir('my.folder'))).toBe('');
    expect(extensionOf(entry('link.d', { kind: 'symlink', targetKind: 'directory' }))).toBe('');
  });
});

describe('fileComparators', () => {
  const rows = [
    entry('b.txt', { size: 300, modifiedMs: 3 }),
    dir('Zeta'),
    entry('a.md', { size: 100, modifiedMs: 1 }),
    entry('link', { kind: 'symlink', targetKind: 'directory', size: null }),
    dir('alpha'),
    entry('c.bin', { size: 200, modifiedMs: 2 }),
  ];

  it('keeps folders (and links to folders) first in both directions – name', () => {
    expect(sortLikeTable(rows, fileComparators.name, 'asc')).toEqual([
      'alpha',
      'link',
      'Zeta',
      'a.md',
      'b.txt',
      'c.bin',
    ]);
    expect(sortLikeTable(rows, fileComparators.name, 'desc')).toEqual([
      'Zeta',
      'link',
      'alpha',
      'c.bin',
      'b.txt',
      'a.md',
    ]);
  });

  it('sorts sizes numerically, folders first, unknown sizes last in both directions', () => {
    const withUnknown = [...rows, entry('broken', { kind: 'unknown', size: null })];
    expect(sortLikeTable(withUnknown, fileComparators.size, 'asc')).toEqual([
      'alpha',
      'link',
      'Zeta',
      'a.md',
      'c.bin',
      'b.txt',
      'broken',
    ]);
    expect(sortLikeTable(withUnknown, fileComparators.size, 'desc').slice(3)).toEqual([
      'b.txt',
      'c.bin',
      'a.md',
      'broken',
    ]);
  });

  it('sorts by modification time with missing times last', () => {
    const r = [
      entry('x', { modifiedMs: null }),
      entry('new', { modifiedMs: 9 }),
      entry('old', { modifiedMs: 1 }),
    ];
    expect(sortLikeTable(r, fileComparators.modifiedMs, 'asc')).toEqual(['old', 'new', 'x']);
    expect(sortLikeTable(r, fileComparators.modifiedMs, 'desc')).toEqual(['new', 'old', 'x']);
  });

  it('sorts by extension, then name', () => {
    const r = [entry('b.txt'), entry('a.txt'), entry('z.md'), entry('NOEXT')];
    expect(sortLikeTable(r, fileComparators.ext, 'asc')).toEqual([
      'NOEXT',
      'z.md',
      'a.txt',
      'b.txt',
    ]);
  });

  it('returns 0 without rows', () => {
    expect(fileComparators.name('a', 'b')).toBe(0);
  });
});

describe('createFileColumns', () => {
  it('defines name, ext, size and modified columns, all sortable, name ascending', () => {
    const cols = createFileColumns();
    expect(cols.map((c) => c.property)).toEqual([
      'name',
      'ext',
      'size',
      'modifiedMs',
      'group',
      'dir',
    ]);
    // the group column belongs to duplicate tabs (design 016), the folder column to
    // search result tabs (design 009) – both start hidden
    expect(cols[4].isVisible?.()).toBe(false);
    expect(cols[5].isVisible?.()).toBe(false);
    expect(cols.every((c) => c.sortable?.())).toBe(true);
    expect(cols[0].sortState).toBe('asc');
    expect(cols[1].valueGetter?.(entry('x.json'), {} as never)).toBe('json');
  });

  it('sorts duplicates by group, then by folder (design 016)', () => {
    const cmp = fileComparators.group;
    const d = (name: string, group: number | undefined, dirName: string) =>
      ({ ...entry(name), dir: dirName, group }) as DirEntry;
    const rows = [d('x', 2, '/a'), d('y', 1, '/b'), d('z', 1, '/a'), d('n', undefined, '/a')];
    const sorted = [...rows].sort((a, b) => cmp(null, null, a, b, 1));
    expect(sorted.map((r) => r.name)).toEqual(['z', 'y', 'x', 'n']);
  });
});
