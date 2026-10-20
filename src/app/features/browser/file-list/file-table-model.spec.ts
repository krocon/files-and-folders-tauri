import { computed } from '@angular/core';
import { afterEach } from 'vitest';
import { setLanguage } from '../../../core/i18n/i18n';
import { SelectionModel } from '@guiexpert/table';
import { dir, entry } from '../../../../testing/fs-fixtures';
import { createFileTable, FILE_LIST_SHORTCUTS, ROW_HEIGHT } from './file-table-model';

describe('createFileTable', () => {
  it('creates a compact table without table selection and with file-list shortcuts', () => {
    const { options, body, model } = createFileTable('path-1');
    expect(options.defaultRowHeights.body).toBe(ROW_HEIGHT);
    expect(options.hoverColumnVisible).toBe(false);
    expect(options.tableTopBorderVisible).toBe(false);
    expect((options.getSelectionModel?.() as SelectionModel).selectionType).toBe('none');
    expect(options.shortcutActionIdMapping).toEqual(FILE_LIST_SHORTCUTS);
    expect(options.ariaLabelledBy).toBe('path-1');
    expect(model.getBodyModel()).toBe(body);
  });
});

describe('FileBodyModel.getCustomClassesAt', () => {
  it('adds cursor, marked, hidden and symlink classes per row', () => {
    const { body } = createFileTable('x');
    const rows = [
      dir('a', { path: '/a' }),
      entry('.h', { path: '/.h', hidden: true }),
      entry('l', { path: '/l', kind: 'symlink', targetKind: 'file' }),
      entry('u', { path: '/u', kind: 'unknown' }),
    ];
    body.setRows(rows);
    body.setRowState({ cursorRow: () => 0, isMarked: (p) => p === '/.h' });
    expect(body.getCustomClassesAt(0, 0)).toContain('fnf-cursor');
    expect(body.getCustomClassesAt(0, 0)).not.toContain('fnf-marked');
    expect(body.getCustomClassesAt(1, 2)).toEqual(
      expect.arrayContaining(['fnf-marked', 'fnf-hidden']),
    );
    expect(body.getCustomClassesAt(1, 2)).not.toContain('fnf-cursor');
    expect(body.getCustomClassesAt(2, 0)).toContain('fnf-symlink');
    expect(body.getCustomClassesAt(3, 0)).toContain('fnf-unreadable');
    expect(body.getCustomClassesAt(9, 0)).not.toContain('fnf-cursor');
  });
});

describe('FileBodyModel.replaceRows (review 012 #5)', () => {
  it('replaces rows by path in place and tells whether one of them is displayed', () => {
    const { body } = createFileTable('x');
    const a = entry('a.txt', { path: '/w/a.txt', size: 1 });
    const h = entry('.h', { path: '/w/.h', size: 1, hidden: true });
    body.setRows([a, h]);
    body.externalFilterChanged((r: { hidden: boolean }) => !r.hidden);
    expect(body.getFilteredRows()).toEqual([a]);
    const h2 = { ...h, size: 2 };
    expect(body.replaceRows([h2])).toEqual({ found: 1, visible: false });
    const a2 = { ...a, size: 3 };
    expect(body.replaceRows([a2, entry('x', { path: '/w/x' })])).toEqual({
      found: 1,
      visible: true,
    });
    expect(body.getFilteredRows()[0]).toBe(a2);
    expect(body.getRowByIndex(0)).toBe(a2);
  });
});

describe('createFileTable and the language (design 015)', () => {
  afterEach(() => setLanguage('en'));

  it('reads no signal: a language switch must not re-create the table (titles change in place)', () => {
    const table = computed(() => createFileTable('label'));
    const first = table();
    setLanguage('de');
    expect(table()).toBe(first);
  });
});
