import { FileActionRule } from '../../core/fileactions/file-actions.models';
import { DirEntry } from '../../core/fs/fs.models';
import { dir, entry } from '../../../testing/fs-fixtures';
import {
  availableModifiers,
  findRule,
  modifierLabel,
  normalizeModifiers,
  patternMatches,
  shadowedRules,
} from './file-actions-logic';

const rule = (
  id: string,
  pattern: string,
  modifiers: FileActionRule['modifiers'] = [],
): FileActionRule => ({
  id,
  trigger: 'doubleClick',
  modifiers,
  pattern,
  confirm: true,
  command: 'x',
  terminal: false,
});

describe('double-click rules (design 072)', () => {
  it.each([
    ['*.js', 'rename_movies.js', true],
    ['*.js', 'RENAME.JS', true],
    ['*.js', 'a.json', false],
    ['*.js', 'js', false],
    ['*.js;*.mjs', 'a.mjs', true],
    ['*.js *.mjs', 'a.mjs', true],
    ['report-?.txt', 'report-1.txt', true],
    ['report-?.txt', 'report-12.txt', false],
    ['a+b(1).txt', 'a+b(1).txt', true],
    ['a.b', 'axb', false],
    ['*', 'anything', true],
    ['', 'anything', false],
    ['  ', 'anything', false],
  ])('%s on %s → %s', (pattern, name, expected) => {
    expect(patternMatches(pattern, name)).toBe(expected);
  });

  it('takes the first matching rule from the top', () => {
    const rules = [rule('py', '*.py'), rule('js', '*.js'), rule('all', '*')];
    expect(findRule(rules, 'doubleClick', [], entry('a.js'))?.id).toBe('js');
    expect(findRule(rules, 'doubleClick', [], entry('a.txt'))?.id).toBe('all');
    expect(findRule([rule('py', '*.py')], 'doubleClick', [], entry('a.js'))).toBeNull();
  });

  it('never applies to folders, ".." or names that cannot be addressed', () => {
    const rules = [rule('all', '*')];
    expect(findRule(rules, 'doubleClick', [], dir('folder.js'))).toBeNull();
    expect(
      findRule(rules, 'doubleClick', [], { ...entry('..'), parentLink: true } as DirEntry),
    ).toBeNull();
    expect(findRule(rules, 'doubleClick', [], entry('a.js', { lossyName: true }))).toBeNull();
  });
});

describe('keys held with the double click (design 073)', () => {
  it('needs exactly the same keys – no fallback to the rule without keys', () => {
    const rules = [rule('plain', '*.js'), rule('shift', '*.js', ['shift'])];
    expect(findRule(rules, 'doubleClick', [], entry('a.js'))?.id).toBe('plain');
    expect(findRule(rules, 'doubleClick', ['shift'], entry('a.js'))?.id).toBe('shift');
    expect(findRule(rules, 'doubleClick', ['mod'], entry('a.js'))).toBeNull();
    expect(findRule(rules, 'doubleClick', ['shift', 'alt'], entry('a.js'))).toBeNull();
    expect(
      findRule([rule('shift', '*.js', ['shift'])], 'doubleClick', [], entry('a.js')),
    ).toBeNull();
  });

  it('the order of the keys does not matter, the first rule from the top wins', () => {
    const rules = [rule('one', '*.js', ['shift', 'alt']), rule('two', '*', ['alt', 'shift'])];
    expect(findRule(rules, 'doubleClick', ['alt', 'shift'], entry('a.js'))?.id).toBe('one');
    expect(findRule(rules, 'doubleClick', ['shift', 'alt'], entry('a.txt'))?.id).toBe('two');
  });

  it('offers the same keys on every OS, named like the shortcut badges', () => {
    for (const os of ['macos', 'windows', 'linux'] as const) {
      expect(availableModifiers(os)).toEqual(['mod', 'alt', 'shift']);
    }
    expect(modifierLabel(['mod', 'alt', 'shift'], 'macos')).toBe('⌥⇧⌘');
    expect(modifierLabel(['shift', 'mod'], 'linux')).toBe('Ctrl+Shift');
    expect(modifierLabel(['shift'], 'windows')).toBe('Shift');
    expect(modifierLabel([], 'macos')).toBe('');
    expect(modifierLabel(['hyper', 'shift'], 'linux')).toBe('Shift');
  });

  it('normalizes keys: canonical order, no doubles, nothing unknown', () => {
    expect(normalizeModifiers(['shift', 'ctrl', 'mod', 'shift'])).toEqual(['mod', 'shift']);
  });

  it('marks a rule that an identical one above hides', () => {
    const rules = [
      rule('a', '*.js;*.mjs'),
      rule('b', '*.MJS *.js'), // same globs → never fires
      rule('c', '*.js', ['shift']), // other keys
      rule('d', '*.js;*.ts'), // overlaps only
      rule('e', ''),
      rule('f', ''),
    ];
    expect([...shadowedRules(rules)]).toEqual(['b']);
  });
});
