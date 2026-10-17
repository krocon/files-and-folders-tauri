import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { toFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { ItemError } from '../../core/jobs/jobs.models';
import { Side } from '../../core/session/session.models';
import {
  EMPTY_STATS,
  SearchCriteria,
  SearchHit,
  SearchStats,
} from '../../core/search/search.models';
import { WorkspaceStore } from '../workspace/workspace.store';
import type { FindForm } from './find-form';

/** Hits are shown at most this often while a search runs (`setRows` + sort of up to 100 000 rows). */
export const PUBLISH_MS = 300;
export const MAX_RECENT_SEARCHES = 10;

/** The result of one search, shown by one or more result tabs. */
export interface SearchResult {
  readonly key: string;
  readonly criteria: SearchCriteria;
  readonly label: string;
  /** Hits shown so far (published throttled while running). */
  readonly hits: readonly SearchHit[];
  readonly running: boolean;
  readonly stats: SearchStats;
  /** Unreadable folders (first 1 000; `stats.unreadable` has the count). */
  readonly unreadable: readonly ItemError[];
  /** The search could not start or failed (invalid pattern, missing folder …). */
  readonly error: FsError | null;
  readonly cancelled: boolean;
  /** The dialog fields it came from (to change the search), null for searches without a dialog. */
  readonly form: FindForm | null;
}

export interface SearchTemplate {
  readonly label: string;
  readonly form: FindForm;
}

interface Run {
  readonly jobId: string;
  readonly all: SearchHit[];
  stats: SearchStats;
  timer: ReturnType<typeof setTimeout> | null;
  unsubscribe: () => void;
}

let keySeq = 0;

export function searchLabel(c: SearchCriteria): string {
  const name = c.name.trim();
  const text = c.content?.text ? ` ∋ "${c.content.text}"` : '';
  return `${name || '*'}${text}`;
}

/**
 * Searches and their results (root, design 009 E1/E4). A search is a `search`
 * job; its hits arrive in batches and are published to the result at most every
 * {@link PUBLISH_MS}. A new search for the same result cancels the old job, and
 * hits of other job ids never reach a result. Results no tab shows are released.
 */
@Injectable({ providedIn: 'root' })
export class SearchStore {
  private readonly jobs = inject(JobsStore);
  private readonly ws = inject(WorkspaceStore);
  private readonly runs = new Map<string, Run>();
  /** Results whose tab is about to open – not released meanwhile. */
  private readonly fresh = new Set<string>();

  readonly results = signal<ReadonlyMap<string, SearchResult>>(new Map());
  /** Last searches (dialog fields), newest first (session only, design 009 E5). */
  readonly recent = signal<readonly FindForm[]>([]);
  /** Own templates (session only). */
  readonly templates = signal<readonly SearchTemplate[]>([]);

  constructor() {
    effect(() => {
      const keys = this.ws.searchKeys();
      untracked(() => {
        for (const key of this.results().keys()) {
          if (!keys.has(key) && !this.fresh.has(key)) {
            this.release(key);
          }
        }
      });
    });
  }

  result(key: string): SearchResult | undefined {
    return this.results().get(key);
  }

  /**
   * Starts a search and shows it in a result tab on `side`: a new tab, or the
   * result tab `reuseTab`. Returns an error for the dialog (nothing opened) or null.
   */
  async search(
    criteria: SearchCriteria,
    side: Side,
    reuseTab?: { tabId: string; key: string } | null,
    form: FindForm | null = null,
  ): Promise<FsError | null> {
    const key = reuseTab?.key ?? `s${++keySeq}`;
    this.fresh.add(key);
    try {
      return await this.startAndOpen(key, criteria, side, reuseTab?.tabId, form);
    } finally {
      this.fresh.delete(key);
    }
  }

  private async startAndOpen(
    key: string,
    criteria: SearchCriteria,
    side: Side,
    reuseTab: string | undefined,
    form: FindForm | null,
  ): Promise<FsError | null> {
    const error = await this.start(key, criteria, form);
    if (error) {
      return error;
    }
    if (form) {
      this.remember(form);
    }
    const label = searchLabel(criteria);
    const tabId = this.ws.openSearchTab(side, { key, label }, criteria.roots[0] ?? '', reuseTab);
    if (tabId === null) {
      this.release(key);
      return { code: 'unknown', message: 'Too many tabs', path: null };
    }
    this.ws.setActive(side);
    this.ws.requestFocus(side);
    return null;
  }

  /** Runs the search of a result again (same criteria). */
  async rerun(key: string): Promise<void> {
    const r = this.result(key);
    if (r) {
      const error = await this.start(key, r.criteria, r.form);
      if (error) {
        this.patch(key, { error, running: false });
      }
    }
  }

  /** Cancels the running search of a result (the hits so far stay). */
  stop(key: string): void {
    const run = this.runs.get(key);
    if (run) {
      void this.jobs.cancel(run.jobId);
    }
  }

  /** Entries deleted or moved away (from a result tab) leave the result. */
  removePaths(key: string, paths: readonly string[]): void {
    const r = this.result(key);
    if (!r || paths.length === 0) {
      return;
    }
    const gone = new Set(paths);
    const run = this.runs.get(key);
    if (run) {
      const keep = run.all.filter((h) => !gone.has(h.path));
      run.all.length = 0;
      run.all.push(...keep);
    }
    this.patch(key, { hits: r.hits.filter((h) => !gone.has(h.path)) });
  }

  saveTemplate(label: string, form: FindForm): void {
    const name = label.trim();
    if (!name) {
      return;
    }
    this.templates.update((t) => [...t.filter((x) => x.label !== name), { label: name, form }]);
  }

  deleteTemplate(label: string): void {
    this.templates.update((t) => t.filter((x) => x.label !== label));
  }

  private remember(c: FindForm): void {
    const same = JSON.stringify(c);
    this.recent.update((r) =>
      [c, ...r.filter((x) => JSON.stringify(x) !== same)].slice(0, MAX_RECENT_SEARCHES),
    );
  }

  /** Cancels a running job of the result and starts a new one. */
  private async start(
    key: string,
    criteria: SearchCriteria,
    form: FindForm | null,
  ): Promise<FsError | null> {
    this.stopRun(key);
    let jobId: string;
    try {
      jobId = await this.jobs.start({ kind: 'search', criteria });
    } catch (err) {
      return toFsError(err);
    }
    const run: Run = {
      jobId,
      all: [],
      stats: EMPTY_STATS,
      timer: null,
      unsubscribe: () => undefined,
    };
    // a start racing with another start for the same result: the newer one wins
    this.stopRun(key);
    this.runs.set(key, run);
    run.unsubscribe = this.jobs.onSearchHits(jobId, (hits, stats) => {
      if (this.runs.get(key) !== run) {
        return;
      }
      run.all.push(...hits);
      run.stats = stats;
      this.schedulePublish(key, run);
    });
    this.setResult({
      key,
      criteria,
      label: searchLabel(criteria),
      hits: [],
      running: true,
      stats: EMPTY_STATS,
      unreadable: [],
      error: null,
      cancelled: false,
      form,
    });
    void this.jobs.whenFinished(jobId).then((job) => {
      if (this.runs.get(key) !== run) {
        return;
      }
      this.publish(key, run);
      run.unsubscribe();
      this.runs.delete(key);
      const s = job.summary;
      this.patch(key, {
        running: false,
        stats: s?.search ?? run.stats,
        unreadable: s?.errors ?? [],
        error: job.state === 'failed' ? (s?.error ?? null) : null,
        cancelled: job.state === 'cancelled',
      });
    });
    return null;
  }

  /** First hits at once, then at most every {@link PUBLISH_MS}. */
  private schedulePublish(key: string, run: Run): void {
    if (run.timer !== null) {
      return;
    }
    const first = this.result(key)?.hits.length === 0 && run.all.length > 0;
    if (first) {
      this.publish(key, run);
    }
    run.timer = setTimeout(() => {
      run.timer = null;
      if (this.runs.get(key) === run) {
        this.publish(key, run);
      }
    }, PUBLISH_MS);
  }

  private publish(key: string, run: Run): void {
    const r = this.result(key);
    if (r && (r.hits.length !== run.all.length || r.stats !== run.stats)) {
      this.patch(key, { hits: run.all.slice(), stats: run.stats });
    }
  }

  private stopRun(key: string): void {
    const run = this.runs.get(key);
    if (!run) {
      return;
    }
    this.runs.delete(key);
    run.unsubscribe();
    if (run.timer !== null) {
      clearTimeout(run.timer);
    }
    void this.jobs.cancel(run.jobId);
  }

  private release(key: string): void {
    this.stopRun(key);
    this.results.update((m) => {
      const next = new Map(m);
      next.delete(key);
      return next;
    });
  }

  private setResult(r: SearchResult): void {
    this.results.update((m) => new Map(m).set(r.key, r));
  }

  private patch(key: string, patch: Partial<SearchResult>): void {
    const r = this.result(key);
    if (r) {
      this.setResult({ ...r, ...patch });
    }
  }
}
