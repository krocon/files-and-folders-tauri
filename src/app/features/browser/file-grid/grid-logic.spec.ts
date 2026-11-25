import { DirEntry } from '../../../core/fs/fs.models';
import {
  BRIEF_MIN_WIDTH,
  cellIndex,
  listingStamp,
  rowCount,
  TILE_LABEL,
  TILE_PADDING,
  tileLayout,
} from './grid-logic';

const file = (name: string, size: number, modifiedMs: number): DirEntry => ({
  name,
  path: `/p/${name}`,
  kind: 'file',
  targetKind: null,
  size,
  modifiedMs,
  hidden: false,
  lossyName: false,
});

describe('tile views of a panel (design 041 E5/E6)', () => {
  it('brief: as many name columns as fit, one list row high, stretched to the width', () => {
    expect(tileLayout('brief', 700, 30, 128)).toEqual({
      cols: 3,
      cellWidth: 233,
      rowHeight: 30,
      pictureHeight: 0,
    });
    // a narrow panel still has one column
    expect(tileLayout('brief', BRIEF_MIN_WIDTH - 50, 24, 128).cols).toBe(1);
    expect(tileLayout('brief', 0, 24, 128)).toEqual({
      cols: 1,
      cellWidth: 1,
      rowHeight: 24,
      pictureHeight: 0,
    });
  });

  it('thumbnails: tiles of the chosen size, 4:3 picture and a line for the name', () => {
    const l = tileLayout('thumbnails', 600, 30, 128);
    expect(l.cols).toBe(4); // 600 / (128 + 12)
    expect(l.cellWidth).toBe(150);
    expect(l.pictureHeight).toBe(Math.round((150 - 2 * TILE_PADDING) * 0.75));
    expect(l.rowHeight).toBe(l.pictureHeight + 2 * TILE_PADDING + TILE_LABEL);
    // bigger tiles: fewer columns
    expect(tileLayout('thumbnails', 600, 30, 256).cols).toBe(2);
  });

  it('maps cells to entries; the cells behind the last entry are empty', () => {
    expect(cellIndex(0, 0, 4, 10)).toBe(0);
    expect(cellIndex(2, 1, 4, 10)).toBe(9);
    expect(cellIndex(2, 2, 4, 10)).toBe(-1);
    expect(cellIndex(-1, 0, 4, 10)).toBe(-1);
    expect(cellIndex(0, 4, 4, 10)).toBe(-1);
    expect(rowCount(10, 4)).toBe(3);
    expect(rowCount(8, 4)).toBe(2);
    expect(rowCount(0, 4)).toBe(0);
  });

  it('the stamp of a listing changes with the folder, the entries and a rewritten file', () => {
    const a = [file('a.jpg', 10, 1000), file('b.jpg', 20, 2000)];
    const stamp = listingStamp('/p', a);
    expect(listingStamp('/p', [...a])).toBe(stamp);
    expect(listingStamp('/q', a)).not.toBe(stamp);
    expect(listingStamp('/p', a.slice(0, 1))).not.toBe(stamp);
    expect(listingStamp('/p', [a[0], file('b.jpg', 20, 3000)])).not.toBe(stamp);
    expect(listingStamp('/p', [a[0], file('b.jpg', 25, 2000)])).not.toBe(stamp);
  });
});
