/**
 * Failed thumbnail loads per URL – taken from Comic Commander (`TileRetries`, design 003/004,
 * MIT, same author) for the image overview (review 074 #4): a tile dropped by the full pool
 * (503) or a sleeping drive is asked for again after a pause, [TILE_RETRIES] times; after that
 * the tile shows its placeholder. A changed image has a new URL (`?v=<mtime>`). Pure – timers
 * are injected.
 */
export const TILE_RETRIES = 2;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class TileRetries {
  private readonly failures = new Map<string, number>();
  private readonly waiting = new Set<string>();
  private readonly pending = new Set<unknown>();

  /** `onChange`: a cover may be asked for again – the grid repaints. */
  constructor(
    private readonly retryMs: number,
    private readonly onChange: () => void,
    private readonly timers: Timers = realTimers,
  ) {}

  /** `src` for `url`, `null` = show the format. */
  src(url: string): string | null {
    if (this.waiting.has(url)) return null;
    const failed = this.failures.get(url) ?? 0;
    if (failed > TILE_RETRIES) return null;
    return failed ? `${url}${url.includes('?') ? '&' : '?'}retry=${failed}` : url;
  }

  failed(url: string): void {
    if (this.waiting.has(url)) return;
    const failed = (this.failures.get(url) ?? 0) + 1;
    this.failures.set(url, failed);
    if (failed > TILE_RETRIES) return;
    this.waiting.add(url);
    const handle = this.timers.set(() => {
      this.pending.delete(handle);
      this.waiting.delete(url);
      this.onChange();
    }, this.retryMs * failed);
    this.pending.add(handle);
  }

  /** The cover exists now (batch job, design 007 E6): a fresh chance at once. */
  forget(url: string): boolean {
    const known = this.failures.delete(url);
    this.waiting.delete(url);
    return known;
  }

  dispose(): void {
    this.pending.forEach((h) => this.timers.clear(h));
    this.pending.clear();
  }
}
