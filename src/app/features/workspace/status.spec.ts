import { dir, entry } from '../../../testing/fs-fixtures';
import { summarize } from './status';

describe('summarize', () => {
  const entries = [
    dir('Sub', { path: '/x/Sub' }),
    dir('Link', { path: '/x/Link', kind: 'symlink', targetKind: 'directory' }),
    entry('a.txt', { path: '/x/a.txt', size: 1_000 }),
    entry('b.bin', { path: '/x/b.bin', size: 2_048 }),
    entry('link.txt', { path: '/x/link.txt', kind: 'symlink', targetKind: 'file', size: 10 }),
    entry('broken', { path: '/x/broken', kind: 'unknown', size: null }),
  ];

  it('counts files and folders and sums file sizes', () => {
    expect(summarize(entries, new Set())).toEqual({
      markedSize: 0,
      totalSize: 3_058,
      markedFiles: 0,
      files: 4,
      markedDirs: 0,
      dirs: 2,
    });
  });

  it('counts marked entries separately', () => {
    const s = summarize(entries, new Set(['/x/Sub', '/x/b.bin', '/x/broken', '/elsewhere']));
    expect(s.markedSize).toBe(2_048);
    expect(s.markedFiles).toBe(2);
    expect(s.markedDirs).toBe(1);
  });

  it('is all zero for an empty folder', () => {
    expect(summarize([], new Set())).toEqual({
      markedSize: 0,
      totalSize: 0,
      markedFiles: 0,
      files: 0,
      markedDirs: 0,
      dirs: 0,
    });
  });
});
