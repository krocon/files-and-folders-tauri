import { describe, expect, it } from 'vitest';
import { SearchHit } from '../../core/search/search.models';
import { duplicateSummary, marksKeepingOne, wholeGroups } from './duplicates-logic';

const hit = (path: string, group: number, modifiedMs: number | null, size = 10): SearchHit => ({
  name: path.split('/').pop()!,
  path,
  dir: '/',
  relDir: '',
  parentNames: ['', '', ''],
  kind: 'file',
  targetKind: null,
  size,
  modifiedMs,
  hidden: false,
  lossyName: false,
  group,
});

const rows = [
  hit('/b/long/name.jpg', 1, 300),
  hit('/a/name.jpg', 1, 100),
  hit('/c/name (1).jpg', 1, 200),
  hit('/x/song.mp3', 2, null, 5),
  hit('/y/song.mp3', 2, 50, 5),
];

describe('duplicate selection helpers (design 016 E6)', () => {
  it('keeps exactly one file per group', () => {
    expect(marksKeepingOne(rows, 'newest').sort()).toEqual([
      '/a/name.jpg',
      '/c/name (1).jpg',
      '/x/song.mp3',
    ]);
    expect(marksKeepingOne(rows, 'oldest').sort()).toEqual([
      '/b/long/name.jpg',
      '/c/name (1).jpg',
      '/y/song.mp3',
    ]);
    // shortest path stays
    expect(marksKeepingOne(rows, 'first').sort()).toEqual([
      '/b/long/name.jpg',
      '/c/name (1).jpg',
      '/y/song.mp3',
    ]);
    for (const rule of ['newest', 'oldest', 'first'] as const) {
      expect(wholeGroups(rows, new Set(marksKeepingOne(rows, rule)))).toBe(0);
    }
  });

  it('leaves single remaining rows and rows without a group alone', () => {
    const plain = { ...hit('/z', 3, 1), group: undefined };
    expect(marksKeepingOne([rows[0], plain], 'newest')).toEqual([]);
  });

  it('counts groups that would lose every copy', () => {
    expect(wholeGroups(rows, new Set(['/x/song.mp3', '/y/song.mp3', '/a/name.jpg']))).toBe(1);
    expect(wholeGroups(rows, new Set(rows.map((r) => r.path)))).toBe(2);
  });

  it('sums up groups, files and redundant bytes', () => {
    expect(duplicateSummary(rows)).toEqual({ groups: 2, files: 5, redundant: 2 * 10 + 5 });
    expect(duplicateSummary(rows.slice(0, 4))).toEqual({ groups: 1, files: 3, redundant: 20 });
  });
});
