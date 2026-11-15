import { describe, expect, it } from 'vitest';
import { assignMnemonics, baseLetter } from './mnemonic';

describe('assignMnemonics (076 E4)', () => {
  it('takes the first letter of each label', () => {
    expect(assignMnemonics(['Move to trash', 'Cancel'])).toEqual([
      { letter: 'M', index: 0 },
      { letter: 'C', index: 0 },
    ]);
  });

  it('falls back to the start of a word, then to any letter', () => {
    const [a, b, c] = assignMnemonics(['Save', 'Save as…', 'Settings']);
    expect(a).toEqual({ letter: 'S', index: 0 });
    expect(b).toEqual({ letter: 'A', index: 5 }); // "as"
    expect(c).toEqual({ letter: 'E', index: 1 });
  });

  it('skips leading spaces, icons and punctuation', () => {
    expect(assignMnemonics(['  ★ As favourite'])).toEqual([{ letter: 'A', index: 4 }]);
  });

  it('counts umlauts as their base letter (German labels)', () => {
    expect(assignMnemonics(['Überschreiben', 'Umbenennen'])).toEqual([
      { letter: 'U', index: 0 },
      { letter: 'M', index: 1 },
    ]);
    expect(baseLetter('ß')).toBeNull();
  });

  it('respects taken letters and gives null when nothing is left', () => {
    expect(assignMnemonics(['OK'], new Set(['O', 'K']))).toEqual([null]);
    expect(assignMnemonics(['…', ''])).toEqual([null, null]);
  });
});
