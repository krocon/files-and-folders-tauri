import { TableApi } from '@guiexpert/table';
import { describe, expect, it, vi } from 'vitest';
import { createFileTable } from './file-table-model';
import { createTableBridge } from './table-bridge';

/** `order`: the properties in the order the table shows them now (design 041). */
function fakeApi(order: readonly string[] = []) {
  const header = { setValue: vi.fn(), getValueAt: vi.fn(() => 'old') };
  const model = { getAreaModel: () => header, recalcHeightAndPadding: vi.fn() };
  const api = {
    getTableScope: () => ({}),
    getTableModel: () => model,
    getColumnIndex: (property: string) => order.indexOf(property),
    recalcWrappers: vi.fn(),
    repaintHard: vi.fn(),
  };
  return { api, model, header };
}

describe('TableBridge.setPresentation (design 015)', () => {
  it('a new row height re-sizes the content (else the last rows are clipped)', () => {
    const { body, columnDefs } = createFileTable('x');
    const { api, model } = fakeApi();
    const bridge = createTableBridge(api as unknown as TableApi, body, columnDefs);
    bridge.setPresentation({ headers: {}, rowHeight: 34 });
    expect(body.defaultRowHeight).toBe(34);
    expect(model.recalcHeightAndPadding).toHaveBeenCalledTimes(1);
    expect(api.recalcWrappers).toHaveBeenCalledTimes(1);
    expect(api.repaintHard).toHaveBeenCalled();
  });

  it('titles change in place in the header row', () => {
    const { body, columnDefs } = createFileTable('x');
    const { api, header, model } = fakeApi(columnDefs.map((d) => d.property));
    const bridge = createTableBridge(api as unknown as TableApi, body, columnDefs);
    bridge.setPresentation({ headers: { size: 'Größe' }, rowHeight: body.defaultRowHeight });
    const i = columnDefs.findIndex((d) => d.property === 'size');
    expect(header.setValue).toHaveBeenCalledWith(0, i, 'Größe');
    expect(model.recalcHeightAndPadding).not.toHaveBeenCalled();
  });

  // design 041: the user moved columns – a title belongs to its property, not to the old index
  it('titles follow their column after the order changed', () => {
    const { body, columnDefs } = createFileTable('x');
    const { api, header } = fakeApi(['modifiedMs', 'size', 'name']);
    const bridge = createTableBridge(api as unknown as TableApi, body, columnDefs);
    bridge.setPresentation({
      headers: { size: 'Größe', modifiedMs: 'Geändert', ext: 'Endung' },
      rowHeight: body.defaultRowHeight,
    });
    expect(header.setValue.mock.calls).toEqual([
      [0, 1, 'Größe'],
      [0, 0, 'Geändert'],
    ]);
  });

  it('applies order, visibility and widths in one state; a covered table edits nothing', () => {
    const { body, columnDefs } = createFileTable('x');
    const applyState = vi.fn();
    const startEditing = vi.fn(() => true);
    const api = { ...fakeApi().api, applyState, startEditing };
    const bridge = createTableBridge(api as unknown as TableApi, body, columnDefs);
    const layout = [
      { property: 'size', visible: true, width: 90 },
      { property: 'name', visible: true },
    ];
    bridge.applyColumns(layout);
    expect(applyState).toHaveBeenCalledWith({ columns: layout }, ['columns']);
    body.setRows([
      {
        name: 'a.txt',
        path: '/a.txt',
        kind: 'file',
        targetKind: null,
        size: 1,
        modifiedMs: 1,
        hidden: false,
        lossyName: false,
      },
    ]);
    bridge.setCovered(true);
    expect(bridge.startRename('/a.txt', 1, () => undefined)).toBe(false);
    expect(startEditing).not.toHaveBeenCalled();
    bridge.setCovered(false);
    expect(bridge.startRename('/a.txt', 1, () => undefined)).toBe(true);
  });
});

/**
 * Dragged into another program (design 028), the system has the mouse: the page never gets
 * the mouseup. The table then stayed "pressed" – with the next move it went on with a column
 * drag and showed the name column as an empty drop zone. Since table 1.1.119 it has an API.
 */
describe('TableBridge.releaseMouse', () => {
  it('ends the press of the table through its API', () => {
    const { body, columnDefs } = createFileTable('x');
    const releaseMouse = vi.fn();
    const api = { ...fakeApi().api, releaseMouse };
    const bridge = createTableBridge(api as unknown as TableApi, body, columnDefs);
    bridge.releaseMouse();
    expect(releaseMouse).toHaveBeenCalledTimes(1);
  });
});
