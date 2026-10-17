import { SearchHit } from '../../core/search/search.models';
import { fuzzyMatch } from '../actions/fuzzy';

/** Bonus for a match in the folder's own name (over one in the path above it). */
const NAME_BONUS = 20;

/**
 * Live filter of the folder finder (design 009 E6): unscharf (subsequence) on
 * the folder name, else on the full path; best first, ties in found order.
 * An empty filter keeps the found order.
 */
export function filterFolders(hits: readonly SearchHit[], query: string): readonly SearchHit[] {
  const q = query.trim();
  if (!q) {
    return hits;
  }
  const scored: { hit: SearchHit; score: number; i: number }[] = [];
  hits.forEach((hit, i) => {
    const byName = fuzzyMatch(q, hit.name);
    if (byName) {
      scored.push({ hit, score: byName.score + NAME_BONUS, i });
      return;
    }
    const byPath = fuzzyMatch(q, hit.path);
    if (byPath) {
      scored.push({ hit, score: byPath.score, i });
    }
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.hit);
}

/** New active row after a key (↑ ↓ PgUp PgDn Home End), clamped; -1 for an empty list. */
export function moveActive(index: number, key: string, count: number, page = 10): number {
  if (count === 0) {
    return -1;
  }
  const i = Math.max(0, index);
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, index + 1);
    case 'ArrowUp':
      return Math.max(0, i - 1);
    case 'PageDown':
      return Math.min(count - 1, i + page);
    case 'PageUp':
      return Math.max(0, i - page);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return Math.min(i, count - 1);
  }
}
