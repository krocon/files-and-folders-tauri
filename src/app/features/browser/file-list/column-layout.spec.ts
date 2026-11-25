import {
  allColumnsInOrder,
  CELL_PADDING,
  columnLayout,
  dateColumnWidth,
  DEFAULT_COLUMNS,
  moveItem,
  roughTextWidth,
  sanitizeColumns,
  stripAutoWidths,
  toggleColumn,
  WIDE_DATE_MS,
  widthsOf,
} from './column-layout';

const visible = (layout: { property: string; visible?: boolean }[]) =>
  layout.filter((c) => c.visible).map((c) => c.property);

describe('column layout (design 041)', () => {
  it('reads the stored choice: known columns once, in order, always with the name', () => {
    expect(sanitizeColumns(['size', 'name', 'createdMs'])).toEqual(['size', 'name', 'createdMs']);
    expect(sanitizeColumns(['ext', 'ext', 'owner', 7, null])).toEqual(['name', 'ext']);
    expect(sanitizeColumns([])).toEqual(['name']);
    expect(sanitizeColumns('name')).toEqual(DEFAULT_COLUMNS);
    expect(sanitizeColumns(undefined)).toEqual(DEFAULT_COLUMNS);
  });

  it('hides a column and shows it again where one expects it; the name stays', () => {
    expect(toggleColumn(DEFAULT_COLUMNS, 'size')).toEqual(['name', 'ext', 'modifiedMs']);
    expect(toggleColumn(['name', 'ext', 'modifiedMs'], 'size')).toEqual(DEFAULT_COLUMNS);
    expect(toggleColumn(DEFAULT_COLUMNS, 'createdMs')).toEqual([...DEFAULT_COLUMNS, 'createdMs']);
    expect(toggleColumn(DEFAULT_COLUMNS, 'name')).toEqual(DEFAULT_COLUMNS);
    // an own order: behind the last chosen column that comes before it
    expect(toggleColumn(['modifiedMs', 'name'], 'ext')).toEqual(['modifiedMs', 'name', 'ext']);
    expect(toggleColumn(['size'] as never, 'name')).toEqual(['name', 'size']);
  });

  it('moves an entry and stops at the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, -2)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 5)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a'], 3, 1)).toEqual(['a']);
  });

  it('lists every column for the dialog: the chosen ones first', () => {
    expect(allColumnsInOrder(['size', 'name'])).toEqual([
      'size',
      'name',
      'ext',
      'modifiedMs',
      'createdMs',
      'accessedMs',
      'attrs',
      'type',
    ]);
  });

  it('a folder tab shows the chosen columns in their order, no special ones', () => {
    const layout = columnLayout(['name', 'createdMs', 'ext'], {});
    expect(visible(layout)).toEqual(['name', 'createdMs', 'ext']);
    // every column of the table is placed: the order is complete
    expect(layout.map((c) => c.property)).toEqual([
      'name',
      'createdMs',
      'ext',
      'size',
      'modifiedMs',
      'accessedMs',
      'attrs',
      'type',
      'group',
      'decision',
      'pixels',
      'share',
      'items',
      'dir',
      'relDir',
    ]);
  });

  it('result tabs add their columns behind the chosen ones', () => {
    expect(visible(columnLayout(DEFAULT_COLUMNS, { dir: true }))).toEqual([
      ...DEFAULT_COLUMNS,
      'dir',
    ]);
    expect(visible(columnLayout(DEFAULT_COLUMNS, { relDir: true }))).toEqual([
      ...DEFAULT_COLUMNS,
      'relDir',
    ]);
    // duplicates: no extension column, group and decision (design 042)
    expect(
      visible(columnLayout(DEFAULT_COLUMNS, { duplicates: true, decision: true, dir: true })),
    ).toEqual(['name', 'size', 'modifiedMs', 'group', 'decision', 'dir']);
    // disk usage: name and size whatever is chosen (design 033)
    expect(visible(columnLayout(['name', 'ext', 'type'], { usage: true }))).toEqual([
      'name',
      'size',
      'share',
      'items',
    ]);
  });

  it('widths: the tab’s own first, then the measured one, else none (the code’s width)', () => {
    const layout = columnLayout(
      DEFAULT_COLUMNS,
      {},
      { size: 120, modifiedMs: 300 },
      { modifiedMs: 180, createdMs: 180 },
    );
    const by = Object.fromEntries(layout.map((c) => [c.property, c.width]));
    expect(by['size']).toBe(120);
    expect(by['modifiedMs']).toBe(300);
    expect(by['createdMs']).toBe(180);
    expect('width' in layout[0]).toBe(false);
  });

  it('keeps only widths the user set: a measured width is not stored', () => {
    const state = {
      sort: [],
      columns: [
        { property: 'name', visible: true },
        { property: 'size', width: 120, visible: true },
        { property: 'modifiedMs', width: 180, visible: true },
        { property: 'createdMs', width: 240, visible: false },
      ],
    };
    const kept = stripAutoWidths(state, { modifiedMs: 180, createdMs: 180 });
    expect(widthsOf(kept)).toEqual({ size: 120, createdMs: 240 });
    expect(kept.sort).toEqual([]);
    expect(widthsOf(null)).toEqual({});
    expect(stripAutoWidths({ sort: [] }, {})).toEqual({ sort: [] });
  });

  // TODO.md §4: "Modified" was 160 px – the US format `10/19/2026, 08:48 AM` was cut off
  it('the date column is as wide as a date in the format of the language', () => {
    const us = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(WIDE_DATE_MS));
    expect(us).toBe('12/28/2028, 10:48 PM');
    const width = dateColumnWidth(us, roughTextWidth);
    expect(width).toBeGreaterThanOrEqual(roughTextWidth(us) + CELL_PADDING);
    expect(width).toBeGreaterThan(160);
    // a short format is not wider than needed, but keeps room for its title
    expect(dateColumnWidth('2028-12-28 22:48', roughTextWidth)).toBe(16 * 8 + CELL_PADDING);
    expect(dateColumnWidth('1.1.', roughTextWidth)).toBe(110);
  });

  // seen in the browser: `2026-09-02 08:48` was cut where `2026-10-12 11:11` fitted
  it('measures with the widest digit: a proportional font has narrow ones', () => {
    const proportional = (text: string) =>
      [...text].reduce((w, c) => w + (c === '1' ? 5 : /\d/.test(c) ? 8 : 4), 0);
    const sample = '2021-11-11 11:11';
    expect(proportional(sample)).toBeLessThan(proportional('2028-08-08 08:08'));
    expect(dateColumnWidth(sample, proportional)).toBe(12 * 8 + 4 * 4 + CELL_PADDING);
  });
});
