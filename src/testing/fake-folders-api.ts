import { FoldersApi } from '../app/core/folders/folders-api';
import { CleanOptions, CleanScan, CreatedFolders } from '../app/core/folders/folders.models';

const EMPTY_SCAN: CleanScan = {
  items: [],
  unreadable: [],
  unreadableMore: 0,
  truncated: false,
  visited: 0,
};

/**
 * In-memory FoldersApi: `scan` is the answer of `findEmptyDirs`, `existing`
 * names fail in `createFolders`. `hold` keeps scan answers pending until
 * `release()` (tests of stale answers).
 */
export class FakeFoldersApi extends FoldersApi {
  readonly scans: { roots: string[]; options: CleanOptions }[] = [];
  readonly creates: { parent: string; names: string[] }[] = [];
  scan: CleanScan = EMPTY_SCAN;
  existing = new Set<string>();
  hold = false;
  private held: (() => void)[] = [];

  findEmptyDirs(roots: readonly string[], options: CleanOptions): Promise<CleanScan> {
    this.scans.push({ roots: [...roots], options });
    const result = this.scan;
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
