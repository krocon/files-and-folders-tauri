import { FileActionRule } from '../../core/fileactions/file-actions.models';
import { DirEntry } from '../../core/fs/fs.models';
import { dir, entry } from '../../../testing/fs-fixtures';
import { findRule, patternMatches } from './file-actions-logic';

const rule = (id: string, pattern: string): FileActionRule => ({
  id,
  trigger: 'doubleClick',
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
    expect(findRule(rules, 'doubleClick', entry('a.js'))?.id).toBe('js');
    expect(findRule(rules, 'doubleClick', entry('a.txt'))?.id).toBe('all');
    expect(findRule([rule('py', '*.py')], 'doubleClick', entry('a.js'))).toBeNull();
  });

  it('never applies to folders, ".." or names that cannot be addressed', () => {
    const rules = [rule('all', '*')];
    expect(findRule(rules, 'doubleClick', dir('folder.js'))).toBeNull();
    expect(
      findRule(rules, 'doubleClick', { ...entry('..'), parentLink: true } as DirEntry),
    ).toBeNull();
    expect(findRule(rules, 'doubleClick', entry('a.js', { lossyName: true }))).toBeNull();
  });
});
