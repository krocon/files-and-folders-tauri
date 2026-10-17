import { describe, expect, it } from 'vitest';
import { parentRow } from '../../core/fs/fs.models';
import { dir, entry } from '../../../testing/fs-fixtures';
import {
  cursorAfterRemoval,
  dialogError,
  selectionForAction,
  stemLength,
  suggestFolderName,
  targetOptions,
} from './ops-logic';

describe('selectionForAction', () => {
  const a = entry('a.txt');
  const b = entry('b.txt');
  it('takes the marked entries, otherwise the cursor entry, never ".."', () => {
    expect(selectionForAction({ markedEntries: () => [a, b], cursorEntry: () => a })).toEqual([
      a,
      b,
    ]);
    expect(selectionForAction({ markedEntries: () => [], cursorEntry: () => b })).toEqual([b]);
    expect(
      selectionForAction({ markedEntries: () => [], cursorEntry: () => parentRow('/') }),
    ).toEqual([]);
    expect(selectionForAction({ markedEntries: () => [], cursorEntry: () => null })).toEqual([]);
    expect(selectionForAction(undefined)).toEqual([]);
  });
});

describe('suggestFolderName', () => {
  it('continues a series of at least two siblings', () => {
    expect(suggestFolderName(['S01', 'S02', 'x.txt'])).toBe('S03');
    expect(suggestFolderName(['Folge09', 'Folge10'])).toBe('Folge11');
    expect(suggestFolderName(['img007', 'img012', 'img3'])).toBe('img013');
    expect(suggestFolderName(['S99', 'S98'])).toBe('S100');
  });

  it('needs two members and the pattern', () => {
    expect(suggestFolderName(['S01'])).toBe('');
    expect(suggestFolderName(['S1', 'S2'])).toBe('');
    expect(suggestFolderName(['ABCDEFGHIJK01', 'ABCDEFGHIJK02'])).toBe('');
  });

  it('prefers the series of the basis entry, else the larger one', () => {
    const names = ['a01', 'a02', 'b01', 'b02', 'b03'];
    expect(suggestFolderName(names)).toBe('b04');
    expect(suggestFolderName(names, dir('a02'))).toBe('a03');
  });

  it('falls back to the basis name without extension', () => {
    expect(suggestFolderName([], entry('Urlaub 2026.zip'))).toBe('Urlaub 2026');
    expect(suggestFolderName([], dir('Ordner.d'))).toBe('Ordner.d');
    expect(suggestFolderName([], parentRow('/'))).toBe('');
  });
});

describe('stemLength', () => {
  it('stops before the last extension', () => {
    expect(stemLength('a.txt')).toBe(1);
    expect(stemLength('a.tar.gz')).toBe(5);
    expect(stemLength('.bashrc')).toBe(7);
    expect(stemLength('ohne')).toBe(4);
    expect(stemLength('ordner.d', true)).toBe(8);
  });
});

describe('cursorAfterRemoval', () => {
  const rows = ['a', 'b', 'c', 'd'].map((n) => entry(n));
  const gone = (...n: string[]) => new Set(n.map((x) => `/root/${x}`));
  it('moves to the next remaining entry, else the previous one', () => {
    expect(cursorAfterRemoval(rows, gone('b'), '/root/b')).toBe('/root/c');
    expect(cursorAfterRemoval(rows, gone('b', 'c'), '/root/b')).toBe('/root/d');
    expect(cursorAfterRemoval(rows, gone('c', 'd'), '/root/d')).toBe('/root/b');
    expect(cursorAfterRemoval(rows, gone('a', 'b', 'c', 'd'), '/root/a')).toBeNull();
  });
  it('keeps a cursor that stays', () => {
    expect(cursorAfterRemoval(rows, gone('b'), '/root/a')).toBe('/root/a');
    expect(cursorAfterRemoval(rows, gone('b'), null)).toBeNull();
  });
});

describe('targetOptions', () => {
  it('drops duplicates and empty paths, first group wins', () => {
    expect(
      targetOptions([
        { group: 'Other panel', paths: ['/b'] },
        { group: 'Tab', paths: ['/a', '/b', null] },
        { group: 'Favourite', paths: ['/a', '/f'] },
      ]),
    ).toEqual([
      { path: '/b', group: 'Other panel' },
      { path: '/a', group: 'Tab' },
      { path: '/f', group: 'Favourite' },
    ]);
  });
});

describe('dialogError', () => {
  it('own messages as they are, OS messages after the general description', () => {
    expect(dialogError({ code: 'already_exists', message: 'Exists already', path: null })).toBe(
      'Exists already',
    );
    expect(
      dialogError({
        code: 'permission_denied',
        message: 'Permission denied (os error 13)',
        path: null,
      }),
    ).toBe(
      'Access denied – you do not have permission to read this folder. (Permission denied (os error 13))',
    );
  });
});
