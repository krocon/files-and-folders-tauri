import { DirEntry, isParentRow } from '../../core/fs/fs.models';

/** Times within this distance count as equal (FAT/SMB store 2 s steps, design 036 E1). */
export const QUICK_TOLERANCE_MS = 2000;

export interface QuickCompareResult {
  /** Paths to mark on the left / right side. */
  readonly left: readonly string[];
  readonly right: readonly string[];
}

/** Pairing key of a name: NFC, without case if `ignoreCase` (design 036 E1/E7). */
export function nameKey(name: string, ignoreCase: boolean): string {
  const n = name.normalize('NFC');
  return ignoreCase ? n.toLowerCase() : n;
}

/**
 * Keys of the entries of one side: names that collide under the case-free key (on
 * either side) are paired exactly – `a` and `A` on Linux are two files.
 */
function keyed(
  entries: readonly DirEntry[],
  ignoreCase: boolean,
  colliding: ReadonlySet<string>,
): Map<string, DirEntry> {
  const map = new Map<string, DirEntry>();
  for (const e of entries) {
    const folded = nameKey(e.name, ignoreCase);
    map.set(colliding.has(folded) ? `${folded}\u0000${e.name.normalize('NFC')}` : folded, e);
  }
  return map;
}

function collisions(entries: readonly DirEntry[], ignoreCase: boolean, into: Set<string>): void {
  if (!ignoreCase) {
    return;
  }
  const seen = new Set<string>();
  for (const e of entries) {
    const k = nameKey(e.name, true);
    if (seen.has(k)) {
      into.add(k);
    }
    seen.add(k);
  }
}

const isDir = (e: DirEntry) => e.kind === 'directory';

/**
 * Total Commander's "Compare directories" (Shift+F2) on the top level of both listings:
 * marks what is missing on the other side and the newer of two files; two files of the
 * same time but another size are both marked. Folders only count when missing.
 */
export function quickCompare(
  leftEntries: readonly DirEntry[],
  rightEntries: readonly DirEntry[],
  ignoreCase: boolean,
  toleranceMs = QUICK_TOLERANCE_MS,
): QuickCompareResult {
  const l = leftEntries.filter((e) => !isParentRow(e));
  const r = rightEntries.filter((e) => !isParentRow(e));
  const colliding = new Set<string>();
  collisions(l, ignoreCase, colliding);
  collisions(r, ignoreCase, colliding);
  const lm = keyed(l, ignoreCase, colliding);
  const rm = keyed(r, ignoreCase, colliding);
  const left: string[] = [];
  const right: string[] = [];
  for (const [k, a] of lm) {
    const b = rm.get(k);
    if (!b) {
      left.push(a.path);
      continue;
    }
    if (isDir(a) || isDir(b)) {
      if (isDir(a) !== isDir(b)) {
        // a file against a folder: both differ
        left.push(a.path);
        right.push(b.path);
      }
      continue;
    }
    const d = (a.modifiedMs ?? 0) - (b.modifiedMs ?? 0);
    if (Math.abs(d) <= toleranceMs) {
      if (a.size !== b.size) {
        left.push(a.path);
        right.push(b.path);
      }
    } else if (d > 0) {
      left.push(a.path);
    } else {
      right.push(b.path);
    }
  }
  for (const [k, b] of rm) {
    if (!lm.has(k)) {
      right.push(b.path);
    }
  }
  return { left, right };
}
