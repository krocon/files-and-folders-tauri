export interface FuzzyMatch {
  readonly score: number;
  /** Indices of the matched characters in the text (for highlighting). */
  readonly positions: readonly number[];
}

/**
 * Subsequence match, case-insensitive: every character of the query must
 * appear in order. Higher score for consecutive characters, word starts and an
 * early first match. `null` = no match; empty query matches everything with 0.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) {
    return { score: 0, positions: [] };
  }
  const t = text.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let from = 0;
  for (const ch of q) {
    if (ch === ' ') {
      continue;
    }
    const i = t.indexOf(ch, from);
    if (i < 0) {
      return null;
    }
    const prev = positions.at(-1);
    if (prev !== undefined && i === prev + 1) {
      score += 5;
    }
    if (i === 0 || /[\s\-_/(]/.test(t[i - 1])) {
      score += 3;
    }
    score += 1;
    positions.push(i);
    from = i + 1;
  }
  score -= positions[0] * 0.1;
  return { score, positions };
}
