import { describeFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError, FsErrorCode, isParentRow } from '../../core/fs/fs.models';

/** What an operation needs to know about a panel. */
export interface SelectionSource {
  markedEntries(): readonly DirEntry[];
  cursorEntry(): DirEntry | null;
}

/**
 * The entries an operation works on (legacy `getRowsForAction`, design 006 E10):
 * the marked entries, otherwise the cursor entry – never "..".
 */
export function selectionForAction(panel: SelectionSource | undefined): readonly DirEntry[] {
  if (!panel) {
    return [];
  }
  const marked = panel.markedEntries().filter((e) => !isParentRow(e));
  if (marked.length > 0) {
    return marked;
  }
  const cursor = panel.cursorEntry();
  return cursor && !isParentRow(cursor) ? [cursor] : [];
}

const SERIES = /^([A-Za-z]{1,10})(\d{2,})$/;

/**
 * Suggestion for a new folder (design 006 E8): the next name of a series of at
 * least two siblings (`S01`, `S02` → `S03`, mr), otherwise the name of the
 * basis entry without its extension (legacy), otherwise empty.
 */
export function suggestFolderName(siblings: readonly string[], basis?: DirEntry | null): string {
  const series = new Map<string, { max: number; digits: number; count: number }>();
  for (const name of siblings) {
    const m = SERIES.exec(name);
    if (!m) {
      continue;
    }
    const key = m[1];
    const n = Number(m[2]);
    const s = series.get(key) ?? { max: -1, digits: 0, count: 0 };
    series.set(key, {
      max: Math.max(s.max, n),
      digits: Math.max(s.digits, m[2].length),
      count: s.count + 1,
    });
  }
  // the series of the basis entry wins, otherwise the longest one
  const basisKey = basis ? SERIES.exec(basis.name)?.[1] : undefined;
  let best: [string, { max: number; digits: number; count: number }] | undefined;
  for (const entry of series) {
    if (entry[1].count < 2) {
      continue;
    }
    if (entry[0] === basisKey) {
      best = entry;
      break;
    }
    if (!best || entry[1].count > best[1].count) {
      best = entry;
    }
  }
  if (best) {
    const [prefix, { max, digits }] = best;
    return prefix + String(max + 1).padStart(digits, '0');
  }
  if (basis && !isParentRow(basis)) {
    return basis.kind === 'directory' ? basis.name : basis.name.slice(0, stemLength(basis.name));
  }
  return '';
}

/**
 * Length of the name without its extension – the part selected when renaming
 * (`a.tar.gz` → `a.tar`, `.bashrc` → all, folders → all).
 */
export function stemLength(name: string, isDir = false): number {
  if (isDir) {
    return name.length;
  }
  const dot = name.lastIndexOf('.');
  return dot > 0 ? dot : name.length;
}

/**
 * Where the cursor goes when `removed` entries disappear: the next remaining
 * entry after the cursor, otherwise the one before it (Total Commander).
 */
export function cursorAfterRemoval(
  displayed: readonly DirEntry[],
  removed: ReadonlySet<string>,
  cursor: string | null,
): string | null {
  if (cursor === null || !removed.has(cursor)) {
    return cursor;
  }
  const index = displayed.findIndex((e) => e.path === cursor);
  if (index < 0) {
    return null;
  }
  for (let i = index + 1; i < displayed.length; i++) {
    if (!removed.has(displayed[i].path)) {
      return displayed[i].path;
    }
  }
  for (let i = index - 1; i >= 0; i--) {
    if (!removed.has(displayed[i].path)) {
      return displayed[i].path;
    }
  }
  return null;
}

/** A target folder offered in the copy/move dialog. */
export interface TargetOption {
  readonly path: string;
  /** Where it comes from: "Other panel", "Tab", "Favourite", "Recent". */
  readonly group: string;
}

/** Target suggestions without duplicates, in the order given (first group wins). */
export function targetOptions(
  groups: readonly { readonly group: string; readonly paths: readonly (string | null)[] }[],
  /** Paths that can never be a target (folders inside archives, review 016 #7). */
  exclude: (path: string) => boolean = () => false,
): readonly TargetOption[] {
  const seen = new Set<string>();
  const out: TargetOption[] = [];
  for (const g of groups) {
    for (const p of g.paths) {
      if (p !== null && p !== '' && !seen.has(p) && !exclude(p)) {
        seen.add(p);
        out.push({ path: p, group: g.group });
      }
    }
  }
  return out;
}

/** Codes whose message is the operating system's text: the general description comes first. */
const OS_CODES: ReadonlySet<FsErrorCode> = new Set<FsErrorCode>([
  'not_found',
  'permission_denied',
  'not_a_directory',
  'disk_full',
  'io',
  'unknown',
]);

/** The error line of an operation dialog (our own messages are written for the user already). */
export function dialogError(e: FsError): string {
  return OS_CODES.has(e.code) ? `${describeFsError(e)} (${e.message})` : e.message;
}

/**
 * Names that several sources share (review 009 #5: hits of a search come from
 * different folders). Compared without case – the target may not tell them
 * apart. Returns the first spelling of each.
 */
export function sameNames(entries: readonly DirEntry[]): string[] {
  const seen = new Map<string, { name: string; n: number }>();
  for (const e of entries) {
    const key = e.name.toLocaleLowerCase();
    const s = seen.get(key);
    if (s) {
      s.n++;
    } else {
      seen.set(key, { name: e.name, n: 1 });
    }
  }
  return [...seen.values()].filter((s) => s.n > 1).map((s) => s.name);
}
