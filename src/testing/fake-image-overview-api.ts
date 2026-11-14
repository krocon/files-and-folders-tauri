import { ImageOverviewApi } from '../app/core/imageoverview/image-overview-api';
import { OverviewEvent, OverviewItem } from '../app/core/imageoverview/image-overview.models';

/** One `open` call the test can answer with events. */
export interface FakeOverview {
  readonly id: string;
  readonly root: string;
  readonly recursive: boolean;
  readonly emit: (e: OverviewEvent) => void;
}

/** In-memory ImageOverviewApi: records opens/closes, the test sends the events. */
export class FakeImageOverviewApi extends ImageOverviewApi {
  readonly opened: FakeOverview[] = [];
  readonly closed: string[] = [];
  /** When set, `open` rejects with it. */
  failOpen: unknown = null;
  private n = 0;

  open(root: string, recursive: boolean, onEvent: (e: OverviewEvent) => void): Promise<string> {
    if (this.failOpen) {
      return Promise.reject(this.failOpen);
    }
    this.n += 1;
    const id = `ov${this.n}`;
    this.opened.push({ id, root, recursive, emit: onEvent });
    return Promise.resolve(id);
  }

  close(id: string): Promise<void> {
    this.closed.push(id);
    return Promise.resolve();
  }

  thumbUrl(id: string, index: number, step: number, version: number | null): string {
    return `fnfthumb://localhost/${id}.${index}.${step}?v=${version ?? 0}`;
  }

  /** The last `open`. */
  last(): FakeOverview {
    const o = this.opened.at(-1);
    if (!o) {
      throw new Error('no overview opened');
    }
    return o;
  }

  /** Sends `items` and the end to the last overview. */
  deliver(items: readonly OverviewItem[], truncated = false): void {
    const o = this.last();
    o.emit({ kind: 'items', items });
    o.emit({ kind: 'done', truncated, unreadable: [], unreadableMore: 0 });
  }
}

/** An image item for tests (`/fotos/<name>` unless `dir` is given). */
export function overviewItem(
  index: number,
  name: string,
  extra: Partial<OverviewItem> = {},
): OverviewItem {
  const dir = extra.dir ?? '/fotos';
  return {
    index,
    path: `${dir}/${name}`,
    name,
    size: 1000 + index,
    modifiedMs: 1_700_000_000_000 + index * 1000,
    rel: name,
    dir,
    kind: 'image',
    ...extra,
  };
}
