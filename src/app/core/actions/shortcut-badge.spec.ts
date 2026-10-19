import { describe, expect, it } from 'vitest';
import { badgeStrokes } from './shortcut-badge';

describe('shortcut badges (design 020 E2, mr §1.10)', () => {
  it('macOS: Mod is ⌘, Ctrl is ^, alt stays a word, Shift is ⇧, keys in lower case', () => {
    expect(badgeStrokes('Mod+Ctrl+G', 'macos')).toEqual([['^', '⌘', 'g']]);
    expect(badgeStrokes('Mod+Alt+Shift+H', 'macos')).toEqual([['⌘', 'alt', '⇧', 'h']]);
    expect(badgeStrokes('F5', 'macos')).toEqual([['f5']]);
  });

  it('Windows/Linux: Mod is ^', () => {
    expect(badgeStrokes('Mod+Shift+F', 'windows')).toEqual([['^', '⇧', 'f']]);
    expect(badgeStrokes('Ctrl+Alt+D', 'linux')).toEqual([['^', 'alt', 'd']]);
  });

  it('a chord becomes two badges', () => {
    expect(badgeStrokes('Ctrl+K Ctrl+C', 'macos')).toEqual([
      ['^', 'k'],
      ['^', 'c'],
    ]);
    expect(badgeStrokes('Ctrl+K F6', 'macos')).toEqual([['^', 'k'], ['f6']]);
  });

  it('special keys as short words or symbols', () => {
    expect(badgeStrokes('Space', 'linux')).toEqual([['space']]);
    expect(badgeStrokes('Mod+Alt+ArrowDown', 'macos')).toEqual([['⌘', 'alt', 'down']]);
    expect(badgeStrokes('NumpadAdd', 'linux')).toEqual([['+']]);
    expect(badgeStrokes('Mod+NumpadSubtract', 'linux')).toEqual([['^', '-']]);
    expect(badgeStrokes('Tab', 'macos')).toEqual([['tab']]);
  });

  it('empty or invalid gives no badge', () => {
    expect(badgeStrokes('', 'macos')).toEqual([]);
    expect(badgeStrokes(null, 'macos')).toEqual([]);
    expect(badgeStrokes('Mod+Nope+', 'macos')).toEqual([]);
  });
});
