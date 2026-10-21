import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { DiskUsageApi } from '../../core/diskusage/disk-usage-api';
import { DiskUsageView, SizeMode, UsageNode } from '../../core/diskusage/disk-usage.models';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError, isParentRow, isVirtualPath } from '../../core/fs/fs.models';
import { ExpectedEntry } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { Side } from '../../core/session/session.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { basketView, BasketView, withLevelMarks, withoutPaths } from './basket-logic';
import { RING_DEPTH } from './chart-layout';
import { USAGE_TEXTS } from './disk-usage-texts';
import {
  isUsageKey,
  largestRows,
  scanIdOf,
  upPath,
  usageKey,
  usageOf,
  UsageRow,
  viewRows,
} from './usage-rows';

/** Children of one list level (Rust folds the rest into one row). */
export const LIST_LIMIT = 2000;
/** Children per level of the chart tree; smaller ones than this part are folded by Rust. */
export const CHART_LIMIT = 300;
export const CHART_MIN_FRACTION = 0.002;
export const LARGEST_COUNT = 100;
/** While a scan runs, the shown level is read again this often. */
export const POLL_MS = 500;

export type UsageMode = 'all' | 'largest';

/** One disk-usage scan as a tab shows it (design 033). */
export interface UsageState {
  readonly scanId: string;
  /** Shown node; `null` = the top node. */
  readonly node: number | null;
  readonly back: readonly (number | null)[];
  readonly forward: readonly (number | null)[];
  readonly mode: UsageMode;
  readonly view: DiskUsageView | null;
  /** The shown node with children for the chart (several levels). */
  readonly chart: UsageNode | null;
  readonly rows: readonly UsageRow[];
  readonly error: FsError | null;
  /** Marked entries of all levels (design 033 E3), by node id. */
  readonly basket: ReadonlyMap<number, UsageRow>;
  /** Where the list cursor goes after a navigation (`cursorSeq` changes with it). */
  readonly cursor: string | null;
  readonly cursorSeq: number;
  /** Cursor of a navigation whose level is still being read (applied with its rows). */
  readonly pendingCursor?: string | null;
  readonly startedAt: number;
}

function initial(scanId: string): UsageState {
  return {
    scanId,
    node: null,
    back: [],
    forward: [],
    mode: 'all',
    view: null,
    chart: null,
    rows: [],
    error: null,
    basket: new Map(),
    cursor: null,
    cursorSeq: 0,
    startedAt: Date.now(),
  };
}

/** What a disk-usage tab hands to its `FileBrowserStore` (navigation inside the scan). */
export interface UsageNavigator {
  open(entry: DirEntry): Promise<boolean>;
  up(): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  canBack(): boolean;
  canForward(): boolean;
  refresh(): Promise<void>;
}

/**
 * Disk-usage scans (design 033): starts them as job `diskUsage`, opens a result tab
 * (`usage:<scanId>`), keeps per scan the shown node, history, rows and basket, reads
 * the levels from Rust (also while the scan runs) and releases a scan with its tab.
 */
@Injectable({ providedIn: 'root' })
export class DiskUsageStore {
  private readonly api = inject(DiskUsageApi);
  private readonly jobs = inject(JobsStore);
  private readonly ws = inject(WorkspaceStore);
  private readonly settings = inject(SettingsStore);

  readonly states = signal<ReadonlyMap<string, UsageState>>(new Map());
  /** Scans whose tab is being opened (not released meanwhile). */
  private readonly fresh = new Set<string>();
  private readonly seqs = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  pollMs = POLL_MS;

  /** The chart kind (settings, toggled in the chart head). */
  readonly chartKind = computed(() => this.settings.get('diskUsage.chart'));

  constructor() {
    effect(() => {
      const keys = this.ws.searchKeys();
      untracked(() => {
        for (const id of this.states().keys()) {
          if (!keys.has(usageKey(id)) && !this.fresh.has(id)) {
            void this.release(id);
          }
        }
      });
    });
  }

  state(scanId: string): UsageState | undefined {
    return this.states().get(scanId);
  }

  /** The state of the disk-usage tab shown on `side`, if it is one. */
  stateOn(side: Side): UsageState | null {
    const key = this.ws.activeTab(side).search?.key;
    return isUsageKey(key) ? (this.state(scanIdOf(key)) ?? null) : null;
  }

  basket(scanId: string): BasketView {
    const s = this.state(scanId);
    return basketView(s?.basket ?? new Map(), s?.view?.sizeMode ?? 'allocated');
  }

  private patch(scanId: string, fn: (s: UsageState) => UsageState): void {
    this.states.update((m) => {
      const s = m.get(scanId);
      if (!s) {
        return m;
      }
      const next = new Map(m);
      next.set(scanId, fn(s));
      return next;
    });
  }

  // ---- start ----

  /**
   * Scans `roots` (or, `volume`, the volume of the first) and shows the result in a
   * new tab on `side`. `name` labels the tab (the folder, "Selection", the drive).
   */
  async start(
    side: Side,
    roots: readonly string[],
    name: string,
    volume = false,
  ): Promise<FsError | null> {
    let id: string;
    try {
      id = await this.jobs.start({
        kind: 'diskUsage',
        roots,
        volume,
        options: {
          sizeMode: this.settings.get('diskUsage.sizeMode'),
          crossFilesystems: this.settings.get('diskUsage.crossFilesystems'),
        },
      });
    } catch (e) {
      return toFsError(e);
    }
    this.fresh.add(id);
    try {
      this.states.update((m) => new Map(m).set(id, initial(id)));
      const from = this.ws.activeTab(side);
      const rootTitle = from.search ? from.search.rootTitle : from.title || undefined;
      const tabId = this.ws.openSearchTab(
        side,
        { key: usageKey(id), label: USAGE_TEXTS.tabLabel(name), rootTitle },
        roots[0] ?? '',
      );
      if (tabId === null) {
        await this.release(id);
        return { code: 'too_many', message: USAGE_TEXTS.tooManyTabs, path: null };
      }
      this.ws.setActive(side);
      this.ws.requestFocus(side);
      const named = name;
      void this.jobs.whenFinished(id).then((job) => {
        if (job.state === 'failed' && job.summary?.error) {
          this.patch(id, (s) => ({ ...s, error: job.summary!.error }));
        }
        void this.refresh(id);
      });
      await this.refresh(id);
      // a drive is named once Rust found its root (`/`, `C:\`)
      const top = this.state(id)?.view?.crumbs[0]?.name;
      if (!named && top) {
        const label = USAGE_TEXTS.tabLabel(top);
        this.ws.updateTab(tabId, { title: label, search: { key: usageKey(id), label, rootTitle } });
      }
    } finally {
      this.fresh.delete(id);
    }
    return null;
  }

  // ---- reading ----

  /** Reads the shown level (list, chart, largest files) again. */
  async refresh(scanId: string): Promise<void> {
    const s = this.state(scanId);
    if (!s) {
      return;
    }
    const seq = (this.seqs.get(scanId) ?? 0) + 1;
    this.seqs.set(scanId, seq);
    try {
      const [view, chart] = await Promise.all([
        this.api.view(scanId, s.node, 1, 0, LIST_LIMIT),
        this.api.view(scanId, s.node, RING_DEPTH, CHART_MIN_FRACTION, CHART_LIMIT),
      ]);
      const rows =
        s.mode === 'largest'
          ? largestRows(
              await this.api.largest(scanId, view.node.id, LARGEST_COUNT),
              view,
              view.sizeMode,
            )
          : viewRows(view, scanId, USAGE_TEXTS);
      if (this.seqs.get(scanId) !== seq) {
        return;
      }
      this.patch(scanId, (st) => ({
        ...st,
        view,
        chart: chart.node,
        rows,
        error: null,
        // the basket follows renamed sizes; a row that went (pruned) stays until the job says so
        basket: refreshBasket(st.basket, rows),
        // the cursor of a navigation lands together with the rows of its level
        ...(st.pendingCursor !== undefined
          ? { cursor: st.pendingCursor, cursorSeq: st.cursorSeq + 1, pendingCursor: undefined }
          : {}),
      }));
      this.schedulePoll(scanId, view.running);
    } catch (e) {
      if (this.seqs.get(scanId) === seq) {
        const error = toFsError(e);
        // a scan Rust no longer keeps: nothing of it may be deleted any more (review 033 #6)
        const gone = error.code === 'scan_not_found';
        this.patch(scanId, (st) =>
          gone ? { ...st, error, rows: [], chart: null, basket: new Map() } : { ...st, error },
        );
        this.schedulePoll(scanId, false);
      }
    }
  }

  private schedulePoll(scanId: string, running: boolean): void {
    const old = this.timers.get(scanId);
    if (old !== undefined) {
      clearTimeout(old);
      this.timers.delete(scanId);
    }
    if (running) {
      this.timers.set(
        scanId,
        setTimeout(() => {
          this.timers.delete(scanId);
          void this.refresh(scanId);
        }, this.pollMs),
      );
    }
  }

  // ---- navigation ----

  private go(
    scanId: string,
    node: number | null,
    history: 'push' | 'back' | 'forward' | 'none',
    cursor: string | null,
  ): Promise<void> {
    this.patch(scanId, (s) => {
      let { back, forward } = s;
      if (history === 'push') {
        back = [...back, s.node];
        forward = [];
      } else if (history === 'back') {
        back = back.slice(0, -1);
        forward = [...forward, s.node];
      } else if (history === 'forward') {
        forward = forward.slice(0, -1);
        back = [...back, s.node];
      }
      return { ...s, node, back, forward, mode: 'all', pendingCursor: cursor };
    });
    return this.refresh(scanId);
  }

  /** Enter on a row: a folder opens inside the scan; false = not handled here (a file). */
  async open(scanId: string, entry: DirEntry): Promise<boolean> {
    const s = this.state(scanId);
    if (!s) {
      return true;
    }
    if (isParentRow(entry)) {
      await this.up(scanId);
      return true;
    }
    const u = usageOf(entry);
    if (!u || u.virtual) {
      return true;
    }
    if (u.kind === 'mount') {
      this.jobs.report(USAGE_TEXTS.mountNotScanned);
      return true;
    }
    if (u.kind === 'dir') {
      if (s.mode === 'largest') {
        return true;
      }
      await this.go(scanId, u.id, 'push', null);
      return true;
    }
    if (isVirtualPath(entry.path)) {
      // a lossy name: opening would hit another path (review 033 #7)
      return true;
    }
    if (s.mode === 'largest' && u.ancestors.length > 0) {
      // "largest files": Enter goes to the file's folder, the cursor on the file
      await this.go(scanId, u.ancestors[u.ancestors.length - 1], 'push', entry.path);
      return true;
    }
    return false;
  }

  /** One level up; the cursor goes to the folder we came from. */
  async up(scanId: string): Promise<void> {
    const s = this.state(scanId);
    const crumbs = s?.view?.crumbs ?? [];
    if (!s || crumbs.length < 2) {
      return;
    }
    const from = s.view?.node.path ?? null;
    await this.go(scanId, crumbs[crumbs.length - 2].id, 'push', from);
  }

  /** A breadcrumb (or the centre of the rings) was chosen. */
  async goTo(scanId: string, node: number): Promise<void> {
    const s = this.state(scanId);
    if (!s || (s.view?.node.id === node && s.mode === 'all')) {
      return;
    }
    await this.go(scanId, node, 'push', null);
  }

  async back(scanId: string): Promise<void> {
    const s = this.state(scanId);
    if (s && s.back.length > 0) {
      await this.go(scanId, s.back[s.back.length - 1], 'back', s.view?.node.path ?? null);
    }
  }

  async forward(scanId: string): Promise<void> {
    const s = this.state(scanId);
    if (s && s.forward.length > 0) {
      await this.go(scanId, s.forward[s.forward.length - 1], 'forward', null);
    }
  }

  /** "Everything" ↔ "Largest files" of the shown node. */
  async setMode(scanId: string, mode: UsageMode): Promise<void> {
    const s = this.state(scanId);
    if (!s || s.mode === mode) {
      return;
    }
    this.patch(scanId, (st) => ({ ...st, mode, pendingCursor: null }));
    await this.refresh(scanId);
  }

  navigator(scanId: string): UsageNavigator {
    return {
      open: (e) => this.open(scanId, e),
      up: () => this.up(scanId),
      back: () => this.back(scanId),
      forward: () => this.forward(scanId),
      canBack: () => (this.state(scanId)?.back.length ?? 0) > 0,
      canForward: () => (this.state(scanId)?.forward.length ?? 0) > 0,
      refresh: () => this.rescan(scanId),
    };
  }

  /** Path of the ".." row: only below the top node. */
  parentPath(scanId: string): string | null {
    const crumbs = this.state(scanId)?.view?.crumbs ?? [];
    return crumbs.length > 1 ? upPath(scanId) : null;
  }

  // ---- scan control ----

  isRunning(scanId: string): boolean {
    return this.state(scanId)?.view?.running ?? true;
  }

  stop(scanId: string): void {
    void this.jobs.cancel(scanId);
  }

  /** Scans the shown folder again (job `diskUsage` with `rescan`); not the virtual top. */
  async rescan(scanId: string): Promise<void> {
    const s = this.state(scanId);
    const node = s?.view?.node;
    if (!s || !node || node.path === null || s.view?.running) {
      return;
    }
    let id: string;
    try {
      id = await this.jobs.start({
        kind: 'diskUsage',
        roots: [],
        rescan: { scanId, nodeId: node.id },
      });
    } catch (e) {
      this.jobs.report(errorText(toFsError(e)));
      return;
    }
    void this.refresh(scanId);
    const job = await this.jobs.whenFinished(id);
    if (job.state === 'failed' && job.summary?.error) {
      this.jobs.report(errorText(job.summary.error));
    } else if (job.state === 'done') {
      // what is inside got new ids: its marks would point to nothing (review 033 #2)
      this.patch(scanId, (st) => ({
        ...st,
        basket: new Map([...st.basket].filter(([, r]) => !r.usage.ancestors.includes(node.id))),
      }));
    }
    await this.refresh(scanId);
  }

  canRescan(scanId: string): boolean {
    const v = this.state(scanId)?.view;
    return !!v && !v.running && v.node.path !== null;
  }

  async release(scanId: string): Promise<void> {
    const t = this.timers.get(scanId);
    if (t !== undefined) {
      clearTimeout(t);
      this.timers.delete(scanId);
    }
    this.seqs.delete(scanId);
    this.states.update((m) => {
      const next = new Map(m);
      next.delete(scanId);
      return next;
    });
    try {
      await this.api.release(scanId);
    } catch {
      // gone already
    }
  }

  // ---- basket ----

  /** The list's marks of the shown level changed (Space, Insert, mark all …). */
  setLevelMarks(scanId: string, marked: ReadonlySet<string>): void {
    const s = this.state(scanId);
    if (!s) {
      return;
    }
    const next = withLevelMarks(s.basket, s.rows, marked);
    if (!sameKeys(next, s.basket)) {
      this.patch(scanId, (st) => ({ ...st, basket: next }));
    }
  }

  /** Paths of the shown level that are in the basket (marks of the list). */
  levelMarks(scanId: string): ReadonlySet<string> {
    const s = this.state(scanId);
    if (!s) {
      return new Set();
    }
    return new Set(s.rows.filter((r) => s.basket.has(r.usage.id)).map((r) => r.path));
  }

  unmark(scanId: string, id: number): void {
    this.patch(scanId, (s) => {
      const basket = new Map(s.basket);
      basket.delete(id);
      return { ...s, basket };
    });
  }

  clearBasket(scanId: string): void {
    this.patch(scanId, (s) => ({ ...s, basket: new Map() }));
  }

  /** What the delete job compares (design 030 E5): always – a scan is an old state. */
  expected(entries: readonly DirEntry[]): ExpectedEntry[] {
    return entries.map((e) => {
      const u = usageOf(e);
      const isFile = e.kind === 'file';
      return {
        path: e.path,
        kind: e.kind,
        // the size the file reports (the list may show blocks); 0 = a hard link counted elsewhere
        size: isFile && u && u.logical > 0 ? u.logical : null,
        modifiedMs: isFile ? (e.modifiedMs ?? null) : null,
      };
    });
  }

  /** After a delete or move job: drop what is gone from the tree and the basket. */
  async afterRemoval(scanId: string, done: readonly string[]): Promise<void> {
    if (!this.state(scanId) || done.length === 0) {
      return;
    }
    let went: readonly string[] = [];
    try {
      went = await this.api.prune(scanId, done);
    } catch (e) {
      this.jobs.report(errorText(toFsError(e)));
    }
    // only what is really gone leaves the basket (review 033 #10)
    const gone = new Set(went);
    this.patch(scanId, (s) => ({ ...s, basket: withoutPaths(s.basket, gone) }));
    await this.refresh(scanId);
  }

  /** Minutes since the scan started (shown in the delete dialog). */
  ageMinutes(scanId: string, now = Date.now()): number {
    const at = this.state(scanId)?.view?.scannedAtMs ?? this.state(scanId)?.startedAt ?? now;
    return Math.max(0, Math.floor((now - at) / 60_000));
  }

  sizeMode(scanId: string): SizeMode {
    return this.state(scanId)?.view?.sizeMode ?? 'allocated';
  }
}

function sameKeys(a: ReadonlyMap<number, unknown>, b: ReadonlyMap<number, unknown>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const k of a.keys()) {
    if (!b.has(k)) {
      return false;
    }
  }
  return true;
}

/** Basket rows that are shown again get their fresh values (sizes grow while scanning). */
function refreshBasket(
  basket: ReadonlyMap<number, UsageRow>,
  rows: readonly UsageRow[],
): ReadonlyMap<number, UsageRow> {
  if (basket.size === 0) {
    return basket;
  }
  let next: Map<number, UsageRow> | null = null;
  for (const r of rows) {
    const old = basket.get(r.usage.id);
    if (old && old !== r && old.path === r.path) {
      next ??= new Map(basket);
      next.set(r.usage.id, r);
    }
  }
  return next ?? basket;
}
