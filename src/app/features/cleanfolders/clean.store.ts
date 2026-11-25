import { computed, inject, Injectable, signal } from '@angular/core';
import { FoldersApi } from '../../core/folders/folders-api';
import { CleanOptions, CleanScan, RootVerdict } from '../../core/folders/folders.models';
import { toFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { DeleteMode, JobInfo } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { McpGuardService } from '../../core/mcp/mcp-guard.service';
import { ProposalService } from '../../core/mcp/proposal.service';
import { Side } from '../../core/session/session.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { CL_TEXTS } from './clean-texts';
import { SettingsStore } from '../../core/settings/settings.store';
import { recallDialog, rememberDialog } from '../../shared/dialog-memory';
import { formatSize } from '../../shared/format';
import {
  CleanForm,
  cleanInput,
  cleanOptions,
  DEFAULT_CLEAN_FORM,
  detailRows,
  jobItems,
  restoreCleanForm,
  rootRows,
  selectable,
  selection,
  sums,
} from './clean-logic';

export { cleanOptions, DEFAULT_CLEAN_FORM, restoreCleanForm } from './clean-logic';
export type { CleanForm } from './clean-logic';

/** The search runs this long after the last change of an option. */
export const SCAN_DEBOUNCE_MS = 250;

export interface CleanRequest {
  readonly side: Side;
  readonly folder: string;
  readonly roots: readonly string[];
  /** The start folders may go as a whole (marked / under the cursor) – the panel's folder never. */
  readonly includeRoots: boolean;
  /** Marked entries that are no folders: ignored (a hint says so). */
  readonly ignored: number;
  /**
   * An MCP client set the marks or the cursor and the user has not changed them since
   * (design 071 review #2, 077 E9): guarded like a proposal.
   */
  readonly changedBy?: string;
}

function err(message: string): FsError {
  return { code: 'unknown', message, path: null };
}

/**
 * Clean folders (OPEN_DELETE_EMPTY_FOLDERS_DLG, design 008 E3, 077): the start
 * folders, the profile, the search in Rust (debounced, stale answers dropped) with a
 * verdict per start folder, the user's choice of folders and the `clean` job, which
 * decides everything again before deleting.
 */
@Injectable({ providedIn: 'root' })
export class CleanFoldersStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly api = inject(FoldersApi);
  private readonly dialogs = inject(DialogService);
  private readonly settings = inject(SettingsStore);
  private readonly guard = inject(McpGuardService);
  private readonly proposals = inject(ProposalService);
  /** The kept form is read once, at the first opening (design 027 E5). */
  private recalled = false;

  readonly request = signal<CleanRequest | null>(null);
  readonly form = signal<CleanForm>(DEFAULT_CLEAN_FORM);
  readonly mode = signal<DeleteMode>('trash');
  readonly busy = signal(false);
  readonly scanError = signal<FsError | null>(null);
  readonly runError = signal<FsError | null>(null);
  private readonly scanned = signal<{ options: CleanOptions; scan: CleanScan } | null>(null);
  /** Start folders the user took out; survives a new search while the dialog is open. */
  private readonly deselected = signal<ReadonlySet<string>>(new Set());
  /** The row under the cursor of the folder table. */
  readonly active = signal(0);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  /** Id of the search still running in Rust (review 008 #2: cancelled when obsolete). */
  private running: string | null = null;
  /**
   * The user's form while a prepared one is shown (design 045 E4): restored on close,
   * and a prepared form is never kept as the last input.
   */
  private ownForm: CleanForm | null = null;

  readonly options = computed(() =>
    cleanOptions(this.form(), this.request()?.includeRoots ?? false),
  );
  /** The search result belongs to the current options. */
  readonly scan = computed(() => {
    const s = this.scanned();
    return s && s.options === this.options() ? s.scan : null;
  });
  readonly scanning = computed(
    () => this.request() !== null && this.scan() === null && this.scanError() === null,
  );

  /** The start folders that will be cleaned. */
  readonly selected = computed(() => selection(this.scan(), this.deselected()));
  readonly rows = computed(() => rootRows(this.scan(), this.selected(), this.options()));
  readonly activeRoot = computed<RootVerdict | null>(() => {
    const roots = this.scan()?.roots ?? [];
    return roots[Math.min(this.active(), roots.length - 1)] ?? null;
  });
  readonly details = computed(() => detailRows(this.scan(), this.activeRoot(), this.options()));
  readonly sums = computed(() => sums(this.scan(), this.selected()));
  /** Something could be deleted (selected or not). */
  readonly offers = computed(() => (this.scan()?.roots ?? []).some(selectable));
  /**
   * "Only empty folders" found nothing, but files lie in the folders: the profile
   * "release leftovers" may be what the user wants (design 077 E4).
   */
  readonly suggestRelease = computed(() => {
    const scan = this.scan();
    return (
      scan !== null &&
      this.form().profile === 'empty' &&
      !this.offers() &&
      scan.roots.some((r) => r.keepFiles > 0)
    );
  });
  /** Guarded for an MCP client: its button waits until the keyboard was quiet. */
  readonly locked = computed(() => this.proposals.locked(this.request()?.changedBy));
  readonly canRun = computed(
    () => !this.busy() && this.sums().roots > 0 && this.runError() === null && !this.locked(),
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
    const input = cleanInput(folder, store.markedEntries(), store.cursorEntry());
    if (!this.recalled) {
      this.recalled = true;
      const kept = recallDialog(this.settings, 'clean');
      if (kept !== undefined) {
        this.form.set(restoreCleanForm(kept));
      }
    }
    // marks, cursor or folder set by an MCP client decide here what is deleted (design 077 E9)
    const changedBy = this.guard.influence(side, store.marked()) ?? undefined;
    this.show({ side, folder, ...input, ...(changedBy !== undefined ? { changedBy } : {}) });
    if (changedBy !== undefined) {
      this.proposals.watch(); // locked until the keyboard was quiet, like a proposal
    }
  }

  /**
   * Opens the dialog for given start folders – after "group series by season" moved
   * episodes out of their release folders (design 045 E4). The form is the prepared one
   * (the profile "release leftovers"); the user sees the verdicts and confirms, the
   * trash is the default as always.
   */
  openPrepared(side: Side, folder: string, roots: readonly string[], form: CleanForm): void {
    if (roots.length === 0) {
      return;
    }
    if (this.ownForm === null) {
      this.ownForm = this.form();
    }
    this.form.set(form);
    this.show({ side, folder, roots: [...roots], includeRoots: true, ignored: 0 });
  }

  private show(req: CleanRequest): void {
    this.scanned.set(null);
    this.scanError.set(null);
    this.runError.set(null);
    this.busy.set(false);
    this.deselected.set(new Set());
    this.active.set(0);
    this.mode.set('trash'); // the trash is the default every time (CLAUDE.md §4)
    this.request.set(req);
    this.dialogs.show('clean-folders');
    this.schedule(0);
  }

  close(): void {
    this.cancelTimer();
    this.cancelRunning();
    this.seq++;
    this.request.set(null);
    this.scanned.set(null);
    if (this.ownForm !== null) {
      this.form.set(this.ownForm);
      this.ownForm = null;
    }
    this.proposals.release();
    this.dialogs.close();
  }

  update(patch: Partial<CleanForm>): void {
    this.form.set({ ...this.form(), ...patch });
    this.scanError.set(null);
    this.runError.set(null);
    this.schedule();
  }

  /** Moves the cursor of the folder table (clamped). */
  moveActive(index: number): void {
    const n = this.scan()?.roots.length ?? 0;
    this.active.set(Math.max(0, Math.min(n - 1, index)));
  }

  /** Selects or deselects the start folder in row `index`; a folder that stays cannot be selected. */
  toggle(index: number): void {
    const root = this.scan()?.roots[index];
    if (!root || !selectable(root)) {
      return;
    }
    const next = new Set(this.deselected());
    if (!next.delete(root.path)) {
      next.add(root.path);
    }
    this.deselected.set(next);
    this.runError.set(null);
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
        this.moveActive(this.active());
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

  /** Starts the clean job with exactly the entries of the selected folders; the dialog closes. */
  async run(): Promise<void> {
    const req = this.request();
    const scan = this.scan();
    if (!req || !scan || !this.canRun()) {
      return;
    }
    const selected = this.selected();
    const mode = this.mode();
    this.busy.set(true);
    let id: string;
    try {
      id = await this.jobs.start({
        kind: 'clean',
        // as Rust merged them: only the selected ones may be touched
        roots: scan.roots.filter((r) => selected.has(r.path)).map((r) => r.path),
        items: jobItems(scan, selected),
        mode,
        options: this.options(),
      });
    } catch (e) {
      this.runError.set(toFsError(e));
      this.busy.set(false);
      return;
    }
    if (this.ownForm === null) {
      rememberDialog(this.settings, 'clean', this.form());
    }
    if (req.changedBy !== undefined) {
      // the user saw the guarded dialog and confirmed: the selection is theirs now
      this.guard.forget(req.side);
    }
    this.close();
    this.busy.set(false);
    void this.jobs.whenFinished(id).then((job) => this.afterJob(job, mode));
  }

  /**
   * The marks need no care: a folder that went leaves them with the reload, one that
   * stayed keeps its mark (design 077 E8).
   */
  private afterJob(job: JobInfo, mode: DeleteMode): void {
    const s = job.summary;
    if (job.state === 'failed') {
      this.jobs.report(CL_TEXTS.failed(s?.error?.message ?? ''));
    } else if (job.state === 'doneWithErrors' && s) {
      this.jobs.report(CL_TEXTS.withErrors(s.itemsFailed));
    } else if (job.state === 'done' && s) {
      const size = formatSize(s.bytesDone);
      this.jobs.report(
        mode === 'trash'
          ? CL_TEXTS.doneTrash(s.itemsDone, size)
          : CL_TEXTS.donePermanent(s.itemsDone, size),
      );
    }
  }
}
