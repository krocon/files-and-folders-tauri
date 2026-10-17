import { describe, expect, it } from 'vitest';
import { THEME_TEXTS } from './theme-texts';

describe('theme texts', () => {
  it('rounds a contrast ratio down, so a failing value never reads as the minimum (review 013 #6)', () => {
    expect(THEME_TEXTS.ratio('Cursor', 4.48, 4.5)).toBe('Cursor: 4.4:1 (min. 4.5:1)');
    expect(THEME_TEXTS.ratio('Focus', 2.96, 3)).toBe('Focus: 2.9:1 (min. 3:1)');
    expect(THEME_TEXTS.ratio('List', 21, 4.5)).toBe('List: 21.0:1 (min. 4.5:1)');
  });
});
