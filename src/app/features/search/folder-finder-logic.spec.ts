import { SearchHit } from '../../core/search/search.models';
import { dir } from '../../../testing/fs-fixtures';
import { FolderFilter, filterFolders, moveActive } from './folder-finder-logic';

const hit = (path: string): SearchHit => ({
  ...dir(path.split('/').at(-1)!, { path }),
  dir: '/',
  parentNames: ['', '', ''],
});

describe('folder finder (design 009 E6)', () => {
  const hits = [
    hit('/home/u/Musik'),
    hit('/home/u/Musik/Über alles'),
    hit('/home/u/Dokumente/musik-alt'),
    hit('/home/u/Bilder'),
  ];

  it('empty filter keeps the found order', () => {
    expect(filterFolders(hits, '  ')).toBe(hits);
  });

  it('fuzzy, name matches first, then path matches', () => {
    const names = (q: string) => filterFolders(hits, q).map((h) => h.path);
    expect(names('mus')).toEqual([
      '/home/u/Musik',
      '/home/u/Dokumente/musik-alt',
      // "Über alles" matches only through its path
      '/home/u/Musik/Über alles',
    ]);
    expect(names('über')).toEqual(['/home/u/Musik/Über alles']);
    expect(names('bldr')).toEqual(['/home/u/Bilder']);
    expect(names('xyz')).toEqual([]);
  });

  it('moves the active row and clamps', () => {
    expect(moveActive(0, 'ArrowDown', 3)).toBe(1);
    expect(moveActive(2, 'ArrowDown', 3)).toBe(2);
    expect(moveActive(0, 'ArrowUp', 3)).toBe(0);
    expect(moveActive(1, 'PageDown', 30)).toBe(11);
    expect(moveActive(5, 'PageUp', 30)).toBe(0);
    expect(moveActive(5, 'End', 30)).toBe(29);
    expect(moveActive(5, 'x', 3)).toBe(2);
    expect(moveActive(0, 'ArrowDown', 0)).toBe(-1);
  });

  it('review 009 #8: the incremental filter equals the full one while the list grows', () => {
    const all = [
      ...hits,
      hit('/home/u/Musik/Jazz'),
      hit('/srv/musik'),
      hit('/home/u/mu/sik'),
      hit('/x/Bilder Musik'),
    ];
    const f = new FolderFilter();
    const growing: SearchHit[] = [];
    for (const [i, h] of all.entries()) {
      growing.push(h);
      const q = i < 5 ? 'musik' : 'mus';
      const got = f.apply(growing, q);
      expect(got).toEqual(filterFolders(growing, q));
      expect(got).not.toBe(growing);
    }
    expect(f.apply(growing, '')).toEqual(growing);
    expect(f.apply([...growing], 'bild')).toEqual(filterFolders(growing, 'bild'));
  });
});
