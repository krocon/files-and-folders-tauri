import { describe, expect, it } from 'vitest';
import cases from './rename-engine.cases.json';
import {
  compileRules,
  CompiledRules,
  DEFAULT_RULES,
  EMPTY_REPLACEMENT,
  formatDate,
  formatTime,
  isRuleErrors,
  MACROS,
  macroReplacement,
  newName,
  RenameRules,
  RenameSource,
  Replacement,
  REPLACEMENT_ROWS,
  sanitizeRules,
  splitName,
} from './rename-engine';

interface CaseRules extends Partial<Omit<RenameRules, 'replacements'>> {
  replacements?: Partial<Replacement>[];
}

function rulesOf(partial: CaseRules | undefined, macros: number[] = []): RenameRules {
  const p = partial ?? {};
  const rows: Replacement[] = Array.from({ length: REPLACEMENT_ROWS }, (_, i) => ({
    ...EMPTY_REPLACEMENT,
    ...(p.replacements?.[i] ?? {}),
  }));
  macros.forEach((m, i) => (rows[i] = macroReplacement(MACROS[m])));
  return {
    ...DEFAULT_RULES,
    ...p,
    replaceEnabled: p.replaceEnabled ?? (p.replacements !== undefined || macros.length > 0),
    replacements: rows,
  };
}

function compiled(rules: RenameRules): CompiledRules {
  const c = compileRules(rules);
  if (isRuleErrors(c)) {
    throw new Error(c.map((e) => e.message).join(', '));
  }
  return c;
}

function source(s: {
  name: string;
  isDir?: boolean;
  modifiedMs?: number | null;
  parents?: string[];
}): RenameSource {
  return {
    name: s.name,
    isDir: s.isDir ?? false,
    modifiedMs: s.modifiedMs ?? null,
    parents: (s.parents ?? ['docs', 'marc', 'home']) as [string, string, string],
  };
}

describe('rename engine – catalog (rename-engine.cases.json)', () => {
  for (const c of cases.cases as {
    title: string;
    rules?: CaseRules;
    macros?: number[];
    source: { name: string; isDir?: boolean; parents?: string[] };
    index?: number;
    expected: string;
  }[]) {
    it(c.title, () => {
      const result = newName(compiled(rulesOf(c.rules, c.macros)), source(c.source), c.index ?? 0);
      expect(result).toBe(c.expected);
    });
  }

  for (const c of cases.errors as { title: string; rules: CaseRules; field: string }[]) {
    it(`error: ${c.title}`, () => {
      const result = compileRules(rulesOf(c.rules));
      expect(isRuleErrors(result)).toBe(true);
      expect((result as readonly { field: string }[]).map((e) => e.field)).toContain(c.field);
    });
  }

  for (const c of cases.valid as { title: string; rules: CaseRules }[]) {
    it(`valid: ${c.title}`, () => {
      expect(isRuleErrors(compileRules(rulesOf(c.rules)))).toBe(false);
    });
  }
});

describe('rename engine – details', () => {
  it('date and time of the file in local time, without ":"', () => {
    const ms = new Date(2026, 9, 17, 20, 52, 7).getTime();
    expect(formatDate(ms)).toBe('2026-10-17');
    expect(formatTime(ms)).toBe('20-52-07');
    const c = compiled(rulesOf({ pattern: '[D]_[T]_[N].[E]' }));
    expect(newName(c, source({ name: 'a.jpg', modifiedMs: ms }), 0)).toBe(
      '2026-10-17_20-52-07_a.jpg',
    );
    expect(newName(c, source({ name: 'a.jpg', modifiedMs: null }), 0)).toBe('__a.jpg');
  });

  it('splits names and extensions (E2)', () => {
    expect(splitName('a.tar.gz', false, true)).toEqual({ stem: 'a', ext: 'tar.gz' });
    expect(splitName('.tar.gz', false, true)).toEqual({ stem: '.tar', ext: 'gz' });
    expect(splitName('x.y', true, true)).toEqual({ stem: 'x.y', ext: '' });
  });

  it('error messages name the problem and do not throw', () => {
    const r = compileRules(
      rulesOf({ replacements: [{ enabled: true, find: '/(a/', regex: true }] }),
    );
    expect(isRuleErrors(r) && r[0].message).toMatch(/^Invalid expression/);
  });

  it('every macro example from the old help texts', () => {
    for (const m of MACROS) {
      expect(m.example).toContain('→');
    }
  });

  it('sanitizes stored rules', () => {
    expect(sanitizeRules(null)).toEqual(DEFAULT_RULES);
    const r = sanitizeRules({
      pattern: '[C]',
      counter: { start: -1, step: 50, digits: 99 },
      capitalize: 'nope',
      riskyChars: 'yes',
      replacements: [{ enabled: true, find: 'a', regex: 1 }],
    });
    expect(r.pattern).toBe('[C]');
    expect(r.counter).toEqual({ start: 1, step: 50, digits: 4 });
    expect(r.capitalize).toBe('none');
    expect(r.riskyChars).toBe(false);
    expect(r.replacements).toHaveLength(REPLACEMENT_ROWS);
    expect(r.replacements[0]).toEqual({ ...EMPTY_REPLACEMENT, enabled: true, find: 'a' });
  });

  it('10 000 names stay fast', () => {
    const c = compiled(
      rulesOf({
        pattern: '[N] [C].[E]',
        capitalize: 'chicago',
        umlauts: true,
        replacements: [{ enabled: true, find: '/(\\d+)/g', replace: '<$1>', regex: true }],
      }),
    );
    const sources = Array.from({ length: 10_000 }, (_, i) =>
      source({ name: `the über file ${i} of many.txt` }),
    );
    const start = performance.now();
    const out = sources.map((s, i) => newName(c, s, i));
    const ms = performance.now() - start;
    expect(out[42]).toBe('The Ueber File <42> of Many <0043>.txt');
    expect(ms).toBeLessThan(1500); // generous for CI; measured ~30–60 ms
  });
});
