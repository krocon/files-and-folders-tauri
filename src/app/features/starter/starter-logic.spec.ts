import { StarterItem } from '../../core/starter/starter.models';
import {
  canIndent,
  canOutdent,
  indent,
  insert,
  menuTree,
  move,
  newId,
  outdent,
  remove,
  rows,
  runnable,
  sameItems,
  update,
} from './starter-logic';

const p = (id: string): StarterItem => ({ id, kind: 'program', label: id, program: 'x' });
const sub = (id: string, items: StarterItem[]): StarterItem => ({
  id,
  kind: 'submenu',
  label: id,
  items,
});
const ids = (items: readonly StarterItem[]) =>
  rows(items).map((r) => `${'  '.repeat(r.depth)}${r.item.id}`);

describe('starter logic (design 032)', () => {
  const base: StarterItem[] = [
    p('a'),
    { id: 'sep', kind: 'separator' },
    sub('m', [p('b'), sub('n', [p('c')])]),
    { id: 'f', kind: 'folder', label: 'F', folder: '/x' },
  ];

  it('builds the menu tree and the runnable entries', () => {
    expect(menuTree(base)).toEqual([
      { kind: 'item', id: 'starter:a' },
      { kind: 'separator' },
      {
        kind: 'sub',
        label: 'm',
        items: [
          { kind: 'item', id: 'starter:b' },
          { kind: 'sub', label: 'n', items: [{ kind: 'item', id: 'starter:c' }] },
        ],
      },
      { kind: 'item', id: 'starter:f' },
    ]);
    expect(runnable(base).map((i) => i.id)).toEqual(['a', 'b', 'c', 'f']);
    expect(ids(base)).toEqual(['a', 'sep', 'm', '  b', '  n', '    c', 'f']);
  });

  it('inserts after the selection, into an open submenu first, at the end without one', () => {
    expect(ids(insert(base, 'a', p('x')))).toEqual([
      'a',
      'x',
      'sep',
      'm',
      '  b',
      '  n',
      '    c',
      'f',
    ]);
    expect(ids(insert(base, 'm', p('x'), true)).slice(2, 5)).toEqual(['m', '  x', '  b']);
    expect(ids(insert(base, 'c', p('x'))).slice(5, 7)).toEqual(['    c', '    x']);
    expect(ids(insert(base, null, p('x'))).at(-1)).toBe('x');
    expect(newId(base)).toBe('s1');
    expect(newId([p('s1'), sub('m', [p('s2')])])).toBe('s3');
  });

  it('moves within the siblings, in and out of submenus', () => {
    expect(ids(move(base, 'f', -1)).slice(2)).toEqual(['f', 'm', '  b', '  n', '    c']);
    expect(move(base, 'a', -1)).toBe(base);
    expect(ids(move(base, 'b', 1)).slice(3, 6)).toEqual(['  n', '    c', '  b']);
    // f goes into m (the submenu above), as last child
    expect(canIndent(base, 'f')).toBe(true);
    expect(ids(indent(base, 'f')).slice(-1)).toEqual(['  f']);
    // a has no submenu above it
    expect(canIndent(base, 'a')).toBe(false);
    expect(indent(base, 'a')).toBe(base);
    // c leaves n and stands right after it
    expect(canOutdent(base, 'c')).toBe(true);
    expect(ids(outdent(base, 'c')).slice(3, 6)).toEqual(['  b', '  n', '  c']);
    expect(canOutdent(base, 'a')).toBe(false);
    expect(ids(remove(base, 'm'))).toEqual(['a', 'sep', 'f']);
  });

  it('never nests deeper than Rust allows', () => {
    let deep: StarterItem = p('leaf');
    for (let i = 0; i < 5; i++) {
      deep = sub(`m${i}`, [deep]);
    }
    // m4 holds entries 5 levels down; inside another submenu the leaf would be at level 6
    expect(canIndent([sub('x', []), deep], 'm4')).toBe(false);
    expect(canIndent([sub('x', []), deep.items![0]], 'm3')).toBe(true);
    expect(canIndent([sub('x', []), p('y')], 'y')).toBe(true);
  });

  it('updates fields and compares drafts by content', () => {
    const next = update(base, 'c', { params: '"%P%N"' });
    expect(rows(next).find((r) => r.item.id === 'c')!.item.params).toBe('"%P%N"');
    expect(sameItems(base, next)).toBe(false);
    // empty optional fields equal missing ones (Rust leaves them out)
    expect(
      sameItems(
        [{ id: 'a', kind: 'program', label: 'a', params: '' }],
        [{ id: 'a', kind: 'program', label: 'a' }],
      ),
    ).toBe(true);
  });
});
