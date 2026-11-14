import {
  gridLayout,
  loadDimIndex,
  moveCursor,
  pageRows,
  scrollForTop,
  scrollToShow,
  topIndex,
} from './grid-math';

describe('gridLayout (E6)', () => {
  it('stretches the covers to the full width', () => {
    expect(gridLayout(1880, { width: 270, height: 405 })).toEqual({
      cols: 6,
      coverWidth: 313,
      coverHeight: 470,
    });
    expect(gridLayout(1000, { width: 200, height: 300 })).toEqual({
      cols: 5,
      coverWidth: 200,
      coverHeight: 300,
    });
  });

  it('keeps one column when the window is narrower than a cover', () => {
    expect(gridLayout(150, { width: 200, height: 300 })).toEqual({
      cols: 1,
      coverWidth: 150,
      coverHeight: 225,
    });
    expect(gridLayout(0, { width: 200, height: 300 }).cols).toBe(1);
  });
});

describe('loadDimIndex (E2)', () => {
  const dims = [
    { width: 200, height: 300 },
    { width: 800, height: 1200 },
  ];
  it('loads the larger cover on Retina or when stretched', () => {
    expect(loadDimIndex(dims, 200, 1)).toBe(0);
    expect(loadDimIndex(dims, 200, 2)).toBe(1);
    expect(loadDimIndex(dims, 250, 1)).toBe(1);
    expect(loadDimIndex(dims, 1000, 2)).toBe(1); // nothing large enough: the largest
    expect(loadDimIndex([], 100, 1)).toBe(0);
  });
});

describe('moveCursor (E7)', () => {
  // 10 books, 4 columns: rows 0–3, 4–7, 8–9
  const m = (i: number, move: Parameters<typeof moveCursor>[1], page = 1) =>
    moveCursor(i, move, 4, 10, page);
  it('moves within the grid and stops at the edges', () => {
    expect(m(-1, 'right')).toBe(0);
    expect(m(0, 'left')).toBe(0);
    expect(m(3, 'right')).toBe(4);
    expect(m(9, 'right')).toBe(9);
    expect(m(5, 'up')).toBe(1);
    expect(m(1, 'up')).toBe(1);
    expect(m(1, 'down')).toBe(5);
    expect(m(7, 'down')).toBe(9); // shorter last row
    expect(m(9, 'down')).toBe(9);
    expect(m(5, 'home')).toBe(0);
    expect(m(5, 'end')).toBe(9);
  });
  it('pages by full rows', () => {
    expect(m(1, 'pageDown', 2)).toBe(9);
    expect(m(9, 'pageUp', 2)).toBe(1);
    expect(m(6, 'pageUp', 2)).toBe(2);
    expect(moveCursor(0, 'down', 4, 0, 1)).toBe(-1);
  });
  it('knows the rows of a page', () => {
    expect(pageRows(1000, 300, 64)).toBe(3);
    expect(pageRows(100, 300, 64)).toBe(1);
  });
});

describe('scrolling (E7, E10)', () => {
  // 4 columns, covers 300 high, toolbar 60, view 800
  const show = (i: number, top: number) => scrollToShow(i, 4, 300, 60, 800, top);
  it('keeps the cursor below the toolbar and inside the view', () => {
    expect(show(0, 0)).toBeNull();
    expect(show(4, 0)).toBeNull(); // row 1: 360–660
    expect(show(8, 0)).toBe(160); // row 2: 660–960 → bottom at 800
    expect(show(0, 200)).toBe(0); // row 0 is under the toolbar
    expect(show(4, 400)).toBe(300);
  });
  it('remembers the top row as a book index', () => {
    expect(topIndex(0, 4, 300)).toBe(0);
    expect(topIndex(650, 4, 300)).toBe(8);
    expect(scrollForTop(8, 4, 300)).toBe(600);
    expect(scrollForTop(10, 5, 300)).toBe(600);
  });
});
