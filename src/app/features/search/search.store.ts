import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { SettingsStore } from '../../core/settings/settings.store';
import { acceptsValue, SCHEMA } from '../../core/settings/settings.models';
import { toFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { ItemError } from '../../core/jobs/jobs.models';
import { Side } from '../../core/session/session.models';
import { JobSpec } from '../../core/jobs/jobs.models';
import {
  DuplicateCriteria,
  EMPTY_STATS,
  SearchCriteria,
  SearchHit,
  SearchStats,
} from '../../core/search/search.models';
import { WorkspaceStore } from '../workspace/workspace.store';
import { FindForm, restoreForm } from './find-form';
import { DUP_TEXTS } from '../duplicates/duplicates-texts';
import { SEARCH_TEXTS } from './search-texts';
import { isSameOrBelow } from '../../shared/path-prefix';
import { FlatOptions, flatCriteria, flatOptionsOf } from '../flat/flat-logic';

/** Hits are shown at most this often while a search runs (`setRows` + sort of up to 100 000 rows). */
export const PUBLISH_MS = 300;
export const MAX_RECENT_SEARCHES = 10;
/** Own templates (design 022 E8, `search.templates`). */
export const MAX_TEMPLATES = 50;
export const MAX_TEMPLATE_LABEL = 100;

/**
 * What a result tab shows: hits of a search, groups of duplicate files (design 016 E6)
 * or every entry below a folder – the flat view (design 038).
 */
export type ResultKind = 'search' | 'duplicates' | 'flat';
/** A flat view is refreshed at most this often after a watcher event (design 038 E5, 029 E2). */
export const FLAT_REFRESH_GAP_MS = 1000;

/** The result of one search, shown by one or more result tabs. */
export interface SearchResult {
  readonly key: string;
  readonly kind: ResultKind;
  /** The search (duplicates: only the roots are set). */
  readonly criteria: SearchCriteria;
  /** Set for a duplicate search. */
  readonly duplicates: DuplicateCriteria | null;
  readonly label: string;
  /** Hits shown so far (published throttled while running). */
  readonly hits: readonly SearchHit[];
  readonly running: boolean;
  /**
   * Flat view (design 038 E5): listed again in the background – the old rows stay
   * until the new listing is complete (cursor, marks and scrolling are kept).
   */
  readonly refreshing: boolean;
  /**
   * Flat view: where the cursor goes once a refresh is taken over (a renamed entry's
   * new path, review 038 B7); `seq` tells a new request from one already applied.
   */
  readonly focus: { readonly path: string; readonly seq: number } | null;
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
  /** Background refresh of a flat view: hits are taken over only at the end. */
  readonly silent: boolean;
  readonly all: SearchHit[];
  stats: SearchStats;
  timer: ReturnType<typeof setTimeout> | null;
  unsubscribe: () => void;
}

/** Where the cursor goes after a flat refresh: a path from Rust, or a folder and a new name. */
export type FocusWanted = string | { readonly dir: string; readonly name: string };

let keySeq = 0;
let focusSeq = 0;

export { isSameOrBelow };

/** What the result header shows of a duplicate search: only its folders. */
function rootsOnly(roots: readonly string[]): SearchCriteria {
  return {
    roots,
    name: '',
    nameMode: 'glob',
    caseSensitive: false,
    wholeName: true,
    kinds: { files: true, dirs: false, links: false },
    includeHidden: false,
    followLinks: false,
    excludes: [],
  };
}

/** The job and the result fields of a search or a duplicate search. */
type Query =
  | { readonly kind: 'search' | 'flat'; readonly criteria: SearchCriteria }
  | { readonly kind: 'duplicates'; readonly criteria: DuplicateCriteria };

function queryOf(r: SearchResult): Query {
  return r.kind === 'duplicates' && r.duplicates
    ? { kind: 'duplicates', criteria: r.duplicates }
    : { kind: r.kind === 'flat' ? 'flat' : 'search', criteria: r.criteria };
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
  /** Flat views to list again once their running listing ends (at most one each, design 038 E5). */
  private readonly queued = new Map<string, SearchCriteria>();
  /** Flat views: end of the last listing and the timer of a refresh that waits for the gap. */
  private readonly lastEnd = new Map<string, number>();
  private readonly refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Results without a job (palette, design 043): how "search again" gets their hits. */
  private readonly fixed = new Map<string, (() => Promise<readonly SearchHit[]>) | null>();
  /** Flat views: cursor after the next refresh (review 038 B7). */
  private readonly focusAfter = new Map<string, FocusWanted>();

  readonly results = signal<ReadonlyMap<string, SearchResult>>(new Map());
  /** "Show folders" of the last flat view – the start value of the next one (design 038 E4). */
  flatShowDirs = false;
  private readonly settings = inject(SettingsStore);
  /** Last searches (dialog fields), newest first – kept in the settings (design 009 E5 / 015). */
  readonly recent = computed<readonly FindForm[]>(() =>
    this.settings
      .get('search.recent')
      .map(restoreForm)
      .filter((f): f is FindForm => f !== null)
      .slice(0, MAX_RECENT_SEARCHES),
  );
  /** Own templates, kept in the settings (design 022 E8). */
  readonly templates = computed<readonly SearchTemplate[]>(() =>
    restoreTemplates(this.settings.get('search.templates')),
  );

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

  /** A duplicate result that compared sizes only – contents unknown (review 016 #6). */
  sizeOnly(key: string | null | undefined): boolean {
    return key != null && this.result(key)?.duplicates?.compare === 'size';
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
      return await this.startAndOpen(
        key,
        { kind: 'search', criteria },
        side,
        reuseTab?.tabId,
        form,
      );
    } finally {
      this.fresh.delete(key);
    }
  }

  /** Starts a duplicate search (design 016 E6) and shows it in a new result tab on `side`. */
  async findDuplicates(criteria: DuplicateCriteria, side: Side): Promise<FsError | null> {
    const key = `s${++keySeq}`;
    this.fresh.add(key);
    try {
      return await this.startAndOpen(key, { kind: 'duplicates', criteria }, side, undefined, null);
    } finally {
      this.fresh.delete(key);
    }
  }

  private async startAndOpen(
    key: string,
    query: Query,
    side: Side,
    reuseTab: string | undefined,
    form: FindForm | null,
  ): Promise<FsError | null> {
    const error = await this.start(key, query, form);
    if (error) {
      return error;
    }
    if (form) {
      this.remember(form);
    }
    const label = query.kind === 'search' ? searchLabel(query.criteria) : DUP_TEXTS.header;
    const roots = query.criteria.roots;
    // the folder tab the search starts in names the folder the result tab falls back to
    const from = this.ws.activeTab(side);
    const rootTitle = from.search
      ? from.search.rootTitle
      : from.path === roots[0]
        ? from.title
        : undefined;
    const tabId = this.ws.openSearchTab(side, { key, label, rootTitle }, roots[0] ?? '', reuseTab);
    if (tabId === null) {
      this.release(key);
      return { code: 'too_many', message: SEARCH_TEXTS.tooManyTabs, path: null };
    }
    this.ws.setActive(side);
    this.ws.requestFocus(side);
    return null;
  }

  /**
   * Shows `hits` in a new result tab on `side` without a job (palette "All hits as result
   * tab", design 043 E4). `fetch` gets the hits again for "search again" (null: the
   * hits stay as they are). Returns an error (too many tabs) or null.
   */
  showFixed(
    label: string,
    hits: readonly SearchHit[],
    roots: readonly string[],
    side: Side,
    fetch: (() => Promise<readonly SearchHit[]>) | null,
  ): FsError | null {
    const key = `p${++keySeq}`;
    this.fixed.set(key, fetch);
    this.setResult({
      key,
      kind: 'search',
      criteria: rootsOnly(roots),
      duplicates: null,
      label,
      hits: hits.slice(),
      running: false,
      refreshing: false,
      focus: null,
      stats: { ...EMPTY_STATS, hits: hits.length },
      unreadable: [],
      error: null,
      cancelled: false,
      form: null,
    });
    const tabId = this.ws.openSearchTab(side, { key, label }, roots[0] ?? '');
    if (tabId === null) {
      this.release(key);
      return { code: 'too_many', message: SEARCH_TEXTS.tooManyTabs, path: null };
    }
    this.ws.setActive(side);
    this.ws.requestFocus(side);
    return null;
  }

  /**
   * Starts listing everything below `root` for a flat view (design 038 E2). `attach`
   * runs once the job was accepted and must show the result in a tab (else it is
   * released at once). Returns the error of a refused start or null.
   */
  async startFlat(
    root: string,
    options: FlatOptions,
    attach: (key: string) => boolean,
  ): Promise<FsError | null> {
    const key = `f${++keySeq}`;
    this.fresh.add(key);
    let shown = false;
    try {
      const error = await this.start(
        key,
        { kind: 'flat', criteria: flatCriteria(root, options) },
        null,
      );
      shown = !error && attach(key);
      return error;
    } finally {
      this.fresh.delete(key);
      // nobody shows it (the tab went elsewhere meanwhile): cancel and forget (review 038 B2)
      if (!shown) {
        this.release(key);
      }
    }
  }

  /**
   * Lists a flat view again in the background (design 038 E5), with changed options if
   * given. The old rows stay until the new listing is complete; a cancelled one keeps
   * them. While a listing runs, one more is queued (the newest options win). `focus`:
   * the cursor goes there once the new rows are shown (a renamed entry, review 038 B7).
   */
  refresh(key: string, patch?: Partial<FlatOptions>, focus?: FocusWanted): void {
    const r = this.result(key);
    if (!r || r.kind !== 'flat') {
      return;
    }
    if (focus !== undefined) {
      this.focusAfter.set(key, focus);
    }
    this.clearRefreshTimer(key);
    const queued = this.queued.get(key);
    const base = queued ?? r.criteria;
    const criteria = patch
      ? flatCriteria(base.roots[0] ?? '', { ...flatOptionsOf(base), ...patch })
      : base;
    if (this.runs.has(key) || this.starting.has(key)) {
      this.queued.set(key, criteria);
      return;
    }
    void this.start(key, { kind: 'flat', criteria }, null, true).then((error) => {
      if (error) {
        this.queued.delete(key);
        this.patch(key, { error, refreshing: false });
      }
    });
  }

  /** The options of a flat view's newest (queued or current) listing. */
  flatOptions(key: string): FlatOptions | null {
    const r = this.result(key);
    if (!r || r.kind !== 'flat') {
      return null;
    }
    return flatOptionsOf(this.queued.get(key) ?? r.criteria);
  }

  /**
   * Watcher event in the root of a flat view: refreshed, but not sooner than
   * {@link FLAT_REFRESH_GAP_MS} after the last listing ended (029 E2).
   */
  requestRefresh(key: string): void {
    if (this.refreshTimers.has(key)) {
      return;
    }
    const wait = (this.lastEnd.get(key) ?? 0) + FLAT_REFRESH_GAP_MS - Date.now();
    if (wait <= 0 || this.runs.has(key)) {
      this.refresh(key);
      return;
    }
    this.refreshTimers.set(
      key,
      setTimeout(() => {
        this.refreshTimers.delete(key);
        this.refresh(key);
      }, wait),
    );
  }

  private clearRefreshTimer(key: string): void {
    const t = this.refreshTimers.get(key);
    if (t !== undefined) {
      clearTimeout(t);
      this.refreshTimers.delete(key);
    }
  }

  /**
   * Runs the search of a result again (same criteria); a flat view refreshes in the
   * background, with the cursor on `focus` afterwards if given (review 038 B7).
   */
  async rerun(key: string, focus?: FocusWanted): Promise<void> {
    const r = this.result(key);
    if (r && this.fixed.has(key)) {
      const fetch = this.fixed.get(key);
      if (fetch) {
        this.patch(key, { running: true });
        const hits = await fetch();
        if (this.result(key)) {
          if (focus !== undefined) {
            this.focusAfter.set(key, focus);
          }
          this.patch(key, {
            hits,
            running: false,
            stats: { ...EMPTY_STATS, hits: hits.length },
            focus: this.takeFocus(key, hits),
          });
        }
      }
      return;
    }
    if (r?.kind === 'flat') {
      this.refresh(key, undefined, focus);
      return;
    }
    if (r) {
      const error = await this.start(key, queryOf(r), r.form);
      if (error) {
        // the old run (if any) goes on – the result stays "running" only while it does
        this.patch(key, { error, running: this.runs.has(key) });
      }
    }
  }

  /** Cancels the running search of a result (the hits so far stay) – and a queued refresh (review 038 B3). */
  stop(key: string): void {
    this.queued.delete(key);
    this.clearRefreshTimer(key);
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

  /** Saves a template (same name: replaced). False if the name is empty or the list is full. */
  saveTemplate(label: string, form: FindForm): boolean {
    const name = label.trim().slice(0, MAX_TEMPLATE_LABEL);
    const others = this.templates().filter((x) => x.label !== name);
    if (!name || others.length >= MAX_TEMPLATES) {
      return false;
    }
    const next = [...others, { label: name, form }];
    if (!acceptsValue(SCHEMA['search.templates'], next)) {
      return false;
    }
    this.settings.set('search.templates', next);
    return true;
  }

  deleteTemplate(label: string): void {
    this.settings.set(
      'search.templates',
      this.templates().filter((x) => x.label !== label),
    );
  }

  private remember(c: FindForm): void {
    const same = JSON.stringify(c);
    const next = [c, ...this.recent().filter((x) => JSON.stringify(x) !== same)].slice(
      0,
      MAX_RECENT_SEARCHES,
    );
    // over the size limit of the setting the store would drop the whole list (review 015 #7):
    // the oldest forms go first
    while (next.length > 1 && !acceptsValue(SCHEMA['search.recent'], next)) {
      next.pop();
    }
    this.settings.set('search.recent', next);
  }

  /**
   * Starts a new job for the result; a running one is cancelled only once the
   * new one was accepted (review 009 #2: a refused pattern keeps the old run).
   */
  private async start(
    key: string,
    query: Query,
    form: FindForm | null,
    silent = false,
  ): Promise<FsError | null> {
    const pending = { stop: false };
    this.starting.set(key, pending);
    let jobId: string;
    const spec: JobSpec =
      query.kind === 'duplicates'
        ? { kind: 'duplicates', criteria: query.criteria }
        : { kind: 'search', criteria: query.criteria };
    try {
      jobId = await this.jobs.start(spec);
    } catch (err) {
      return toFsError(err);
    } finally {
      if (this.starting.get(key) === pending) {
        this.starting.delete(key);
      }
    }
    // released while the job was being started (tab closed, flat view left): it must not
    // bring the result back (review 038 B1)
    if (!this.fresh.has(key) && !this.ws.searchKeys().has(key)) {
      void this.jobs.cancel(jobId);
      return null;
    }
    const run: Run = {
      jobId,
      silent,
      all: [],
      stats: EMPTY_STATS,
      timer: null,
      unsubscribe: () => undefined,
    };
    // the old run of the result (or a start racing with this one): the newer one wins
    this.stopRun(key);
    this.runs.set(key, run);
    const dup = query.kind === 'duplicates';
    const old = this.result(key);
    if (silent && old) {
      this.patch(key, {
        criteria: dup ? rootsOnly(query.criteria.roots) : query.criteria,
        refreshing: true,
        error: null,
      });
    } else {
      this.setResult({
        key,
        kind: query.kind,
        criteria: dup ? rootsOnly(query.criteria.roots) : query.criteria,
        duplicates: dup ? query.criteria : null,
        label: dup
          ? DUP_TEXTS.header
          : query.kind === 'flat'
            ? (old?.label ?? '')
            : searchLabel(query.criteria),
        hits: [],
        running: true,
        refreshing: false,
        focus: null,
        stats: EMPTY_STATS,
        unreadable: [],
        error: null,
        cancelled: false,
        form,
      });
    }
    // hits that arrived before the id (buffered by JobsStore) come at once
    run.unsubscribe = this.jobs.onSearchHits(jobId, (hits, stats) => {
      if (this.runs.get(key) !== run) {
        return;
      }
      run.all.push(...hits);
      run.stats = stats;
      if (!silent) {
        this.schedulePublish(key, run);
      }
    });
    if (pending.stop) {
      void this.jobs.cancel(jobId); // Stop was pressed while the job was being started
    }
    void this.jobs.whenFinished(jobId).then((job) => {
      if (this.runs.get(key) !== run) {
        return;
      }
      run.unsubscribe();
      this.runs.delete(key);
      this.lastEnd.set(key, Date.now());
      const s = job.summary;
      if (silent) {
        // a cancelled or failed refresh keeps the rows it was meant to replace
        this.patch(
          key,
          job.state === 'done'
            ? {
                hits: run.all.slice(),
                focus: this.takeFocus(key, run.all),
                stats: s?.search ?? run.stats,
                unreadable: s?.errors ?? [],
                refreshing: false,
                cancelled: false,
                error: null,
              }
            : {
                refreshing: false,
                error: job.state === 'failed' ? (s?.error ?? null) : null,
              },
        );
      } else {
        this.publish(key, run);
        this.patch(key, {
          running: false,
          stats: s?.search ?? run.stats,
          unreadable: s?.errors ?? [],
          error: job.state === 'failed' ? (s?.error ?? null) : null,
          cancelled: job.state === 'cancelled',
        });
      }
      const next = this.queued.get(key);
      if (next) {
        this.queued.delete(key);
        void this.start(key, { kind: 'flat', criteria: next }, null, true);
      }
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

  /** The cursor wanted after this refresh, as a path of the new rows (review 038 B7). */
  private takeFocus(key: string, hits: readonly SearchHit[]): SearchResult['focus'] {
    const wanted = this.focusAfter.get(key);
    this.focusAfter.delete(key);
    const keep = this.result(key)?.focus ?? null;
    if (wanted === undefined) {
      return keep;
    }
    const path =
      typeof wanted === 'string'
        ? wanted
        : hits.find((h) => h.dir === wanted.dir && h.name === wanted.name)?.path;
    return path === undefined ? keep : { path, seq: ++focusSeq };
  }

  private release(key: string): void {
    const pending = this.starting.get(key);
    if (pending) {
      pending.stop = true;
    }
    this.focusAfter.delete(key);
    this.fixed.delete(key);
    this.stopRun(key);
    this.queued.delete(key);
    this.lastEnd.delete(key);
    this.clearRefreshTimer(key);
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

/** Templates read back from the settings: a label and a valid form each, first of a name wins. */
export function restoreTemplates(raw: readonly unknown[]): SearchTemplate[] {
  const out: SearchTemplate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const label = typeof rec['label'] === 'string' ? rec['label'].trim() : '';
    const form = restoreForm(rec['form']);
    if (label && form && !out.some((t) => t.label === label)) {
      out.push({ label, form });
    }
  }
  return out.slice(0, MAX_TEMPLATES);
}
