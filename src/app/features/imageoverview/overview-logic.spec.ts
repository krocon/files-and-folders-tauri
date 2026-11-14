import { overviewItem } from '../../../testing/fake-image-overview-api';
import {
  clampTile,
  filterItems,
  findByPrefix,
  MAX_TILE,
  MIN_TILE,
  rangePaths,
  rowCountWithSpare,
  sortItems,
  thumbStep,
  tileHeight,
  toEntry,
  withoutPaths,
  zoomTile,
} from './overview-logic';

const names = (list: { name: string }[]) => list.map((i) => i.name);

describe('image overview logic (design 074)', () => {
  const items = [
    overviewItem(0, 'IMG_10.jpg', { modifiedMs: 3, size: 50 }),
    overviewItem(1, 'img_2.png', { modifiedMs: 1, size: 70 }),
    overviewItem(2, 'Äpfel.webp', { modifiedMs: 2, size: 10 }),
    overviewItem(3, 'b.NEF', { modifiedMs: 2, size: 10, kind: 'raw' }),
  ];

  it('sorts naturally by name, by date, size and type – ties by name', () => {
    expect(names(sortItems(items, 'name'))).toEqual([
      'Äpfel.webp',
      'b.NEF',
      'img_2.png',
      'IMG_10.jpg',
    ]);
    expect(names(sortItems(items, 'date'))).toEqual([
      'img_2.png',
      'Äpfel.webp',
      'b.NEF',
      'IMG_10.jpg',
    ]);
    expect(names(sortItems(items, 'size'))).toEqual([
      'Äpfel.webp',
      'b.NEF',
      'IMG_10.jpg',
      'img_2.png',
    ]);
    expect(names(sortItems(items, 'type'))).toEqual([
      'IMG_10.jpg',
      'b.NEF',
      'img_2.png',
      'Äpfel.webp',
    ]);
    expect(names(items), 'not changed').toEqual(['IMG_10.jpg', 'img_2.png', 'Äpfel.webp', 'b.NEF']);
  });

  it('sorts by the relative path first, so subfolders stay together', () => {
    const deep = [
      overviewItem(0, 'a.jpg', { rel: 'Tag 2/a.jpg' }),
      overviewItem(1, 'z.jpg', { rel: 'z.jpg' }),
      overviewItem(2, 'b.jpg', { rel: 'Tag 1/b.jpg' }),
    ];
    expect(sortItems(deep, 'name').map((i) => i.rel)).toEqual([
      'Tag 1/b.jpg',
      'Tag 2/a.jpg',
      'z.jpg',
    ]);
  });

  it('filters by name without case and diacritics (NFC and NFD alike)', () => {
    expect(names(filterItems(items, 'img'))).toEqual(['IMG_10.jpg', 'img_2.png']);
    expect(names(filterItems(items, 'apfel'))).toEqual(['Äpfel.webp']);
    expect(names(filterItems(items, 'Äpfel'))).toEqual(['Äpfel.webp']);
    expect(filterItems(items, '  ')).toHaveLength(4);
    expect(filterItems(items, 'nothing')).toEqual([]);
  });

  it('keeps the tile size in its limits and zooms by a factor', () => {
    expect(clampTile(10)).toBe(MIN_TILE);
    expect(clampTile(5000)).toBe(MAX_TILE);
    expect(zoomTile(200, 1)).toBe(250);
    expect(zoomTile(200, -1)).toBe(160);
    expect(zoomTile(MAX_TILE, 1)).toBe(MAX_TILE);
    expect(tileHeight(200)).toBe(150);
  });

  it('loads the smallest thumbnail step that is sharp enough', () => {
    expect(thumbStep(150, 1)).toBe(0);
    expect(thumbStep(150, 2)).toBe(1);
    expect(thumbStep(300, 2)).toBe(2);
    expect(thumbStep(640, 2), 'never the large step in the grid').toBe(2);
  });

  it('marks ranges in both directions and finds names by prefix (wrapping)', () => {
    expect(rangePaths(items, 2, 0)).toEqual([
      '/fotos/IMG_10.jpg',
      '/fotos/img_2.png',
      '/fotos/Äpfel.webp',
    ]);
    expect(rangePaths([], 0, 3)).toEqual([]);
    expect(findByPrefix(items, 'i', 0)).toBe(0);
    expect(findByPrefix(items, 'i', 1)).toBe(1);
    expect(findByPrefix(items, 'i', 2), 'wraps').toBe(0);
    expect(findByPrefix(items, 'ap', 0)).toBe(2);
    expect(findByPrefix(items, 'x', 0)).toBe(-1);
  });

  it('turns images into entries for the operations and drops removed ones', () => {
    expect(toEntry(items[0])).toEqual({
      name: 'IMG_10.jpg',
      path: '/fotos/IMG_10.jpg',
      kind: 'file',
      targetKind: null,
      size: 50,
      modifiedMs: 3,
      hidden: false,
      lossyName: false,
    });
    expect(withoutPaths(items, new Set(['/nope']))).toBe(items);
    expect(names([...withoutPaths(items, new Set(['/fotos/b.NEF']))])).toHaveLength(3);
  });

  it('counts one spare row below the last one, so it can scroll above the footer', () => {
    expect(rowCountWithSpare(0, 4)).toBe(0);
    expect(rowCountWithSpare(3, 4)).toBe(2);
    expect(rowCountWithSpare(4, 4)).toBe(2);
    expect(rowCountWithSpare(5, 4)).toBe(3);
    expect(rowCountWithSpare(5, 0)).toBe(6); // no width yet: one column
  });
});
