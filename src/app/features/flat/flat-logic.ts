import { MAX_HITS, SearchCriteria, SearchHit } from '../../core/search/search.models';
import { isSameOrBelow } from '../../shared/path-prefix';
import { DirEntry } from '../../core/fs/fs.models';

/** What the flat view of a folder lists (design 038 E2/E4). */
export interface FlatOptions {
  /** Hidden entries are listed and hidden folders entered (the tab's Hidden toggle). */
  readonly includeHidden: boolean;
  /** "Show folders": folders are rows too (they are always entered). */
  readonly showDirs: boolean;
}

/**
 * The search the flat view runs: every name below `root`, links as entries that are
 * never entered (a link cycle cannot loop), at most {@link MAX_HITS} rows.
 */
export function flatCriteria(root: string, o: FlatOptions): SearchCriteria {
  return {
    roots: [root],
    name: '',
    nameMode: 'glob',
    caseSensitive: false,
    wholeName: true,
    kinds: { files: true, dirs: o.showDirs, links: true },
    includeHidden: o.includeHidden,
    followLinks: false,
    maxDepth: null,
    excludes: [],
    maxHits: MAX_HITS,
    skipVirtualFs: true,
  };
}

/** The options a flat result was listed with (read back from its criteria). */
export function flatOptionsOf(c: SearchCriteria): FlatOptions {
  return { includeHidden: c.includeHidden, showDirs: c.kinds.dirs };
}

/** Folder of a row relative to the flat view's root (`SearchHit.relDir`), "" in the root. */
export function relDirOf(entry: DirEntry): string {
  return (entry as Partial<SearchHit>).relDir ?? '';
}

/**
 * A job changed folders `changed`: the flat view of `root` lists them when one is
 * the root or lies below it (design 038 E5). A change above the root (the root
 * itself moved or deleted) counts too – the listing must notice it is gone.
 */
export function shouldRefresh(root: string, changed: readonly string[]): boolean {
  return changed.some((d) => isSameOrBelow(d, root) || isSameOrBelow(root, d));
}
