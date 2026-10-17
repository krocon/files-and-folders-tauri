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
  return score(hits, q, 0).map((s) => s.hit);
}

interface Scored {
  readonly hit: SearchHit;
  readonly score: number;
  readonly i: number;
}

const byScore = (a: Scored, b: Scored) => b.score - a.score || a.i - b.i;

/** Scores `hits` (found order from `offset`), best first. */
function score(hits: readonly SearchHit[], q: string, offset: number): Scored[] {
  const scored: Scored[] = [];
  for (let k = offset; k < hits.length; k++) {
    const hit = hits[k];
    const byName = fuzzyMatch(q, hit.name);
    if (byName) {
      scored.push({ hit, score: byName.score + NAME_BONUS, i: k });
      continue;
    }
    const byPath = fuzzyMatch(q, hit.path);
    if (byPath) {
      scored.push({ hit, score: byPath.score, i: k });
    }
  }
  return scored.sort(byScore);
}

/** Merges two lists sorted by {@link byScore}. */
function merge(a: readonly Scored[], b: readonly Scored[]): Scored[] {
  const out: Scored[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    out.push(byScore(a[i], b[j]) <= 0 ? a[i++] : b[j++]);
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}

/**
 * {@link filterFolders} for a list that only grows (review 009 #8): while the
 * filter text and the list stay the same, only the new hits are scored and
 * merged in. A new list (another search) or a new text filters everything.
 * Always returns a new array (the table takes rows by reference).
 */
export class FolderFilter {
  private source: readonly SearchHit[] | null = null;
  private query = '';
  private count = 0;
  private scored: Scored[] = [];

  apply(hits: readonly SearchHit[], query: string): readonly SearchHit[] {
    const q = query.trim();
    const same = hits === this.source && q === this.query && hits.length >= this.count;
    if (!q) {
      this.remember(hits, q, []);
      return hits.slice();
    }
    const scored = same ? merge(this.scored, score(hits, q, this.count)) : score(hits, q, 0);
    this.remember(hits, q, scored);
    return scored.map((s) => s.hit);
  }

  private remember(hits: readonly SearchHit[], q: string, scored: Scored[]): void {
    this.source = hits;
    this.query = q;
    this.count = hits.length;
    this.scored = scored;
  }
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
