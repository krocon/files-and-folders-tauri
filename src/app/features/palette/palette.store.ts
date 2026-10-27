import { computed, effect, inject, Injectable, Injector, signal, untracked } from '@angular/core';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError, isNavigableDir } from '../../core/fs/fs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { PaletteApi } from '../../core/palette/palette-api';
import {
  IndexStatus,
  NO_INDEX,
  PaletteConfig,
  PaletteEvent,
  PaletteHit,
  QueryStats,
} from '../../core/palette/palette.models';
import { PreviewApi } from '../../core/preview/preview-api';
import { Preview } from '../../core/preview/preview.models';
import { SearchHit } from '../../core/search/search.models';
import { isSameOrBelow } from '../../shared/path-prefix';
import { SettingsStore } from '../../core/settings/settings.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { DiskUsageStore } from '../diskusage/disk-usage.store';
import { OpsStore } from '../ops/ops.store';
import { SearchStore } from '../search/search.store';
import { Side } from '../../core/session/session.models';
import { WorkspaceStore } from '../workspace/workspace.store';
import { mergeHits } from './palette-logic';
import { ParsedQuery, parseQuery, searchesFiles } from './palette-query';
import { PALETTE_TEXTS } from './palette-texts';

/** Settings changes reach Rust after this pause (typing a folder). */
export const CONFIGURE_DEBOUNCE_MS = 400;
/** A query starts this long after the last key (pasting several characters is one query). */
export const QUERY_DEBOUNCE_MS = 25;
/** While the index is built the status is read this often (palette open). */
export const STATUS_POLL_MS = 1000;
export const PREVIEW_TEXT_BYTES = 128 * 1024;
/** A result tab of all hits asks Rust for this many. */
export const RESULT_TAB_LIMIT = 2000;
/** "Search again" of a result tab gives up waiting for the end after this long. */
export const FETCH_TIMEOUT_MS = 15_000;

/** What a hit action works on: the marked hits, else the active one. */
export type HitAction =
  | 'open'
  | 'preview'
  | 'reveal'
  | 'revealInNewTab'
  | 'copy'
  | 'move'
  | 'rename'
  | 'similar'
  | 'analyzeParent'
  | 'resultsTab'
  | 'mark';

/**
 * The universal palette (design 043): what is typed, the hits Rust streams for it
 * (each key starts a new query, answers of older ones are dropped), marks, the
 * preview, and the actions on hits – they open the normal dialogs (copy, move,
 * rename) with the hit as source, never past their checks.
 */
@Injectable({ providedIn: 'root' })
export class PaletteStore {
  private readonly api = inject(PaletteApi);
  private readonly ws = inject(WorkspaceStore);
  private readonly settings = inject(SettingsStore);
  private readonly dialogs = inject(DialogService);
  /** The stores of the actions are taken when an action runs (the palette alone needs none). */
  private readonly injector = inject(Injector);
  private get previewApi(): PreviewApi {
    return this.injector.get(PreviewApi);
  }
  private get ops(): OpsStore {
    return this.injector.get(OpsStore);
  }
  private get search(): SearchStore {
    return this.injector.get(SearchStore);
  }
  private get usage(): DiskUsageStore {
    return this.injector.get(DiskUsageStore);
  }
  private get jobs(): JobsStore {
    return this.injector.get(JobsStore);
  }

  readonly text = signal('');
  /** File and folder hits from Rust, best first. */
  readonly hits = signal<readonly PaletteHit[]>([]);
  /** A query runs (the old hits stay until the first new ones come – no jumping list). */
  readonly loading = signal(false);
  readonly stats = signal<QueryStats | null>(null);
  readonly status = signal<IndexStatus>(NO_INDEX);
  readonly marked = signal<ReadonlySet<string>>(new Set());
  /** The hit under the cursor (set by the palette). */
  readonly active = signal<PaletteHit | null>(null);
  readonly previewOn = signal(false);
  readonly preview = signal<Preview | null>(null);
  readonly previewError = signal<FsError | null>(null);
  readonly previewLoading = signal(false);
  readonly message = signal<string | null>(null);

  readonly parsed = computed<ParsedQuery>(() => this.parse(this.text()));
  readonly markedHits = computed(() => {
    const m = this.marked();
    return m.size ? this.hits().filter((h) => m.has(h.path)) : [];
  });

  private seq = 0;
  private fresh = false;
  /** The id of the palette's running query (resolves once Rust started it). */
  private started: Promise<number> | null = null;
  private queryTimer: ReturnType<typeof setTimeout> | null = null;
  private configTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private previewSeq = 0;
  /** Tests: no timers. */
  debounceMs = QUERY_DEBOUNCE_MS;
  configureDelayMs = CONFIGURE_DEBOUNCE_MS;

  constructor() {
    // the settings go to Rust (index on/off, roots …) – debounced, the first one at once
    let first = true;
    effect(() => {
      const config = this.config();
      untracked(() => {
        if (this.configTimer !== null) {
          clearTimeout(this.configTimer);
        }
        const send = () => void this.configure(config);
        if (first) {
          first = false;
          send();
        } else {
          this.configTimer = setTimeout(send, this.configureDelayMs);
        }
      });
    });
    effect(() => {
      const hit = this.active();
      const on = this.previewOn();
      untracked(() => this.loadPreview(on ? hit : null));
    });
  }

  private parse(text: string): ParsedQuery {
    return parseQuery(text, Date.now(), -new Date().getTimezoneOffset());
  }

  private readonly config = computed<PaletteConfig>(() => ({
    index: this.settings.get('palette.index'),
    roots: strings(this.settings.get('palette.roots')),
    excludes: strings(this.settings.get('palette.excludes')),
    maxMemoryMb: this.settings.get('palette.maxMemoryMb'),
    includeHidden: this.settings.get('palette.includeHidden'),
    systemSearch: this.settings.get('palette.systemSearch'),
  }));

  private async configure(config: PaletteConfig): Promise<void> {
    try {
      this.status.set(await this.api.configure(config));
      this.message.set(null);
    } catch (err) {
      this.message.set(errorText(toFsError(err)));
    }
  }

  // ---- open / close ----

  /** The palette opens: an empty query, the index status (read again while it is built). */
  opened(): void {
    this.seq++;
    this.text.set('');
    this.hits.set([]);
    this.stats.set(null);
    this.loading.set(false);
    this.marked.set(new Set());
    this.active.set(null);
    this.previewOn.set(false);
    this.message.set(null);
    void this.refreshStatus();
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      const s = this.status().state;
      if (s === 'building' || s === 'waiting') {
        void this.refreshStatus();
      }
    }, STATUS_POLL_MS);
  }

  /** The palette closed: the running query stops, the preview is released. */
  closed(): void {
    this.seq++;
    this.stopPolling();
    if (this.queryTimer !== null) {
      clearTimeout(this.queryTimer);
      this.queryTimer = null;
    }
    this.previewOn.set(false);
    this.active.set(null);
    this.cancelRunning();
  }

  /**
   * Cancels the palette's query by its id once Rust named it – a cancel that overtook the
   * start would otherwise stop the next query (review 043 #3).
   */
  private cancelRunning(): void {
    const started = this.started;
    this.started = null;
    void started?.then((id) => this.api.cancel(id)).catch(() => undefined);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async refreshStatus(): Promise<void> {
    try {
      this.status.set(await this.api.status());
    } catch {
      // no backend (browser): the status stays
    }
  }

  async rebuild(): Promise<void> {
    try {
      this.status.set(await this.api.rebuild());
    } catch (err) {
      this.message.set(errorText(toFsError(err)));
    }
  }

  async clearIndex(): Promise<void> {
    try {
      this.status.set(await this.api.clear());
    } catch (err) {
      this.message.set(errorText(toFsError(err)));
    }
  }

  // ---- queries ----

  setText(text: string): void {
    this.text.set(text);
    if (this.queryTimer !== null) {
      clearTimeout(this.queryTimer);
    }
    if (this.debounceMs <= 0) {
      this.run();
    } else {
      this.queryTimer = setTimeout(() => {
        this.queryTimer = null;
        this.run();
      }, this.debounceMs);
    }
  }

  /** Folders of the tabs and favourites (the live walk visits them; they rank up). */
  private places(): string[] {
    const panels = this.ws.panels();
    const tabs = [...panels.left.tabs, ...panels.right.tabs].filter((t) => !t.search);
    return [
      ...new Set(
        [...tabs.map((t) => t.path), ...this.ws.favorites()].filter((p): p is string => !!p),
      ),
    ];
  }

  private run(): void {
    const seq = ++this.seq;
    const q = this.parse(this.text());
    this.marked.set(new Set());
    if (q.mode === 'actions' || (q.mode === 'files' && !searchesFiles(q))) {
      this.hits.set([]);
      this.stats.set(null);
      this.loading.set(false);
      this.cancelRunning();
      return;
    }
    this.loading.set(true);
    this.fresh = true;
    const limit = this.settings.get('palette.maxHits');
    const started = this.api.query(
      {
        text: this.text(),
        places: this.places(),
        recent: this.ws.recent().slice(0, 10),
        limit,
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
      },
      (e) => this.onEvent(seq, e, limit),
    );
    this.started = started;
    started.catch((err) => {
      if (seq === this.seq) {
        this.loading.set(false);
        this.hits.set([]);
        this.message.set(errorText(toFsError(err)));
      }
    });
  }

  /** Events of a query that is not the newest are dropped. */
  private onEvent(seq: number, e: PaletteEvent, limit: number): void {
    if (seq !== this.seq) {
      return;
    }
    const replace = this.fresh;
    this.fresh = false;
    if (e.type === 'hits') {
      this.hits.set(mergeHits(replace ? [] : this.hits(), e.hits, limit));
    } else {
      if (replace) {
        this.hits.set([]);
      }
      this.stats.set(e.stats);
      this.loading.set(false);
      this.status.update((s) => (s.state === e.stats.index ? s : { ...s, state: e.stats.index }));
    }
  }

  // ---- marks and preview ----

  toggleMark(hit: PaletteHit): void {
    const next = new Set(this.marked());
    if (!next.delete(hit.path)) {
      next.add(hit.path);
    }
    this.marked.set(next);
  }

  togglePreview(): void {
    this.previewOn.update((v) => !v);
  }

  private loadPreview(hit: PaletteHit | null): void {
    const seq = ++this.previewSeq;
    this.preview.set(null);
    this.previewError.set(null);
    if (!hit || isNavigableDir(hit)) {
      this.previewLoading.set(false);
      return;
    }
    this.previewLoading.set(true);
    void this.previewApi
      .readPreview(hit.path, { maxTextBytes: PREVIEW_TEXT_BYTES, imageSlot: 'viewer' })
      .then(
        (p) => {
          if (seq === this.previewSeq) {
            this.preview.set(p);
          }
        },
        (err) => {
          if (seq === this.previewSeq) {
            this.previewError.set(toFsError(err));
          }
        },
      )
      .finally(() => {
        if (seq === this.previewSeq) {
          this.previewLoading.set(false);
        }
      });
  }

  // ---- actions on hits ----

  /** The hits an action works on: the marked ones, else the active one. */
  targets(): readonly PaletteHit[] {
    const marked = this.markedHits();
    if (marked.length) {
      return marked;
    }
    const a = this.active();
    return a ? [a] : [];
  }

  /** Whether an action can run now (one hit or – for some – several). */
  can(action: HitAction): boolean {
    const t = this.targets();
    switch (action) {
      case 'copy':
      case 'move':
      case 'mark':
        return t.length > 0;
      case 'resultsTab':
        return this.hits().length > 0;
      case 'preview':
        return this.active() !== null;
      case 'similar':
        return t.length === 1 && !isNavigableDir(t[0]);
      default:
        return t.length === 1;
    }
  }

  /**
   * Runs a hit action. The palette closes first (a dialog of the action takes its
   * place); errors go to the task list's notice like those of other actions.
   */
  async runAction(action: HitAction): Promise<void> {
    if (!this.can(action)) {
      return;
    }
    const targets = this.targets();
    const side = this.ws.activeSide();
    switch (action) {
      case 'mark':
        this.toggleMark(this.active() ?? targets[0]);
        return;
      case 'preview':
        this.togglePreview();
        return;
    }
    const hit = targets[0];
    this.dialogs.close({ restoreFocus: false });
    try {
      switch (action) {
        case 'open':
          await this.open(hit, side);
          break;
        case 'reveal':
          this.reveal(hit, side);
          break;
        case 'revealInNewTab':
          this.ws.openInNewTab(side, hit.dir, '', hit.path);
          this.ws.setActive(side);
          this.ws.requestFocus(side);
          break;
        case 'copy':
        case 'move':
          await this.ops.openCopyMoveFor({
            kind: action,
            side,
            sourceDir: commonDir(targets),
            sources: targets.map(entryOf),
            target: this.ws.targetDir(side) ?? '',
          });
          break;
        case 'rename':
          this.ops.openRenameFor(side, hit.dir, entryOf(hit));
          break;
        case 'similar':
          await this.similar(hit, side);
          break;
        case 'analyzeParent':
          await this.report(this.usage.start(side, [hit.dir], hit.parentNames[0] || hit.dir));
          break;
        case 'resultsTab':
          this.resultsTab(side);
          break;
      }
    } catch (err) {
      this.jobs.report(errorText(toFsError(err)));
    }
  }

  private async report(p: Promise<FsError | null>): Promise<void> {
    const e = await p;
    if (e) {
      this.jobs.report(errorText(e));
    }
  }

  /** Enter: a folder opens in the active panel, a file with its app (programs ask first). */
  private async open(hit: PaletteHit, side: Side): Promise<void> {
    this.ws.setActive(side);
    if (isNavigableDir(hit)) {
      this.ws.requestNavigate(side, hit.path);
      this.ws.requestFocus(side);
      return;
    }
    this.ws.requestFocus(side);
    await this.ws.panel(side)?.store.openFile(entryOf(hit));
  }

  /** "Go to location": the active panel shows the folder, the cursor on the hit. */
  private reveal(hit: PaletteHit, side: Side): void {
    this.ws.setActive(side);
    this.ws.requestNavigate(side, hit.dir, hit.path);
    this.ws.requestFocus(side);
  }

  /**
   * Copies of the file (design 042): an image – similar images in its folder and below;
   * any other file – the same content below the search folders (only its size is hashed).
   */
  private async similar(hit: PaletteHit, side: Side): Promise<void> {
    const image = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(hit.name);
    // the search folders – and the hit's folder when it lies outside them (a tab elsewhere)
    const indexRoots = this.status().roots.filter((r) => !!r);
    const roots = image
      ? [hit.dir]
      : indexRoots.some((r) => isSameOrBelow(hit.path, r))
        ? [...indexRoots]
        : [...indexRoots, hit.dir];
    await this.report(
      this.search.findDuplicates(
        {
          roots,
          compare: 'content',
          sameName: false,
          includeHidden: this.settings.get('palette.includeHidden'),
          excludes: strings(this.settings.get('palette.excludes')),
          mode: image ? 'similarImages' : 'exact',
          reference: hit.path,
        },
        side,
      ),
    );
  }

  /** All hits (up to {@link RESULT_TAB_LIMIT}) in a result tab; "search again" asks Rust again. */
  private resultsTab(side: Side): void {
    const text = this.text();
    const marked = this.markedHits();
    // its own query beside the palette's; it ends at the latest after FETCH_TIMEOUT_MS
    const fetch = (): Promise<readonly SearchHit[]> =>
      new Promise((resolve) => {
        let all: PaletteHit[] = [];
        const timer = setTimeout(() => resolve(all), FETCH_TIMEOUT_MS);
        const done = () => {
          clearTimeout(timer);
          resolve(all);
        };
        void this.api
          .query(
            {
              text,
              places: this.places(),
              recent: this.ws.recent().slice(0, 10),
              limit: RESULT_TAB_LIMIT,
              tzOffsetMinutes: -new Date().getTimezoneOffset(),
              detached: true,
            },
            (e) => {
              if (e.type === 'hits') {
                all = mergeHits(all, e.hits, RESULT_TAB_LIMIT);
              } else {
                done();
              }
            },
          )
          .catch(done);
      });
    const initial = marked.length ? marked : this.hits();
    const roots = this.status().roots;
    const error = this.search.showFixed(
      PALETTE_TEXTS.resultLabel(text.trim()),
      initial,
      roots.length ? [...roots] : [initial[0]?.dir ?? ''],
      side,
      marked.length ? null : fetch,
    );
    if (error) {
      this.jobs.report(errorText(error));
    }
  }
}

function strings(v: readonly unknown[]): string[] {
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .map((s) => s.trim());
}

/** A hit as an entry for the dialogs (without the palette fields). */
export function entryOf(hit: PaletteHit): DirEntry & SearchHit {
  const entry: Record<string, unknown> = { ...hit };
  for (const key of ['score', 'source', 'ranges']) {
    delete entry[key];
  }
  return entry as unknown as DirEntry & SearchHit;
}

/** The folder of all hits, '' when they come from several. */
export function commonDir(hits: readonly PaletteHit[]): string {
  const dirs = new Set(hits.map((h) => h.dir));
  return dirs.size === 1 ? hits[0].dir : '';
}
