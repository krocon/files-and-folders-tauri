/**
 * Underlined letters of dialog buttons (design 076 E4): `Alt+<letter>` (⌥ on macOS),
 * chosen from the label in the current language. Pure.
 */

export interface Mnemonic {
  /** `A`–`Z`: what Alt+key must give (umlauts and accents count as their base letter). */
  readonly letter: string;
  /** Index of the underlined character in the label (UTF-16). */
  readonly index: number;
}

/** Base letter `A`–`Z` of one character, `null` for anything else. */
export function baseLetter(ch: string): string | null {
  const base = ch.normalize('NFD').charAt(0).toUpperCase();
  return /^[A-Z]$/.test(base) ? base : null;
}

/** Positions to try, best first: first letter, starts of words, every other letter. */
function candidates(label: string): number[] {
  const first: number[] = [];
  const words: number[] = [];
  const rest: number[] = [];
  let atWordStart = true;
  for (let i = 0; i < label.length; i++) {
    const ch = label[i];
    if (baseLetter(ch) === null) {
      atWordStart = !/[\p{L}\p{N}]/u.test(ch);
      continue;
    }
    const isFirst = first.length === 0 && words.length === 0 && rest.length === 0;
    (isFirst ? first : atWordStart ? words : rest).push(i);
    atWordStart = false;
  }
  return [...first, ...words, ...rest];
}

/**
 * One letter per label, in the given order (the caller puts the main button and
 * Cancel first), no letter twice and none from `taken`. `null` if a label has no
 * free letter left.
 */
export function assignMnemonics(
  labels: readonly string[],
  taken: ReadonlySet<string> = new Set(),
): (Mnemonic | null)[] {
  const used = new Set(taken);
  return labels.map((label) => {
    for (const index of candidates(label)) {
      const letter = baseLetter(label[index])!;
      if (!used.has(letter)) {
        used.add(letter);
        return { letter, index };
      }
    }
    return null;
  });
}
