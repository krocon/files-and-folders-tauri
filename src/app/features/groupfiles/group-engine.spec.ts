import { describe, expect, it } from 'vitest';
import cases from './group-engine.cases.json';
import {
  checkGroupName,
  DEFAULT_GROUP_OPTIONS,
  GroupMode,
  GroupOptions,
  groupEntries,
  groupOf,
} from './group-engine';

interface Case {
  mode: string;
  name?: string;
  names?: string[];
  newFolder?: string;
  ignoreBrackets?: boolean;
  minSize?: number;
}

function options(c: Case): GroupOptions {
  return {
    ...DEFAULT_GROUP_OPTIONS,
    mode: c.mode as GroupMode,
    newFolder: c.newFolder ?? '',
    ignoreBrackets: c.ignoreBrackets ?? true,
    minSize: c.minSize ?? 2,
  };
}

describe('group engine (design 008 E1)', () => {
  for (const c of cases.groupOf) {
    it(`${c.mode}: ${JSON.stringify(c.name)} → ${JSON.stringify(c.group)}`, () => {
      expect(groupOf(c.name, options(c))).toBe(c.group);
    });
  }

  for (const c of cases.groupEntries) {
    it(c.title, () => {
      const out = groupEntries(c.names, options(c));
      expect(out.results.map((r) => r.status)).toEqual(c.status);
      expect(out.groupCount).toBe(c.count);
    });
  }

  it('checks group names for every platform', () => {
    expect(checkGroupName('ok name')).toBeNull();
    expect(checkGroupName('..')).not.toBeNull();
    expect(checkGroupName('a/b')).not.toBeNull();
    expect(checkGroupName('a\\b')).not.toBeNull();
    expect(checkGroupName('a?')).not.toBeNull();
    expect(checkGroupName('tab\there')).not.toBeNull();
    expect(checkGroupName('end.')).not.toBeNull();
    expect(checkGroupName('x'.repeat(255))).toBeNull();
    expect(checkGroupName('ü'.repeat(128))).not.toBeNull(); // 256 bytes
  });
});
