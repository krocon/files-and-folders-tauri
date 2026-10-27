import { PaletteApi } from '../app/core/palette/palette-api';
import {
  IndexStatus,
  NO_INDEX,
  PaletteConfig,
  PaletteEvent,
  PaletteHit,
  PaletteRequest,
  QueryStats,
} from '../app/core/palette/palette.models';

/** A hit as Rust sends it (`dir` is the folder, the path its child – fixtures only). */
export function paletteHit(dir: string, name: string, patch: Partial<PaletteHit> = {}): PaletteHit {
  const directory = patch.kind === 'directory';
  return {
    name,
    path: `${dir}/${name}`,
    kind: 'file',
    targetKind: null,
    size: directory ? null : 1234,
    modifiedMs: 1_700_000_000_000,
    hidden: false,
    lossyName: false,
    dir,
    relDir: '',
    parentNames: [dir.slice(dir.lastIndexOf('/') + 1), '', ''],
    score: 100,
    source: 'index',
    ranges: [],
    ...patch,
  };
}

export const DONE_STATS: QueryStats = {
  matched: 0,
  sent: 0,
  scanned: 0,
  elapsedMs: 1,
  firstHitMs: null,
  truncated: false,
  liveExhausted: false,
  index: 'ready',
  stale: 0,
};

/** Records configurations and queries; tests send the events of a query with `emit`. */
export class FakePaletteApi extends PaletteApi {
  readonly configs: PaletteConfig[] = [];
  readonly queries: { request: PaletteRequest; emit: (e: PaletteEvent) => void; id: number }[] = [];
  cancels = 0;
  readonly cancelled: (number | null)[] = [];
  status_: IndexStatus = { ...NO_INDEX, state: 'ready', entries: 42, roots: ['/home/u'] };
  private nextId = 1;

  configure(config: PaletteConfig): Promise<IndexStatus> {
    this.configs.push(config);
    return Promise.resolve(this.status_);
  }

  status(): Promise<IndexStatus> {
    return Promise.resolve(this.status_);
  }

  query(request: PaletteRequest, onEvent: (e: PaletteEvent) => void): Promise<number> {
    const id = this.nextId++;
    this.queries.push({ request, emit: onEvent, id });
    return Promise.resolve(id);
  }

  cancel(id: number | null): Promise<void> {
    this.cancels++;
    this.cancelled.push(id);
    return Promise.resolve();
  }

  rebuild(): Promise<IndexStatus> {
    return Promise.resolve({ ...this.status_, state: 'building' });
  }

  clear(): Promise<IndexStatus> {
    return Promise.resolve({ ...this.status_, state: 'waiting', entries: 0 });
  }

  /** The newest query. */
  last(): { request: PaletteRequest; emit: (e: PaletteEvent) => void; id: number } {
    const q = this.queries.at(-1);
    if (!q) {
      throw new Error('no query');
    }
    return q;
  }

  /** Sends hits and the end of the newest query. */
  answer(hits: readonly PaletteHit[], stats: Partial<QueryStats> = {}): void {
    const q = this.last();
    if (hits.length) {
      q.emit({ type: 'hits', id: q.id, hits });
    }
    q.emit({ type: 'done', id: q.id, stats: { ...DONE_STATS, sent: hits.length, ...stats } });
  }
}
