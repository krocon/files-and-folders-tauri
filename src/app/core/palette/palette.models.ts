/**
 * DTOs of the universal palette (design 043). Keep in sync with `src-tauri/src/palette/mod.rs`.
 */
import { SearchHit } from '../search/search.models';

export type HitSource = 'index' | 'live' | 'system' | 'path';

/** A file or folder hit: a search hit (so all hits can become a result tab) plus its rank. */
export type PaletteHit = SearchHit & {
  readonly score: number;
  readonly source: HitSource;
  /** UTF-16 ranges `[start, end)` of the words in the name (highlighting). */
  readonly ranges: readonly (readonly [number, number])[];
};

/** The palette settings sent to Rust (from `palette.*`). */
export interface PaletteConfig {
  readonly index: boolean;
  readonly roots: readonly string[];
  readonly excludes: readonly string[];
  readonly maxMemoryMb: number;
  readonly includeHidden: boolean;
  readonly systemSearch: boolean;
}

export interface PaletteRequest {
  readonly text: string;
  /** Folders of the tabs, favourites – walked live, ranked up. */
  readonly places: readonly string[];
  /** Recently used folders, most recent first. */
  readonly recent: readonly string[];
  readonly limit: number;
  readonly tzOffsetMinutes: number;
  /** Not the palette's query (a result tab asks again): runs beside it, never cancelled by it. */
  readonly detached?: boolean;
}

export type IndexState = 'off' | 'waiting' | 'building' | 'ready';

export interface IndexStatus {
  readonly state: IndexState;
  readonly entries: number;
  readonly dirs: number;
  readonly bytes: number;
  readonly maxBytes: number;
  readonly truncated: boolean;
  readonly watching: boolean;
  readonly builtAtMs: number | null;
  readonly buildMs: number;
  readonly roots: readonly string[];
  readonly systemAvailable: boolean;
  /** Search folders and exclusions of the settings that were left out (not usable). */
  readonly problems: readonly string[];
}

export const NO_INDEX: IndexStatus = {
  state: 'off',
  entries: 0,
  dirs: 0,
  bytes: 0,
  maxBytes: 0,
  truncated: false,
  watching: false,
  builtAtMs: null,
  buildMs: 0,
  roots: [],
  systemAvailable: false,
  problems: [],
};

export interface QueryStats {
  /** Entries that matched in the index (may exceed the hits sent). */
  readonly matched: number;
  readonly sent: number;
  readonly scanned: number;
  readonly elapsedMs: number;
  readonly firstHitMs: number | null;
  readonly truncated: boolean;
  readonly liveExhausted: boolean;
  readonly index: IndexState;
  readonly stale: number;
}

export type PaletteEvent =
  | { readonly type: 'hits'; readonly id: number; readonly hits: readonly PaletteHit[] }
  | { readonly type: 'done'; readonly id: number; readonly stats: QueryStats };
