import { describe, expect, it } from 'vitest';
import { SearchHit } from '../../core/search/search.models';
import cases from './duplicates-rules.cases.json';
import {
  BUILT_IN_SETS,
  decide,
  dedupePlan,
  globSource,
  groupOrder,
  isCopyName,
  keepOnly,
  Rule,
  RuleSet,
  validateRuleSet,
} from './duplicates-rules';

interface Row {
  path: string;
  name: string;
  size: number;
  modifiedMs: number | null;
  group: number;
  sameAs?: string;
  links?: number;
  width?: number;
  height?: number;
  order?: number;
}

interface Case {
  name: string;
  rows: Row[];
  rules: Rule[];
  marks: string[];
  undecided?: number[];
  decisions?: Record<string, string>;
  reasons?: Record<string, number | string>;
  inFolder?: Record<string, boolean[]>;
}

function hit(r: Row): SearchHit {
  return {
    ...r,
    kind: 'file',
    targetKind: null,
    hidden: false,
    lossyName: false,
    dir: '',
    relDir: '',
    parentNames: ['', '', ''],
  } as unknown as SearchHit;
}

describe('duplicates rules (design 042 E2) – table', () => {
  for (const c of (cases as unknown as { decide: Case[] }).decide) {
    it(c.name, () => {
      const rows = c.rows.map(hit);
      const ctx = c.inFolder ? { inFolder: (p: string, i: number) => c.inFolder![p][i] } : {};
      const res = decide(rows, { rules: c.rules }, ctx);
      expect([...res.marks].sort()).toEqual([...c.marks].sort());
      if (c.undecided) {
        expect(res.undecided).toEqual(c.undecided);
      }
      for (const [path, d] of Object.entries(c.decisions ?? {})) {
        expect(res.decisions.get(path)?.decision, path).toBe(d);
      }
      for (const [path, reason] of Object.entries(c.reasons ?? {})) {
        expect(res.decisions.get(path)?.reason, path).toBe(reason);
      }
      // never a whole group
      for (const g of new Set(rows.map((r) => r.group))) {
        const inGroup = rows.filter((r) => r.group === g && r.sameAs === undefined);
        if (inGroup.length > 1) {
          expect(inGroup.every((r) => res.marks.includes(r.path))).toBe(false);
        }
      }
    });
  }
});

describe('duplicates rules – helpers', () => {
  const t = cases as unknown as { copyNames: { copies: string[]; originals: string[] } };

  it('recognises copy names (de/en/fr/es, with and without extension)', () => {
    for (const n of t.copyNames.copies) {
      expect(isCopyName(n), n).toBe(true);
    }
    for (const n of t.copyNames.originals) {
      expect(isCopyName(n), n).toBe(false);
    }
  });

  it('turns globs into unanchored path patterns', () => {
    expect(globSource('**/a?/*.jpg')).toBe('.*/a[^/]/[^/]*\\.jpg');
    expect(globSource('C:\\x')).toBe('C:/x');
    expect(globSource('(a+b)')).toBe('\\(a\\+b\\)');
  });

  it('validates rule sets', () => {
    expect(validateRuleSet({ rules: [{ kind: 'oldest' }] })).toBeNull();
    expect(
      validateRuleSet({
        rules: [{ kind: 'oldest' }, { kind: 'pathPattern', pattern: '[', syntax: 'regex' }],
      }),
    ).toEqual({ rule: 1, reason: 'badRegex' });
    expect(validateRuleSet({ rules: [{ kind: 'pathPattern', pattern: '' }] })?.reason).toBe(
      'emptyPattern',
    );
    expect(validateRuleSet({ rules: [{ kind: 'inFolder' }] })?.reason).toBe('noFolder');
    // the built-in sets are valid
    for (const set of Object.values(BUILT_IN_SETS)) {
      expect(validateRuleSet(set)).toBeNull();
    }
  });

  const rows = [
    hit({ path: '/a/keep', name: 'keep', size: 10, modifiedMs: 1, group: 1 }),
    hit({ path: '/a/copy', name: 'copy', size: 10, modifiedMs: 2, group: 1 }),
    hit({ path: '/a/alias', name: 'alias', size: 10, modifiedMs: 2, group: 1, sameAs: '/a/copy' }),
    hit({ path: '/b/x', name: 'x', size: 5, modifiedMs: 1, group: 2 }),
    hit({ path: '/b/y', name: 'y', size: 5, modifiedMs: 2, group: 2 }),
    hit({ path: '/c/l1', name: 'l1', size: 7, modifiedMs: 1, group: 3, links: 2 }),
    hit({ path: '/c/l2', name: 'l2', size: 7, modifiedMs: 2, group: 3 }),
  ];

  it('plans the dedupe job: kept file, copies, bytes; whole groups are left out', () => {
    const decided = decide(rows, { rules: [{ kind: 'oldest' }] });
    const plan = dedupePlan(rows, new Set(decided.marks), decided.decisions);
    expect(plan.files).toBe(3);
    expect(plan.bytes).toBe(10 + 5 + 7);
    expect(plan.groups.map((g) => [g.keep.path, g.remove.map((r) => r.path)])).toEqual([
      ['/a/keep', ['/a/copy']],
      ['/b/x', ['/b/y']],
      ['/c/l1', ['/c/l2']],
    ]);
    expect(plan.groups[0].keep).toEqual({ path: '/a/keep', kind: 'file', size: 10, modifiedMs: 1 });
    // a whole group marked: nothing of it, reported
    const all = dedupePlan(rows, new Set(['/b/x', '/b/y']));
    expect(all.groups).toEqual([]);
    expect(all.withoutKeep).toEqual([2]);
    // an alias or a linked file marked by hand is never removed
    const manual = dedupePlan(rows, new Set(['/a/alias', '/c/l1']));
    expect(manual.files).toBe(0);
  });

  it('keeps only the chosen file (Enter)', () => {
    expect(keepOnly(rows, '/a/copy')).toEqual({
      mark: ['/a/keep'],
      unmark: ['/a/copy', '/a/alias'],
    });
    // on an alias: its file stays
    expect(keepOnly(rows, '/a/alias')?.mark).toEqual(['/a/keep']);
    // a linked file is never marked
    expect(keepOnly(rows, '/c/l2')).toEqual({ mark: [], unmark: ['/c/l2', '/c/l1'] });
    expect(keepOnly(rows, '/nope')).toBeNull();
  });

  it('lists groups in the order of the rows', () => {
    expect(groupOrder([rows[3], rows[0], rows[4], rows[1]])).toEqual([2, 1]);
  });

  it('decides 100 000 rows quickly', () => {
    const many: SearchHit[] = [];
    for (let i = 0; i < 100_000; i++) {
      many.push(
        hit({
          path: `/d${i % 1000}/f${i}`,
          name: `f${i}`,
          size: 1,
          modifiedMs: i,
          group: Math.floor(i / 4) + 1,
        }),
      );
    }
    const set: RuleSet = BUILT_IN_SETS.copyNamesThenOldest;
    const start = performance.now();
    const res = decide(many, set);
    expect(performance.now() - start).toBeLessThan(1500);
    expect(res.marks.length).toBe(75_000);
  });
});
