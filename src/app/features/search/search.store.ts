import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { SettingsStore } from '../../core/settings/settings.store';
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
import { FindForm, restoreForm } from './find-form';

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

/**
 * `path` is `ancestor` or lies below it. Paths stay opaque (CLAUDE.md §4): only a
 * prefix comparison up to a separator, never split or joined.
 */
export function isSameOrBelow(path: string, ancestor: string): boolean {
  if (path === ancestor) {
    return true;
  }
  if (!path.startsWith(ancestor)) {
    return false;
  }
  // a root like `/` or `C:\` already ends with its separator
  const sep = /[/\\]$/.test(ancestor) ? '' : path.charAt(ancestor.length);
  return sep === '' ? path.length > ancestor.length : sep === '/' || sep === '\\';
}

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
  /** Results whose job is being started; Stop meanwhile cancels it as soon as it has an id. */
  private readonly starting = new Map<string, { stop: boolean }>();
  /** Results whose tab is about to open – not released meanwhile. */
  private readonly fresh = new Set<string>();

  readonly results = signal<ReadonlyMap<string, SearchResult>>(new Map());
  private readonly settings = inject(SettingsStore);
  /** Last searches (dialog fields), newest first – kept in the settings (design 009 E5 / 015). */
  readonly recent = computed<readonly FindForm[]>(() =>
    this.settings
      .get('search.recent')
      .map(restoreForm)
      .filter((f): f is FindForm => f !== null)
      .slice(0, MAX_RECENT_SEARCHES),
  );
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
        // the old run (if any) goes on – the result stays "running" only while it does
        this.patch(key, { error, running: this.runs.has(key) });
      }
    }
  }

  /** Cancels the running search of a result (the hits so far stay). */
  stop(key: string): void {
    const run = this.runs.get(key);
    if (run) {
      void this.jobs.cancel(run.jobId);
    }
    const pending = this.starting.get(key);
    if (pending) {
      pending.stop = true;
    }
  }

  /** Entries deleted or moved away (from a result tab) leave the result – with everything below them. */
  removePaths(key: string, paths: readonly string[]): void {
    const r = this.result(key);
    if (!r || paths.length === 0) {
      return;
    }
    const gone = (h: SearchHit) => paths.some((p) => isSameOrBelow(h.path, p));
    const run = this.runs.get(key);
    if (run) {
      const keep = run.all.filter((h) => !gone(h));
      run.all.length = 0;
      run.all.push(...keep);
    }
    this.patch(key, { hits: r.hits.filter((h) => !gone(h)) });
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
    const next = [c, ...this.recent().filter((x) => JSON.stringify(x) !== same)].slice(
      0,
      MAX_RECENT_SEARCHES,
    );
    this.settings.set('search.recent', next);
  }

  /**
   * Starts a new job for the result; a running one is cancelled only once the
   * new one was accepted (review 009 #2: a refused pattern keeps the old run).
   */
  private async start(
    key: string,
    criteria: SearchCriteria,
    form: FindForm | null,
  ): Promise<FsError | null> {
    const pending = { stop: false };
    this.starting.set(key, pending);
    let jobId: string;
    try {
      jobId = await this.jobs.start({ kind: 'search', criteria });
    } catch (err) {
      return toFsError(err);
    } finally {
      if (this.starting.get(key) === pending) {
        this.starting.delete(key);
      }
    }
    const run: Run = {
      jobId,
      all: [],
      stats: EMPTY_STATS,
      timer: null,
      unsubscribe: () => undefined,
    };
    // the old run of the result (or a start racing with this one): the newer one wins
    this.stopRun(key);
    this.runs.set(key, run);
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
    // hits that arrived before the id (buffered by JobsStore) come at once
    run.unsubscribe = this.jobs.onSearchHits(jobId, (hits, stats) => {
      if (this.runs.get(key) !== run) {
        return;
      }
      run.all.push(...hits);
      run.stats = stats;
      this.schedulePublish(key, run);
    });
    if (pending.stop) {
      void this.jobs.cancel(jobId); // Stop was pressed while the job was being started
    }
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
