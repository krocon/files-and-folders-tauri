import { DirEntry } from '../../core/fs/fs.models';
import { SearchHit } from '../../core/search/search.models';

/** Which file of a group stays unmarked (design 016 E6). */
export type KeepRule = 'newest' | 'oldest' | 'first';

function groupOf(e: DirEntry): number | undefined {
  return (e as SearchHit).group;
}

/** The rows of each group, in the given order. Rows without a group are left out. */
export function groupsOf(rows: readonly DirEntry[]): Map<number, DirEntry[]> {
  const groups = new Map<number, DirEntry[]>();
  for (const r of rows) {
    const g = groupOf(r);
    if (g === undefined) {
      continue;
    }
    const list = groups.get(g);
    if (list) {
      list.push(r);
    } else {
      groups.set(g, [r]);
    }
  }
  return groups;
}

/** Shortest path first, then by path (stable, independent of the table's sort). */
function byPath(a: DirEntry, b: DirEntry): number {
  return a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function kept(group: readonly DirEntry[], rule: KeepRule): DirEntry {
  const sorted = [...group].sort(byPath);
  if (rule === 'first') {
    return sorted[0];
  }
  // unknown times count as the oldest; ties keep the "first" one
  const time = (e: DirEntry) => e.modifiedMs ?? Number.NEGATIVE_INFINITY;
  let best = sorted[0];
  for (const e of sorted.slice(1)) {
    if (rule === 'newest' ? time(e) > time(best) : time(e) < time(best)) {
      best = e;
    }
  }
  return best;
}

/**
 * Paths to mark: every file of each group except the one `rule` keeps – one
 * file per group always stays unmarked. Groups with a single row left (the
 * others deleted or filtered) are not touched.
 */
export function marksKeepingOne(rows: readonly DirEntry[], rule: KeepRule): string[] {
  const out: string[] = [];
  for (const group of groupsOf(rows).values()) {
    if (group.length < 2) {
      continue;
    }
    const keep = kept(group, rule);
    for (const e of group) {
      if (e !== keep) {
        out.push(e.path);
      }
    }
  }
  return out;
}

/** Groups of which every row is in `paths` – deleting them would lose every copy. */
export function wholeGroups(rows: readonly DirEntry[], paths: ReadonlySet<string>): number {
  let n = 0;
  for (const group of groupsOf(rows).values()) {
    if (group.every((e) => paths.has(e.path))) {
      n++;
    }
  }
  return n;
}

/** Groups, files and the bytes that copies take beyond one file per group. */
export function duplicateSummary(rows: readonly DirEntry[]): {
  groups: number;
  files: number;
  redundant: number;
} {
  let groups = 0;
  let files = 0;
  let redundant = 0;
  for (const group of groupsOf(rows).values()) {
    groups++;
    files += group.length;
    redundant += (group[0].size ?? 0) * (group.length - 1);
  }
  return { groups, files, redundant };
}
