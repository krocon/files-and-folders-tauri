import { fuzzyMatch } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches subsequences case-insensitively', () => {
    expect(fuzzyMatch('mkd', 'Create folder…')).toBeNull();
    expect(fuzzyMatch('crf', 'Create folder…')?.positions).toEqual([0, 1, 7]);
    expect(fuzzyMatch('', 'anything')?.score).toBe(0);
  });

  it('prefers word starts and consecutive characters', () => {
    const a = fuzzyMatch('copy', 'Copy…')!.score;
    const b = fuzzyMatch('copy', 'Copy names to clipboard')!.score;
    const c = fuzzyMatch('copy', 'Create several folders…');
    expect(a).toBeGreaterThan(fuzzyMatch('cpy', 'Copy…')!.score);
    expect(a).toBeGreaterThanOrEqual(b);
    expect(c).toBeNull();
  });
});
