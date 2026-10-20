import { ActionId } from '../../core/actions/action-catalog';
import { BUTTON_SETS } from '../workspace/button-bar/button-config';
import {
  addProblem,
  insertSlot,
  minimalOverride,
  moveSlot,
  removeSlot,
  replaceSlot,
  resolveButtonSets,
} from './button-config-logic';

describe('button configuration logic (design 022 E1)', () => {
  it('overrides per set and drops unknown ids, duplicates and extra slots', () => {
    const many = Array.from({ length: 12 }, () => 'OPEN_COPY_DLG');
    const r = resolveButtonSets(BUTTON_SETS, {
      shift: ['OPEN_VIEW_DLG', 'NO_SUCH_ACTION', 'OPEN_VIEW_DLG', 'OPEN_MOVE_DLG'],
      alt: [],
      ctrl: many,
      meta: ['OPEN_VIEW_DLG'],
    });
    expect(r.sets.shift).toEqual(['OPEN_VIEW_DLG', 'OPEN_MOVE_DLG']);
    expect(r.sets.alt).toEqual([]);
    expect(r.sets.ctrl).toEqual(['OPEN_COPY_DLG']);
    expect(r.sets.default).toBe(BUTTON_SETS.default);
    expect(r.sets.cmd).toBe(BUTTON_SETS.cmd);
    expect(r.unknown).toEqual(['NO_SUCH_ACTION']);
  });

  it('writes only the sets that differ from the built-in ones', () => {
    const sets = { ...BUTTON_SETS, alt: ['OPEN_VIEW_DLG'] as ActionId[] };
    expect(minimalOverride(BUTTON_SETS, sets)).toEqual({ alt: ['OPEN_VIEW_DLG'] });
    expect(minimalOverride(BUTTON_SETS, BUTTON_SETS)).toEqual({});
  });

  it('moves, removes, inserts and replaces slots', () => {
    const l: ActionId[] = ['OPEN_COPY_DLG', 'OPEN_MOVE_DLG', 'OPEN_VIEW_DLG'];
    expect(moveSlot(l, 0, 1)).toEqual(['OPEN_MOVE_DLG', 'OPEN_COPY_DLG', 'OPEN_VIEW_DLG']);
    expect(moveSlot(l, 0, -1)).toBe(l);
    expect(moveSlot(l, 2, 1)).toBe(l);
    expect(removeSlot(l, 1)).toEqual(['OPEN_COPY_DLG', 'OPEN_VIEW_DLG']);
    expect(removeSlot(l, 5)).toBe(l);
    expect(insertSlot(l, 0, 'OPEN_MKDIR_DLG')).toEqual([
      'OPEN_COPY_DLG',
      'OPEN_MKDIR_DLG',
      'OPEN_MOVE_DLG',
      'OPEN_VIEW_DLG',
    ]);
    expect(insertSlot([], -1, 'OPEN_MKDIR_DLG')).toEqual(['OPEN_MKDIR_DLG']);
    expect(insertSlot(l, 0, 'OPEN_MOVE_DLG')).toBe(l);
    expect(replaceSlot(l, 1, 'OPEN_MKDIR_DLG')).toEqual([
      'OPEN_COPY_DLG',
      'OPEN_MKDIR_DLG',
      'OPEN_VIEW_DLG',
    ]);
    expect(replaceSlot(l, 1, 'OPEN_VIEW_DLG')).toBe(l);
    expect(replaceSlot(l, 1, 'OPEN_MOVE_DLG')).toEqual(l);
  });

  it('explains why an action cannot be added', () => {
    const full = Array.from({ length: 10 }, (_, i) => `A${i}` as ActionId);
    expect(addProblem([], null)).toBe('none');
    expect(addProblem(['OPEN_COPY_DLG'], 'OPEN_COPY_DLG')).toBe('present');
    expect(addProblem(full, 'OPEN_COPY_DLG')).toBe('full');
    expect(addProblem([], 'OPEN_COPY_DLG')).toBeNull();
  });
});
