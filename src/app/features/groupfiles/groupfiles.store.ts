import { computed, inject, Injectable, signal } from '@angular/core';
import { toFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError, isParentRow } from '../../core/fs/fs.models';
import { GroupItem, JobInfo } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { Side } from '../../core/session/session.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { selectionInDisplayOrder } from '../multirename/multirename-logic';
import { SearchStore } from '../search/search.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { DEFAULT_GROUP_OPTIONS, groupEntries, GroupOptions, GroupStatus } from './group-engine';
import { GF_TEXTS } from './groupfiles-texts';

export interface GroupRequest {
  readonly side: Side;
  readonly sourceDir: string;
  /** The other side's folder (default root), `null` if it shows none. */
  readonly otherDir: string | null;
  readonly entries: readonly DirEntry[];
  /** Set when the entries come from a result tab (design 009 E4). */
  readonly searchKey: string | null;
}

export interface GroupRow {
  readonly nr: number;
  readonly path: string;
  readonly name: string;
  readonly group: string;
  readonly info: string;
  readonly status: GroupStatus;
}

function err(message: string): FsError {
  return { code: 'unknown', message, path: null };
}

/**
 * Entries to group (design 008 E1): the marked ones, otherwise every entry the
 * list shows (one file alone makes no group) – never "..".
 */
export function groupSelection(
  marked: readonly DirEntry[],
  displayed: readonly DirEntry[],
): readonly DirEntry[] {
  const m = selectionInDisplayOrder(marked, null, displayed);
  return m.length > 0 ? m : displayed.filter((e) => !isParentRow(e));
}

/**
 * Group files (OPEN_GROUPFILES_DLG, design 008): the request, the options (kept
 * for the session), the preview from the pure engine and the `group` job.
 */
@Injectable({ providedIn: 'root' })
export class GroupFilesStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly dialogs = inject(DialogService);
  private readonly search = inject(SearchStore);

  readonly request = signal<GroupRequest | null>(null);
  readonly options = signal<GroupOptions>(DEFAULT_GROUP_OPTIONS);
  readonly busy = signal(false);
  readonly runError = signal<FsError | null>(null);

  /** The root the group folders go into. */
  readonly root = computed(() => {
    const req = this.request();
    if (!req) {
      return null;
    }
    return this.options().useSourceDir || req.otherDir === null ? req.sourceDir : req.otherDir;
  });

  readonly outcome = computed(() => {
    const req = this.request();
    return groupEntries(req?.entries.map((e) => e.name) ?? [], this.options());
  });

  readonly rows = computed<readonly GroupRow[]>(() => {
    const req = this.request();
    if (!req) {
      return [];
    }
    const min = this.options().minSize;
    return this.outcome().results.map((r, i) => {
      const e = req.entries[i];
      const info =
        r.status === 'ok'
          ? GF_TEXTS.infoOk
          : r.status === 'none'
            ? GF_TEXTS.infoNone
            : r.status === 'small'
              ? GF_TEXTS.infoSmall(min)
              : (r.error ?? '');
      return {
        nr: i + 1,
        path: e.path,
        name: e.name,
        group: r.group ?? '',
        info,
        status: r.status,
      };
    });
  });

  readonly items = computed<readonly GroupItem[]>(() =>
    this.rows()
      .filter((r) => r.status === 'ok')
      .map((r) => ({ path: r.path, group: r.group })),
  );

  readonly canRun = computed(() => !this.busy() && this.root() !== null && this.items().length > 0);

  /** A folder or a result tab (its hits have full paths; root = the searched folder). */
  hasFolder(): boolean {
    return this.ws.actionDir() !== null;
  }

  open(): void {
    const side = this.ws.source();
    const panel = this.ws.panel(side);
    const sourceDir = this.ws.actionDir(side);
    if (!panel || sourceDir === null) {
      throw err(GF_TEXTS.noFolder);
    }
    const displayed = panel.controller()?.displayedEntries() ?? panel.store.visibleEntries();
    const entries = groupSelection(panel.store.markedEntries(), displayed);
    if (entries.length === 0) {
      throw err(GF_TEXTS.nothingSelected);
    }
    const otherDir = this.ws.targetDir(side);
    this.runError.set(null);
    this.busy.set(false);
    const searchKey = panel.store.searchKey();
    this.request.set({ side, sourceDir, otherDir, entries, searchKey });
    this.dialogs.show('group-files');
  }

  update(patch: Partial<GroupOptions>): void {
    this.options.set({ ...this.options(), ...patch });
    this.runError.set(null);
  }

  close(): void {
    this.request.set(null);
    this.dialogs.close();
  }

  /** Starts the group job; the dialog closes. Errors stay in the dialog. */
  async run(transfer: 'copy' | 'move'): Promise<void> {
    const req = this.request();
    const root = this.root();
    const items = this.items();
    if (!req || root === null || !this.canRun()) {
      return;
    }
    this.busy.set(true);
    let id: string;
    try {
      id = await this.jobs.start({ kind: 'group', root, items, transfer });
    } catch (e) {
      this.runError.set(toFsError(e));
      this.busy.set(false);
      return;
    }
    this.close();
    this.busy.set(false);
    void this.jobs.whenFinished(id).then((job) => this.afterJob(job, req, items, transfer));
  }

  private afterJob(
    job: JobInfo,
    req: GroupRequest,
    items: readonly GroupItem[],
    transfer: 'copy' | 'move',
  ): void {
    const summary = job.summary;
    if (job.state === 'failed') {
      this.jobs.report(GF_TEXTS.failed(summary?.error?.message ?? ''));
    } else if (job.state === 'doneWithErrors' && summary) {
      this.jobs.report(GF_TEXTS.withErrors(summary.itemsFailed));
    } else if (job.state === 'done' && summary) {
      // entries already in their group are skipped – count what really happened
      this.jobs.report(GF_TEXTS.done(summary.itemsDone));
    }
    if (job.state === 'failed') {
      return;
    }
    const failed = new Set(summary?.errors.map((e) => e.path) ?? []);
    const done = items.map((i) => i.path).filter((p) => !failed.has(p));
    // moved away from a result tab: they leave the result (as Move does, design 009 E4)
    if (req.searchKey !== null && transfer === 'move') {
      this.search.removePaths(req.searchKey, done);
    }
    const store = this.ws.panel(req.side)?.store;
    if (store && this.ws.actionDir(req.side) === req.sourceDir) {
      store.setMarked(done, false);
    }
  }
}
