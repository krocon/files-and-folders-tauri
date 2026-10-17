import { dir, entry, listing } from '../../../../testing/fs-fixtures';
import { inPlaceUpdate } from './row-update';

describe('inPlaceUpdate (review 012 #5)', () => {
  const a = entry('a.txt', { path: '/w/a.txt', size: 1, modifiedMs: 1 });
  const b = entry('b.txt', { path: '/w/b.txt', size: 1, modifiedMs: 1 });
  const sub = dir('Sub', { path: '/w/Sub' });
  const before = listing('/w', [sub, a, b]);

  it('only sizes/times of existing entries changed: those rows and the changed columns', () => {
    const after = { ...before, entries: [sub, { ...a, size: 9 }, { ...b, modifiedMs: 2 }] };
    const u = inPlaceUpdate(before, after);
    expect(u?.rows.map((r) => r.name)).toEqual(['a.txt', 'b.txt']);
    expect([...(u?.columns ?? [])].sort()).toEqual(['modifiedMs', 'size']);
  });

  it('anything else is a full update', () => {
    expect(inPlaceUpdate(null, before)).toBeNull();
    expect(inPlaceUpdate(before, listing('/other', [sub, a, b]))).toBeNull();
    expect(inPlaceUpdate(before, { ...before, entries: [sub, a] })).toBeNull();
    expect(inPlaceUpdate(before, { ...before, entries: [sub, b, a] })).toBeNull();
    expect(inPlaceUpdate(before, { ...before, entries: [sub, { ...a, name: 'x' }, b] })).toBeNull();
    expect(
      inPlaceUpdate(before, { ...before, entries: [sub, { ...a, hidden: true }, b] }),
    ).toBeNull();
    // nothing changed at all: also null (the store keeps the same object then)
    expect(inPlaceUpdate(before, { ...before })).toBeNull();
  });
});
