import { FoldersApi } from '../app/core/folders/folders-api';
import {
  CleanOptions,
  CleanScan,
  CollectOptions,
  CreatedFolders,
  FileTree,
} from '../app/core/folders/folders.models';

const EMPTY_SCAN: CleanScan = {
  items: [],
  unreadable: [],
  unreadableMore: 0,
  truncated: false,
  cancelled: false,
  visited: 0,
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
