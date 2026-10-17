import { describe, expect, it } from 'vitest';
import { DEFAULT_MKDIR, folderNames, MAX_FOLDERS } from './mkdir-engine';

const P: [string, string, string] = ['Staffel', 'Serie', 'Videos'];

describe('multi-mkdir names (design 008 E4)', () => {
  it('counter with start, end, step and digits', () => {
    const out = folderNames(
      { ...DEFAULT_MKDIR, template: 'S[C]', start: 1, end: 9, step: 4, digits: 2 },
      P,
    );
    expect(out.names.map((n) => n.name)).toEqual(['S01', 'S05', 'S09']);
    expect(out.error).toBeNull();
  });

  it('letters, parents and case', () => {
    const out = folderNames(
      {
        ...DEFAULT_MKDIR,
        template: '[P] [L] [Q]-[R]',
        start: 0,
        end: 2,
        digits: 0,
        letterCase: 'upper',
      },
      P,
    );
    expect(out.names.map((n) => n.name)).toEqual([
      'STAFFEL A SERIE-VIDEOS',
      'STAFFEL B SERIE-VIDEOS',
      'STAFFEL C SERIE-VIDEOS',
    ]);
    const lower = folderNames(
      { ...DEFAULT_MKDIR, template: 'Ä[C]', end: 1, letterCase: 'lower' },
      P,
    );
    expect(lower.names[0].name).toBe('ä01');
  });

  it('marks invalid and duplicate names', () => {
    const out = folderNames({ ...DEFAULT_MKDIR, template: 'a/[C]', end: 2 }, P);
    expect(out.names.every((n) => n.error !== null)).toBe(true);
    const dup = folderNames({ ...DEFAULT_MKDIR, template: '[L]', start: 0, end: 26 }, P);
    expect(dup.names[26]).toEqual({ name: 'a', error: 'twice in the list' });
  });

  it('refuses broken counters and too many names', () => {
    expect(folderNames({ ...DEFAULT_MKDIR, step: 0 }, P).error).not.toBeNull();
    expect(folderNames({ ...DEFAULT_MKDIR, start: 5, end: 1 }, P).error).not.toBeNull();
    expect(folderNames({ ...DEFAULT_MKDIR, end: MAX_FOLDERS + 1 }, P).error).not.toBeNull();
    expect(folderNames({ ...DEFAULT_MKDIR, end: MAX_FOLDERS }, P).names).toHaveLength(MAX_FOLDERS);
    expect(folderNames({ ...DEFAULT_MKDIR, template: 'fix' }, P).error).not.toBeNull();
    expect(folderNames({ ...DEFAULT_MKDIR, template: 'fix', end: 1 }, P).names).toHaveLength(1);
  });
});
