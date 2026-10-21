import { computed, inject, Injectable, signal } from '@angular/core';
import { FoldersApi } from '../../core/folders/folders-api';
import {
  CleanItem,
  CleanOptions,
  CleanScan,
  DEFAULT_JUNK,
} from '../../core/folders/folders.models';
import { toFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError, isParentRow } from '../../core/fs/fs.models';
import { DeleteMode, JobInfo } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { Side } from '../../core/session/session.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { CL_TEXTS } from './clean-texts';
import { SettingsStore } from '../../core/settings/settings.store';
import { recallDialog, rememberDialog } from '../../shared/dialog-memory';
import { boolOr, record, textOr } from '../../shared/restore-fields';

/** The search runs this long after the last change of an option. */
export const SCAN_DEBOUNCE_MS = 250;

/** What the form shows (texts stay when a switch is off). */
export interface CleanForm {
  readonly emptyDirs: boolean;
  readonly includeRoots: boolean;
  readonly junkOn: boolean;
  readonly junkText: string;
  readonly patternsOn: boolean;
  readonly patternsText: string;
}

export const DEFAULT_CLEAN_FORM: CleanForm = {
  emptyDirs: true,
  includeRoots: false,
  junkOn: false,
  junkText: DEFAULT_JUNK.join('; '),
  patternsOn: false,
  patternsText: '*.bak',
};

/** The form kept from the last run (design 027 E5) – never the delete mode (trash every time). */
export function restoreCleanForm(v: unknown): CleanForm {
  const r = record(v);
  const d = DEFAULT_CLEAN_FORM;
  return {
    emptyDirs: boolOr(r['emptyDirs'], d.emptyDirs),
    includeRoots: boolOr(r['includeRoots'], d.includeRoots),
    junkOn: boolOr(r['junkOn'], d.junkOn),
    junkText: textOr(r['junkText'], d.junkText),
    patternsOn: boolOr(r['patternsOn'], d.patternsOn),
    patternsText: textOr(r['patternsText'], d.patternsText),
  };
}

export interface CleanRequest {
  readonly side: Side;
  readonly folder: string;
  readonly roots: readonly string[];
}

export interface CleanRow {
  readonly nr: number;
  readonly path: string;
  readonly kind: string;
  readonly info: string;
}

function split(text: string): string[] {
  return text
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** The options Rust gets for a form. */
export function cleanOptions(f: CleanForm): CleanOptions {
  return {
    emptyDirs: f.emptyDirs,
    includeRoots: f.emptyDirs && f.includeRoots,
    junk: f.emptyDirs && f.junkOn ? split(f.junkText) : [],
    patterns: f.patternsOn ? split(f.patternsText) : [],
  };
}

/** Start folders: the marked real folders (not links), otherwise the current folder. */
export function cleanRoots(folder: string, marked: readonly DirEntry[]): readonly string[] {
  const dirs = marked.filter((e) => !isParentRow(e) && e.kind === 'directory').map((e) => e.path);
  return dirs.length > 0 ? dirs : [folder];
}

function err(message: string): FsError {
  return { code: 'unknown', message, path: null };
}

/**
 * Clean folders (OPEN_DELETE_EMPTY_FOLDERS_DLG, design 008 E3): the start
 * folders, the form, the search in Rust (debounced, stale answers dropped)
 * and the `clean` job, which checks every entry again before deleting it.
 */
@Injectable({ providedIn: 'root' })
export class CleanFoldersStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly api = inject(FoldersApi);
  private readonly dialogs = inject(DialogService);
  private readonly settings = inject(SettingsStore);
  /** The kept form is read once, at the first opening (design 027 E5). */
  private recalled = false;

  readonly request = signal<CleanRequest | null>(null);
  readonly form = signal<CleanForm>(DEFAULT_CLEAN_FORM);
  readonly mode = signal<DeleteMode>('trash');
  readonly busy = signal(false);
  readonly scanError = signal<FsError | null>(null);
  readonly runError = signal<FsError | null>(null);
  private readonly scanned = signal<{ options: CleanOptions; scan: CleanScan } | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  /** Id of the search still running in Rust (review 008 #2: cancelled when obsolete). */
  private running: string | null = null;

  readonly options = computed(() => cleanOptions(this.form()));
  /** The search result belongs to the current options. */
  readonly scan = computed(() => {
    const s = this.scanned();
    return s && s.options === this.options() ? s.scan : null;
  });
  readonly scanning = computed(
    () => this.request() !== null && this.scan() === null && this.scanError() === null,
  );

  readonly rows = computed<readonly CleanRow[]>(() =>
    (this.scan()?.items ?? []).map((it, i) => ({
      nr: i + 1,
      path: it.path,
      kind: it.kind === 'dir' ? CL_TEXTS.kindDir : CL_TEXTS.kindFile,
      info: it.junk ? CL_TEXTS.junkInside(it.junk) : '',
    })),
  );
  readonly counts = computed(() => {
    const items = this.scan()?.items ?? [];
    const dirs = items.filter((i) => i.kind === 'dir').length;
    return { dirs, files: items.length - dirs };
  });
  readonly canRun = computed(
    () => !this.busy() && (this.scan()?.items.length ?? 0) > 0 && this.runError() === null,
  );

  hasFolder(): boolean {
    return (this.ws.panel()?.store.path() ?? null) !== null;
  }

  open(): void {
    const side = this.ws.source();
    const store = this.ws.panel(side)?.store;
    const folder = store?.path() ?? null;
    if (!store || folder === null) {
      throw err(CL_TEXTS.noFolder);
    }
    const roots = cleanRoots(folder, store.markedEntries());
    if (!this.recalled) {
      this.recalled = true;
      const kept = recallDialog(this.settings, 'clean');
      if (kept !== undefined) {
        this.form.set(restoreCleanForm(kept));
      }
    }
    this.scanned.set(null);
    this.scanError.set(null);
    this.runError.set(null);
    this.busy.set(false);
    this.mode.set('trash'); // the trash is the default every time (CLAUDE.md §4)
    this.request.set({ side, folder, roots });
    this.dialogs.show('clean-folders');
    this.schedule(0);
  }

  close(): void {
    this.cancelTimer();
    this.cancelRunning();
    this.seq++;
    this.request.set(null);
    this.scanned.set(null);
    this.dialogs.close();
  }

  update(patch: Partial<CleanForm>): void {
    this.form.set({ ...this.form(), ...patch });
    this.scanError.set(null);
    this.runError.set(null);
    this.schedule();
  }

  private cancelRunning(): void {
    if (this.running !== null) {
      void this.api.cancelScan(this.running).catch(() => undefined);
      this.running = null;
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delay = SCAN_DEBOUNCE_MS): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.scanNow();
    }, delay);
  }

  /** Searches with the current options; an older answer never replaces a newer one. */
  async scanNow(): Promise<void> {
    const req = this.request();
    if (!req) {
      return;
    }
    const options = this.options();
    this.cancelRunning(); // its answer would be dropped anyway – stop the full scan
    const seq = ++this.seq;
    const id = `clean-${seq}`;
    this.running = id;
    try {
      const scan = await this.api.findEmptyDirs(id, req.roots, options);
      if (seq === this.seq && !scan.cancelled) {
        this.scanned.set({ options, scan });
      }
    } catch (e) {
      if (seq === this.seq) {
        this.scanError.set(toFsError(e));
      }
    } finally {
      if (this.running === id) {
        this.running = null;
      }
    }
  }

  /** Starts the clean job with exactly the listed entries; the dialog closes. */
  async run(): Promise<void> {
    const req = this.request();
    const scan = this.scan();
    if (!req || !scan || !this.canRun()) {
      return;
    }
    const items: readonly CleanItem[] = scan.items;
    this.busy.set(true);
    let id: string;
    try {
      id = await this.jobs.start({
        kind: 'clean',
        roots: req.roots,
        items,
        mode: this.mode(),
        options: this.options(),
      });
    } catch (e) {
      this.runError.set(toFsError(e));
      this.busy.set(false);
      return;
    }
    rememberDialog(this.settings, 'clean', this.form());
    this.close();
    this.busy.set(false);
    void this.jobs.whenFinished(id).then((job) => this.afterJob(job, req));
  }

  private afterJob(job: JobInfo, req: CleanRequest): void {
    const s = job.summary;
    if (job.state === 'failed') {
      this.jobs.report(CL_TEXTS.failed(s?.error?.message ?? ''));
    } else if (job.state === 'doneWithErrors' && s) {
      this.jobs.report(CL_TEXTS.withErrors(s.itemsFailed));
    } else if (job.state === 'done' && s) {
      this.jobs.report(CL_TEXTS.done(s.itemsDone));
    }
    const store = this.ws.panel(req.side)?.store;
    if (store && store.path() === req.folder && !store.navigationLocked()) {
      store.setMarked([...req.roots], false);
    }
  }
}
