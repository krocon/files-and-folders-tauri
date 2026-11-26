import { FoldersApi } from '../app/core/folders/folders-api';
import {
  CleanItem,
  CleanOptions,
  CleanScan,
  CollectOptions,
  CreatedFolders,
  FileTree,
  RootVerdict,
} from '../app/core/folders/folders.models';

/** A verdict as Rust sends it: `keep` without anything, unless `over` says otherwise. */
export function rootVerdict(path: string, over: Partial<RootVerdict> = {}): RootVerdict {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    verdict: 'keep',
    first: 0,
    count: 0,
    removeDirs: 0,
    removeFiles: 0,
    removeBytes: 0,
    keepFiles: 0,
    keepBytes: 0,
    keepExtensions: [],
    keepSample: [],
    tooLarge: 0,
    sampleTooLarge: 0,
    hidden: 0,
    links: 0,
    blocked: 0,
    junkKept: 0,
    danger: null,
    linked: false,
    incomplete: false,
    ...over,
  };
}

/**
 * A scan of `roots`, each with its own entries: `first`/`count` and the numbers are
 * derived (a root with entries is a `partial` unless its verdict is given).
 */
export function cleanScan(
  roots: readonly { path: string; items?: readonly CleanItem[]; over?: Partial<RootVerdict> }[],
  over: Partial<CleanScan> = {},
): CleanScan {
  const items: CleanItem[] = [];
  const verdicts = roots.map((r) => {
    const own = r.items ?? [];
    const first = items.length;
    items.push(...own);
    const dirs = own.filter((i) => i.kind === 'dir');
    return rootVerdict(r.path, {
      verdict: own.length > 0 ? 'partial' : 'keep',
      first,
      count: own.length,
      removeDirs: dirs.length,
      removeFiles: own.length - dirs.length + dirs.reduce((n, i) => n + (i.junk ?? 0), 0),
      removeBytes: own.reduce((n, i) => n + (i.bytes ?? 0), 0),
      ...r.over,
    });
  });
  return {
    items,
    roots: verdicts,
    unreadable: [],
    unreadableMore: 0,
    truncated: false,
    cancelled: false,
    visited: items.length,
    childRoots: false,
    ...over,
  };
}

const EMPTY_SCAN: CleanScan = {
  items: [],
  roots: [],
  unreadable: [],
  unreadableMore: 0,
  truncated: false,
  cancelled: false,
  visited: 0,
  childRoots: false,
};

export const EMPTY_TREE: FileTree = {
  files: [],
  unreadable: [],
  unreadableMore: 0,
  truncated: false,
  cancelled: false,
  visited: 0,
};

/**
 * In-memory FoldersApi: `scan` is the answer of `findEmptyDirs`, `tree` the one of
 * `collectFiles`, `existing` names fail in `createFolders`. `hold` keeps scan and
 * collect answers pending until `release()` (tests of stale answers).
 */
export class FakeFoldersApi extends FoldersApi {
  readonly scans: { scanId: string; roots: string[]; options: CleanOptions }[] = [];
  readonly cancels: string[] = [];
  readonly creates: { parent: string; names: string[] }[] = [];
  readonly collects: { scanId: string; root: string; options: CollectOptions }[] = [];
  scan: CleanScan = EMPTY_SCAN;
  tree: FileTree = EMPTY_TREE;
  /** Answers per root (else `tree`). */
  trees = new Map<string, FileTree>();
  /** Set: `collectFiles` rejects with it. */
  collectError: unknown = null;
  existing = new Set<string>();
  hold = false;
  private held: (() => void)[] = [];

  findEmptyDirs(
    scanId: string,
    roots: readonly string[],
    options: CleanOptions,
  ): Promise<CleanScan> {
    this.scans.push({ scanId, roots: [...roots], options });
    const result = this.scan;
    if (!this.hold) {
      return Promise.resolve(result);
    }
    return new Promise((resolve) => this.held.push(() => resolve(result)));
  }

  collectFiles(scanId: string, root: string, options: CollectOptions): Promise<FileTree> {
    this.collects.push({ scanId, root, options });
    if (this.collectError !== null) {
      return Promise.reject(this.collectError);
    }
    const result = this.trees.get(root) ?? this.tree;
    if (!this.hold) {
      return Promise.resolve(result);
    }
    return new Promise((resolve) => this.held.push(() => resolve(result)));
  }

  release(order: 'fifo' | 'lifo' = 'fifo'): void {
    const list = order === 'fifo' ? this.held : [...this.held].reverse();
    this.held = [];
    list.forEach((f) => f());
  }

  cancelScan(scanId: string): Promise<void> {
    this.cancels.push(scanId);
    return Promise.resolve();
  }

  createFolders(parent: string, names: readonly string[]): Promise<CreatedFolders> {
    this.creates.push({ parent, names: [...names] });
    const created: string[] = [];
    const errors: {
      name: string;
      error: { code: 'already_exists'; message: string; path: null };
    }[] = [];
    for (const n of names) {
      if (this.existing.has(n)) {
        errors.push({ name: n, error: { code: 'already_exists', message: 'exists', path: null } });
      } else {
        this.existing.add(n);
        created.push(`${parent}/${n}`);
      }
    }
    return Promise.resolve({ created, errors });
  }
}
