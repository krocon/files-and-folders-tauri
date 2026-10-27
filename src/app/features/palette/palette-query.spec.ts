import { describe, expect, it } from 'vitest';
import cases from './palette-query.cases.json';
import {
  fold,
  hasFilter,
  isPathLike,
  matchesPath,
  parseQuery,
  parseSize,
  searchesFiles,
} from './palette-query';

describe('palette query language (catalog shared with Rust, design 043 E3)', () => {
  const now = cases.nowMs;
  const tz = cases.tzOffsetMinutes;

  for (const c of cases.parse) {
    it(`parses ${JSON.stringify(c.input)}`, () => {
      const q = parseQuery(c.input, now, tz);
      const want = c as Record<string, unknown>;
      expect(q.mode).toBe(c.mode);
      expect(q.terms).toEqual(want['terms'] ?? []);
      expect(q.not).toEqual(want['not'] ?? []);
      expect(q.ext).toEqual(want['ext'] ?? []);
      expect(q.inDirs).toEqual(want['inDirs'] ?? []);
      expect(q.inPaths).toEqual(want['inPaths'] ?? []);
      expect(q.sizeMin).toBe(want['sizeMin'] ?? null);
      expect(q.sizeMax).toBe(want['sizeMax'] ?? null);
      expect(q.modifiedFrom).toBe(want['modifiedFrom'] ?? null);
      expect(q.modifiedTo).toBe(want['modifiedTo'] ?? null);
      expect(q.kind).toBe(want['kind'] ?? null);
      expect(q.path).toBe(want['path'] ?? null);
    });
  }

  // the known folders are matched as whole paths: the cases with words only
  for (const c of cases.match.filter((m) => !/[:<>]/.test(m.query) && !('dir' in m))) {
    it(`matches ${c.query} on ${c.path.join('/')}`, () => {
      const q = parseQuery(c.query, now, tz);
      expect(matchesPath(q, c.path.join('/'))).toBe(c.hit);
    });
  }

  it('the action text after > and the plain words', () => {
    expect(parseQuery('>  copy files', now, tz).actionText).toBe('copy files');
    expect(parseQuery('copy ext:pdf -x', now, tz).plain).toBe('copy');
  });

  it('filters and file searches', () => {
    expect(hasFilter(parseQuery('invoice', now, tz))).toBe(false);
    expect(hasFilter(parseQuery('invoice ext:pdf', now, tz))).toBe(true);
    expect(searchesFiles(parseQuery('is:dir', now, tz))).toBe(false);
    expect(searchesFiles(parseQuery('size>1m', now, tz))).toBe(true);
    expect(searchesFiles(parseQuery('> copy', now, tz))).toBe(false);
  });

  it('helpers', () => {
    expect(fold('Ärger Über')).toBe('arger uber');
    expect(isPathLike('~')).toBe(true);
    expect(isPathLike('~marc')).toBe(false);
    expect(parseSize('1e9')).toBeNull();
    expect(parseSize('2k')).toBe(2048);
  });
});
