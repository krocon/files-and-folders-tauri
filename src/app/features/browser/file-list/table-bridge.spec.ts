import { TableApi } from '@guiexpert/table';
import { describe, expect, it, vi } from 'vitest';
import { createFileTable } from './file-table-model';
import { createTableBridge } from './table-bridge';

function fakeApi() {
  const header = { setValue: vi.fn() };
  const model = { getAreaModel: () => header, recalcHeightAndPadding: vi.fn() };
  const api = {
    getTableScope: () => ({}),
    getTableModel: () => model,
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
    const { api, header, model } = fakeApi();
    const bridge = createTableBridge(api as unknown as TableApi, body, columnDefs);
    bridge.setPresentation({ headers: { size: 'Größe' }, rowHeight: body.defaultRowHeight });
    const i = columnDefs.findIndex((d) => d.property === 'size');
    expect(header.setValue).toHaveBeenCalledWith(0, i, 'Größe');
    expect(model.recalcHeightAndPadding).not.toHaveBeenCalled();
  });
});
