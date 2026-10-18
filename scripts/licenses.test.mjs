import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPermissive, summarise } from './licenses.mjs';

test('SPDX expressions', () => {
  assert.ok(isPermissive('MIT'));
  assert.ok(isPermissive('MIT OR Apache-2.0'));
  assert.ok(isPermissive('(MIT OR Apache-2.0) AND Unicode-3.0'));
  assert.ok(isPermissive('MIT/Apache-2.0'));
  assert.ok(isPermissive('LGPL-2.1 OR MIT'));
  assert.ok(!isPermissive('MPL-2.0'));
  assert.ok(!isPermissive('GPL-3.0'));
  assert.ok(!isPermissive(null));
});

test('summary sorted by count', () => {
  assert.deepEqual(
    summarise([{ license: 'MIT' }, { license: 'ISC' }, { license: 'MIT' }, { license: null }]),
    [
      ['MIT', 2],
      ['(none)', 1],
      ['ISC', 1],
    ],
  );
});
