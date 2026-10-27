import { computed, inject, Injectable, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { JobInfo } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { Side } from '../../core/session/session.models';
import { SettingsStore } from '../../core/settings/settings.store';
import {
  CompareOptions,
  CompareRow,
  CompareStats,
  EMPTY_COMPARE_STATS,
} from '../../core/sync/sync.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { recallDialog, rememberDialog } from '../../shared/dialog-memory';
import { boolOr, intOr, oneOf, record, textOr } from '../../shared/restore-fields';
import { WorkspaceStore } from '../workspace/workspace.store';
import { quickCompare } from './quick-compare';
import {
  applyAction,
  buildOps,
  buildTree,
  DEFAULT_VIEW,
  defaultActions,
  nextAction,
  RowAction,
  sums,
  SyncMode,
  ViewFilter,
  visibleIndexes,
} from './sync-logic';
import { SYNC_TEXTS } from './sync-texts';

/** Options of the dialog: the comparison plus how the actions are suggested. */
export interface SyncForm extends CompareOptions {
  readonly mode: SyncMode;
  readonly mirror: boolean;
  /** Deletes go to the trash (default) – else permanently. */
  readonly trash: boolean;
}

export function defaultSyncForm(ignoreCase: boolean, hidden: boolean): SyncForm {
  return {
    recursive: true,
    content: false,
    ignoreDate: false,
    toleranceSecs: 2,
    ignoreHour: false,
    ignoreCase,
    hidden,
    filter: '',
    exclude: '.git; node_modules',
    mode: 'both',
    mirror: false,
    trash: true,
  };
}

/** The form kept from the last run (design 027 E5); missing or bad fields take `fallback`. */
export function restoreSyncForm(v: unknown, fallback: SyncForm): SyncForm {
  const r = record(v);
  return {
    recursive: boolOr(r['recursive'], fallback.recursive),
    content: boolOr(r['content'], fallback.content),
    ignoreDate: boolOr(r['ignoreDate'], fallback.ignoreDate),
    toleranceSecs: intOr(r['toleranceSecs'], fallback.toleranceSecs, 0, 86_400),
    ignoreHour: boolOr(r['ignoreHour'], fallback.ignoreHour),
    ignoreCase: boolOr(r['ignoreCase'], fallback.ignoreCase),
    hidden: boolOr(r['hidden'], fallback.hidden),
    filter: textOr(r['filter'], fallback.filter, 1000),
    exclude: textOr(r['exclude'], fallback.exclude, 1000),
    mode: oneOf(r['mode'], ['both', 'leftToRight', 'rightToLeft'] as const, fallback.mode),
    mirror: boolOr(r['mirror'], fallback.mirror),
    trash: boolOr(r['trash'], fallback.trash),
  };
}

function err(message: string): FsError {
  return { code: 'unknown', message, path: null };
}

/** Deletes the summary lists by path. */
const MAX_LISTED_DELETES = 20;

/** UI updates while rows stream in (the table swaps rows at most this often). */
export const SYNC_FLUSH_MS = 250;

export interface FolderPair {
  readonly left: string;
  readonly right: string;
}

/**
 * Compare and synchronise folders (design 036): the quick comparison of both panels
 * (Shift+F2), the dialog with the job `compare` (rows streamed), the actions per row
 * and the job `sync`.
 */
@Injectable({ providedIn: 'root' })
export class SyncStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly dialogs = inject(DialogService);
  private readonly settings = inject(SettingsStore);
  private readonly actionService = inject(ActionService);

  readonly pair = signal<FolderPair | null>(null);
  readonly form = signal<SyncForm>(defaultSyncForm(false, false));
  readonly rows = signal<readonly CompareRow[]>([]);
  readonly tree = computed(() => {
    const s = this.stats();
    return buildTree(this.rows(), s.rootReadError || s.truncated);
  });
  readonly actions = signal<readonly RowAction[]>([]);
  readonly stats = signal<CompareStats>(EMPTY_COMPARE_STATS);
  readonly running = signal(false);
  /** A comparison ran to its end for the current pair and options. */
  readonly compared = signal(false);
  readonly error = signal<string | null>(null);
  readonly view = signal<ViewFilter>(DEFAULT_VIEW);
  /** Indexes into `rows` of what the list shows. */
  readonly shown = computed(() => visibleIndexes(this.rows(), this.view()));
  /** Highlighted row (index into `shown`). */
  readonly active = signal(0);
  readonly confirming = signal(false);
  readonly busy = signal(false);
  readonly sums = computed(() => sums(this.tree(), this.actions()));
  /** What the summary names before deleting (design 036 E4): the first paths and the rest. */
  readonly deletions = computed(() => {
    if (!this.confirming()) {
      return { paths: [] as string[], more: 0 };
    }
    const ops = buildOps(this.tree(), this.actions()).filter(
      (o) => o.action === 'deleteLeft' || o.action === 'deleteRight',
    );
    const paths = ops
      .slice(0, MAX_LISTED_DELETES)
      .map((o) => (o.action === 'deleteLeft' ? o.left.path : o.right.path));
    return { paths, more: ops.length - paths.length };
  });
  readonly canEdit = computed(() => this.compared() && !this.running());
  readonly canSync = computed(() => {
    const s = this.sums();
    return (
      this.canEdit() && !this.busy() && s.toRight + s.toLeft + s.deleteLeft + s.deleteRight > 0
    );
  });

  private recalled = false;
  /** The user changed an action: new defaults must not overwrite it. */
  private edited = false;
  private jobId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private all: CompareRow[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** A sync ran since the last comparison: opening again compares again. */
  private stale = false;

  /** Both panels show a local folder (no archive, server, result or usage tab). */
  available(): boolean {
    return this.sides() !== null;
  }

  private sides(): FolderPair | null {
    const ok = (side: Side): string | null => {
      const store = this.ws.panel(side)?.store;
      if (!store || store.searchKey() !== null || store.archive() !== null) {
        return null;
      }
      if (store.remote() !== null || store.isUsage()) {
        return null;
      }
      return store.path();
    };
    const left = ok('left');
    const right = ok('right');
    return left !== null && right !== null ? { left, right } : null;
  }

  /** Both sides show a folder or archive listing (results and usage tabs have no folder). */
  quickAvailable(): boolean {
    const ok = (side: Side) => {
      const s = this.ws.panel(side)?.store;
      return !!s && s.path() !== null && s.searchKey() === null && !s.isUsage();
    };
    return ok('left') && ok('right');
  }

  /** Shift+F2: marks the differences of the top level in both panels (design 036 E1). */
  quickCompare(): void {
    const l = this.ws.panel('left')?.store;
    const r = this.ws.panel('right')?.store;
    if (!l || !r || l.path() === null || r.path() === null) {
      throw err(SYNC_TEXTS.noFolders);
    }
    const ignoreCase = this.actionService.platform() !== 'linux';
    // what the panels show: hidden or filtered entries are neither compared nor marked
    const res = quickCompare(l.visibleEntries(), r.visibleEntries(), ignoreCase);
    l.clearMarks();
    r.clearMarks();
    l.setMarked(res.left, true);
    r.setMarked(res.right, true);
    this.jobs.report(
      res.left.length + res.right.length === 0
        ? SYNC_TEXTS.quickEqual
        : SYNC_TEXTS.quickMarked(res.left.length, res.right.length),
    );
  }

  open(): void {
    const pair = this.sides();
    if (!pair) {
      throw err(SYNC_TEXTS.notHere);
    }
    const fallback = defaultSyncForm(
      this.actionService.platform() !== 'linux',
      this.ws.panel()?.store.hiddenVisible() ?? false,
    );
    if (!this.recalled) {
      this.recalled = true;
      const kept = recallDialog(this.settings, 'sync');
      this.form.set(kept === undefined ? fallback : restoreSyncForm(kept, fallback));
    }
    const prev = this.pair();
    const same = prev !== null && prev.left === pair.left && prev.right === pair.right;
    this.pair.set(pair);
    this.confirming.set(false);
    this.error.set(null);
    if (!same) {
      this.reset();
    }
    this.dialogs.show('sync');
    // nothing compared yet, or the folders changed by a sync: compare right away
    if (!same || this.stale || (!this.compared() && !this.running())) {
      void this.compare();
    }
  }

  close(): void {
    this.stop();
    this.confirming.set(false);
    this.dialogs.close();
  }

  swap(): void {
    const p = this.pair();
    if (p) {
      this.pair.set({ left: p.right, right: p.left });
      this.reset();
    }
  }

  update(patch: Partial<SyncForm>): void {
    const before = this.form();
    const next = { ...before, ...patch };
    this.form.set(next);
    const onlySuggestion = Object.keys(patch).every((k) => k === 'mode' || k === 'mirror');
    if (onlySuggestion) {
      // other suggestions for the same rows; choices made by hand go
      this.edited = false;
      this.actions.set(defaultActions(this.tree(), next.mode, next.mirror));
    } else if (!Object.keys(patch).every((k) => k === 'trash')) {
      this.compared.set(false); // the rows no longer match the options
    }
  }

  setView(patch: Partial<ViewFilter>): void {
    this.view.set({ ...this.view(), ...patch });
    this.active.set(0);
  }

  private reset(): void {
    this.stop();
    this.all = [];
    this.rows.set([]);
    this.actions.set([]);
    this.stats.set(EMPTY_COMPARE_STATS);
    this.compared.set(false);
    this.active.set(0);
    this.edited = false;
    this.stale = false;
  }

  async compare(): Promise<void> {
    const pair = this.pair();
    if (!pair) {
      return;
    }
    this.reset();
    this.error.set(null);
    const f = this.form();
    const options: CompareOptions = {
      recursive: f.recursive,
      content: f.content,
      ignoreDate: f.ignoreDate,
      toleranceSecs: f.toleranceSecs,
      ignoreHour: f.ignoreHour,
      ignoreCase: f.ignoreCase,
      hidden: f.hidden,
      filter: f.filter,
      exclude: f.exclude,
    };
    this.running.set(true);
    let id: string;
    try {
      id = await this.jobs.start({ kind: 'compare', left: pair.left, right: pair.right, options });
    } catch (e) {
      this.running.set(false);
      this.error.set(errorText(toFsError(e)));
      return;
    }
    rememberDialog(this.settings, 'sync', this.form());
    this.jobId = id;
    this.unsubscribe = this.jobs.onCompareRows(id, (rows, stats) => {
      if (this.jobId !== id) {
        return; // an older comparison
      }
      for (const r of rows) {
        this.all.push(r);
      }
      this.stats.set(stats);
      this.scheduleFlush();
    });
    const job = await this.jobs.whenFinished(id);
    if (this.jobId !== id) {
      return;
    }
    this.finishCompare(job);
  }

  private finishCompare(job: JobInfo): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.jobId = null;
    const final = job.summary?.compare;
    if (final) {
      this.stats.set({ ...final, errors: job.summary?.errors ?? [] });
    }
    // after the final statistics: they decide which deletes are possible (review 036 #2)
    this.flush();
    this.running.set(false);
    if (job.state === 'failed') {
      this.error.set(
        SYNC_TEXTS.compareFailed(job.summary?.error ? errorText(job.summary.error) : ''),
      );
      return;
    }
    // a stopped comparison shows what it found, but nothing is executed from half a list
    this.compared.set(job.state === 'done' || job.state === 'doneWithErrors');
  }

  private scheduleFlush(): void {
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(), SYNC_FLUSH_MS);
    }
  }

  private flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.rows.set(this.all.slice());
    if (!this.edited) {
      const f = this.form();
      this.actions.set(defaultActions(this.tree(), f.mode, f.mirror));
    }
  }

  stop(): void {
    const id = this.jobId;
    if (id !== null) {
      this.jobId = null;
      this.unsubscribe?.();
      this.unsubscribe = null;
      void this.jobs.cancel(id);
      this.flush();
      this.running.set(false);
    }
  }

  /** The row under the highlight (index into `rows`), `-1` = none. */
  activeRow(): number {
    return this.shown()[this.active()] ?? -1;
  }

  moveActive(to: number): void {
    const n = this.shown().length;
    this.active.set(n === 0 ? 0 : Math.max(0, Math.min(n - 1, to)));
  }

  /** Sets the action of the row `index` (into `rows`). */
  setAction(index: number, action: RowAction): void {
    if (!this.canEdit() || index < 0) {
      return;
    }
    const out = [...this.actions()];
    if (applyAction(this.tree(), out, index, action)) {
      this.edited = true;
      this.actions.set(out);
    }
  }

  cycle(index: number): void {
    const row = this.rows()[index];
    if (row) {
      const tree = this.tree();
      this.setAction(
        index,
        nextAction(row, this.actions()[index] ?? 'none', tree.noDelete[index] === 1),
      );
    }
  }

  /** Del: delete the side that has the entry; both have it → right first, then left. */
  toggleDelete(index: number): void {
    const row = this.rows()[index];
    if (!row) {
      return;
    }
    const now = this.actions()[index];
    const next: RowAction =
      row.left && row.right
        ? now === 'deleteRight'
          ? 'deleteLeft'
          : 'deleteRight'
        : row.left
          ? 'deleteLeft'
          : 'deleteRight';
    this.setAction(index, next);
  }

  /** The same action for every shown row that allows it. */
  applyToShown(action: RowAction): void {
    if (!this.canEdit()) {
      return;
    }
    const tree = this.tree();
    const out = [...this.actions()];
    for (const i of this.shown()) {
      applyAction(tree, out, i, action);
    }
    this.edited = true;
    this.actions.set(out);
  }

  askSync(): void {
    if (this.canSync()) {
      this.confirming.set(true);
    }
  }

  back(): void {
    this.confirming.set(false);
  }

  async runSync(): Promise<void> {
    const pair = this.pair();
    if (!pair || !this.canSync()) {
      return;
    }
    const ops = buildOps(this.tree(), this.actions());
    this.busy.set(true);
    let id: string;
    try {
      id = await this.jobs.start({
        kind: 'sync',
        left: pair.left,
        right: pair.right,
        ops,
        deleteMode: this.form().trash ? 'trash' : 'permanent',
      });
    } catch (e) {
      this.busy.set(false);
      this.error.set(errorText(toFsError(e)));
      this.confirming.set(false);
      return;
    }
    rememberDialog(this.settings, 'sync', this.form());
    this.busy.set(false);
    this.stale = true;
    this.compared.set(false);
    this.confirming.set(false);
    this.dialogs.close();
    void this.jobs.whenFinished(id).then((job) => {
      const s = job.summary;
      if (job.state === 'failed') {
        this.jobs.report(SYNC_TEXTS.syncFailed(s?.error ? errorText(s.error) : ''));
      } else if (s && job.state !== 'cancelled') {
        this.jobs.report(SYNC_TEXTS.synced(s.itemsDone, s.itemsFailed));
      }
    });
  }
}
