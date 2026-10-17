import { computed, inject, Injectable, signal } from '@angular/core';
import { toFsError } from '../../core/fs/fs-error';
import { FsError, isNavigableDir } from '../../core/fs/fs.models';
import { JobInfo } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { RenameApi } from '../../core/rename/rename-api';
import {
  EMPTY_PRESETS,
  RenameItem,
  RenamePlan,
  RenamePresets,
} from '../../core/rename/rename.models';
import { Side } from '../../core/session/session.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { recordPerf, since } from '../../shared/perf';
import { WorkspaceStore } from '../workspace/workspace.store';
import {
  parentNames,
  PreviewFilter,
  previewRows,
  selectionInDisplayOrder,
  summarize,
} from './multirename-logic';
import { MR_TEXTS } from './multirename-texts';
import {
  compileRules,
  DEFAULT_RULES,
  isRuleErrors,
  newName,
  RenameRules,
  RenameSource,
  RuleError,
  sanitizeRules,
} from './rename-engine';

/** Rust checks the names this long after the last change (design 007 E5). */
export const PLAN_DEBOUNCE_MS = 120;
export const MAX_PRESETS = 100;

export interface MrSource extends RenameSource {
  readonly path: string;
}

export interface MrRequest {
  readonly side: Side;
  readonly folder: string;
  readonly sources: readonly MrSource[];
}

function err(message: string): FsError {
  return { code: 'unknown', message, path: null };
}

/**
 * Multi-rename (design 007): the selection in display order, the rules, the
 * preview (names from the TS engine at once, Rust's check debounced and
 * matched to the names it belongs to), presets, the rename job and its undo.
 */
@Injectable({ providedIn: 'root' })
export class MultiRenameStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly api = inject(RenameApi);
  private readonly dialogs = inject(DialogService);

  readonly request = signal<MrRequest | null>(null);
  readonly rules = signal<RenameRules>(DEFAULT_RULES);
  readonly presets = signal<RenamePresets>(EMPTY_PRESETS);
  readonly filter = signal<PreviewFilter>('all');
  readonly busy = signal(false);
  /** The job could not be started (shown in the dialog). */
  readonly runError = signal<FsError | null>(null);
  /** The check itself failed (no backend …). */
  readonly planError = signal<FsError | null>(null);
  private readonly planned = signal<{
    readonly items: readonly RenameItem[];
    readonly plan: RenamePlan;
  } | null>(null);
  private presetsLoaded = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  readonly compiled = computed(() => compileRules(this.rules()));
  readonly ruleErrors = computed<readonly RuleError[]>(() => {
    const c = this.compiled();
    return isRuleErrors(c) ? c : [];
  });
  readonly unknownTokens = computed(() => {
    const c = this.compiled();
    return isRuleErrors(c) ? [] : c.unknown;
  });

  /** The pairs for Rust – `null` while a rule is broken. A new array per change. */
  readonly items = computed<readonly RenameItem[] | null>(() => {
    const req = this.request();
    const c = this.compiled();
    if (!req || isRuleErrors(c)) {
      return null;
    }
    const start = performance.now();
    const items = req.sources.map((s, i) => ({ path: s.path, newName: newName(c, s, i) }));
    if (items.length >= 1000) {
      recordPerf('multi-rename names', since(start), `${items.length} entries`);
    }
    return items;
  });

  readonly rows = computed(() => {
    const req = this.request();
    if (!req) {
      return [];
    }
    const errors = this.ruleErrors();
    return previewRows(
      req.sources,
      this.items(),
      errors.length > 0 ? errors.map((e) => e.message).join(' · ') : null,
      this.planned(),
    );
  });
  readonly summary = computed(() => summarize(this.rows()));
  /** Rust checked exactly these names. */
  readonly checked = computed(() => {
    const items = this.items();
    return items !== null && this.planned()?.items === items;
  });
  readonly canRun = computed(() => {
    const s = this.summary();
    return !this.busy() && this.checked() && s.errors === 0 && s.pending === 0 && s.ok > 0;
  });

  /** Enabled rule of the action: a folder and at least one entry. */
  hasSelection(): boolean {
    const panel = this.ws.panel();
    if (!panel || panel.store.path() === null) {
      return false;
    }
    return (
      selectionInDisplayOrder(panel.store.markedEntries(), panel.store.cursorEntry(), null).length >
      0
    );
  }

  async open(): Promise<void> {
    const side = this.ws.source();
    const panel = this.ws.panel(side);
    const folder = panel?.store.path() ?? null;
    if (!panel || folder === null) {
      throw err(MR_TEXTS.noFolder);
    }
    const entries = selectionInDisplayOrder(
      panel.store.markedEntries(),
      panel.store.cursorEntry(),
      panel.controller()?.displayedEntries() ?? null,
    );
    if (entries.length === 0) {
      throw err(MR_TEXTS.nothingSelected);
    }
    const parents = parentNames(panel.store.listing()?.segments ?? []);
    const sources: MrSource[] = entries.map((e) => ({
      path: e.path,
      name: e.name,
      isDir: isNavigableDir(e),
      modifiedMs: e.modifiedMs,
      parents,
    }));
    await this.loadPresets();
    const last = this.presets().last;
    this.rules.set(last ? sanitizeRules(last) : DEFAULT_RULES);
    this.planned.set(null);
    this.planError.set(null);
    this.runError.set(null);
    this.filter.set('all');
    this.busy.set(false);
    this.request.set({ side, folder, sources });
    this.dialogs.show('multi-rename');
    this.schedulePlan(0);
  }

  close(): void {
    this.cancelTimer();
    this.seq++; // answers still on their way are stale now
    this.request.set(null);
    this.planned.set(null);
    this.dialogs.close();
  }

  setRules(rules: RenameRules): void {
    this.rules.set(rules);
    this.runError.set(null);
    this.schedulePlan();
  }

  update(patch: Partial<RenameRules>): void {
    this.setRules({ ...this.rules(), ...patch });
  }

  // ---- Rust check ----

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedulePlan(delay = PLAN_DEBOUNCE_MS): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.checkNow();
    }, delay);
  }

  /** Asks Rust about the current names; an older answer never replaces a newer one. */
  async checkNow(): Promise<void> {
    const items = this.items();
    if (items === null || this.request() === null) {
      return;
    }
    const seq = ++this.seq;
    const start = performance.now();
    try {
      const plan = await this.api.plan(items);
      if (seq !== this.seq) {
        return;
      }
      if (items.length >= 1000) {
        recordPerf('multi-rename plan_rename', since(start), `${items.length} entries`);
      }
      this.planError.set(null);
      this.planned.set({ items, plan });
    } catch (e) {
      if (seq === this.seq) {
        this.planError.set(toFsError(e));
      }
    }
  }

  // ---- run and undo ----

  /** Starts the rename job; the dialog closes. Errors stay in the dialog. */
  async run(): Promise<void> {
    const req = this.request();
    const items = this.items();
    if (!req || !items || !this.canRun()) {
      return;
    }
    this.busy.set(true);
    const renamed = new Map<string, string>();
    this.rows().forEach((r) => {
      if (r.status === 'ok') {
        renamed.set(r.path, r.newName);
      }
    });
    let id: string;
    try {
      id = await this.jobs.start({ kind: 'rename', items });
    } catch (e) {
      this.runError.set(toFsError(e));
      this.busy.set(false);
      return;
    }
    void this.saveLast(this.rules());
    this.close();
    this.busy.set(false);
    void this.jobs.whenFinished(id).then((job) => this.afterJob(job, req, renamed));
  }

  /** Unmarks the renamed entries, the cursor follows its entry, reports the result. */
  private async afterJob(
    job: JobInfo,
    req: MrRequest,
    renamed: Map<string, string>,
  ): Promise<void> {
    const store = this.ws.panel(req.side)?.store;
    const summary = job.summary;
    if (job.state === 'failed') {
      this.jobs.report(MR_TEXTS.failed(summary?.error?.message ?? ''));
    } else if (job.state === 'doneWithErrors' && summary) {
      this.jobs.report(MR_TEXTS.withErrors(summary.itemsFailed));
    } else if (job.state === 'done' && summary) {
      this.jobs.report(MR_TEXTS.done(summary.itemsDone));
    }
    if (!store || store.path() !== req.folder || job.state === 'failed') {
      return;
    }
    const cursor = store.cursorPath();
    const follow = cursor !== null ? renamed.get(cursor) : undefined;
    store.setMarked([...renamed.keys()], false);
    if (store.navigationLocked()) {
      return;
    }
    await store.refresh();
    if (follow !== undefined && store.path() === req.folder) {
      // the new path comes from the listing (Rust), never from joining strings
      const entry = store.entries().find((e) => e.name === follow);
      if (entry) {
        store.setCursor(entry.path);
      }
    }
  }

  /** Undoes a rename job (`null` = the last one). */
  async undo(jobId: string | null): Promise<void> {
    try {
      await this.api.undo(jobId);
    } catch (e) {
      this.jobs.report(MR_TEXTS.undoFailed(toFsError(e).message));
    }
  }

  // ---- presets (design 007 E9) ----

  private async loadPresets(): Promise<void> {
    if (this.presetsLoaded) {
      return;
    }
    this.presetsLoaded = true;
    try {
      const loaded = await this.api.loadPresets();
      this.presets.set(loaded.presets);
      if (loaded.warning) {
        this.jobs.report(loaded.warning);
      }
    } catch {
      // no presets (browser without backend): defaults
    }
  }

  private async store(presets: RenamePresets): Promise<void> {
    this.presets.set(presets);
    try {
      await this.api.savePresets(presets);
    } catch (e) {
      this.jobs.report(toFsError(e).message);
    }
  }

  private saveLast(rules: RenameRules): Promise<void> {
    return this.store({ ...this.presets(), last: rules });
  }

  savePreset(name: string): Promise<void> {
    const n = name.trim();
    if (n === '') {
      return Promise.resolve();
    }
    const rest = this.presets().presets.filter((p) => p.name !== n);
    const presets = [...rest, { name: n, rules: this.rules() }].slice(-MAX_PRESETS);
    return this.store({ ...this.presets(), presets });
  }

  deletePreset(name: string): Promise<void> {
    const presets = this.presets().presets.filter((p) => p.name !== name);
    return this.store({ ...this.presets(), presets });
  }

  applyPreset(name: string | null): void {
    if (name === null) {
      const last = this.presets().last;
      this.setRules(last ? sanitizeRules(last) : DEFAULT_RULES);
      return;
    }
    const preset = this.presets().presets.find((p) => p.name === name);
    if (preset) {
      this.setRules(sanitizeRules(preset.rules));
    }
  }

  reset(): void {
    this.setRules(DEFAULT_RULES);
  }
}
