import { FsError } from '../app/core/fs/fs.models';
import { RenameApi } from '../app/core/rename/rename-api';
import {
  EMPTY_PRESETS,
  LoadedPresets,
  PlanRow,
  RenameItem,
  RenamePlan,
  RenamePresets,
} from '../app/core/rename/rename.models';

/**
 * In-memory RenameApi. `plan` checks like a tiny Rust: unchanged if the new
 * name equals the last path segment (test paths use `/`), duplicates of
 * `newName`, and `existing` names count as taken. `hold` keeps plan answers
 * pending until `release()` (tests of stale answers).
 */
export class FakeRenameApi extends RenameApi {
  readonly plans: RenameItem[][] = [];
  readonly undos: (string | null)[] = [];
  readonly saved: RenamePresets[] = [];
  existing = new Set<string>();
  loaded: LoadedPresets = { presets: EMPTY_PRESETS, warning: null };
  undoResult: string | FsError = 'j-undo';
  hold = false;
  private held: (() => void)[] = [];

  plan(items: readonly RenameItem[]): Promise<RenamePlan> {
    this.plans.push([...items]);
    const result = fakePlan(items, this.existing);
    if (!this.hold) {
      return Promise.resolve(result);
    }
    return new Promise((resolve) => this.held.push(() => resolve(result)));
  }

  /** Answers the held plan requests in the given order (default: oldest first). */
  release(order: 'fifo' | 'lifo' = 'fifo'): void {
    const list = order === 'fifo' ? this.held : [...this.held].reverse();
    this.held = [];
    list.forEach((r) => r());
  }

  undo(jobId: string | null): Promise<string> {
    this.undos.push(jobId);
    return typeof this.undoResult === 'string'
      ? Promise.resolve(this.undoResult)
      : Promise.reject(this.undoResult);
  }

  loadPresets(): Promise<LoadedPresets> {
    return Promise.resolve(structuredClone(this.loaded));
  }

  savePresets(presets: RenamePresets): Promise<void> {
    this.saved.push(structuredClone(presets));
    this.loaded = { presets: structuredClone(presets), warning: null };
    return Promise.resolve();
  }
}

function fakePlan(items: readonly RenameItem[], existing: ReadonlySet<string>): RenamePlan {
  const count = new Map<string, number>();
  for (const i of items) {
    count.set(i.newName, (count.get(i.newName) ?? 0) + 1);
  }
  const olds = new Set(items.map((i) => i.path.split('/').pop()));
  const rows: PlanRow[] = items.map((i) => {
    const old = i.path.split('/').pop();
    if ((count.get(i.newName) ?? 0) > 1) {
      return {
        status: 'error',
        error: {
          code: 'duplicate_target',
          message: 'Another selected entry gets the same name',
          path: i.path,
        },
      };
    }
    if (i.newName === old) {
      return { status: 'unchanged', error: null };
    }
    if (existing.has(i.newName) && !olds.has(i.newName)) {
      return {
        status: 'error',
        error: { code: 'already_exists', message: 'exists', path: i.path },
      };
    }
    return { status: 'ok', error: null };
  });
  return {
    rows,
    ok: rows.filter((r) => r.status === 'ok').length,
    unchanged: rows.filter((r) => r.status === 'unchanged').length,
    errors: rows.filter((r) => r.status === 'error').length,
  };
}
