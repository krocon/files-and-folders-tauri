import { computed, inject, Injectable, signal } from '@angular/core';
import { FoldersApi } from '../../core/folders/folders-api';
import { DEFAULT_JUNK, FileTree } from '../../core/folders/folders.models';
import { toFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { GroupItem, JobInfo } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { Side } from '../../core/session/session.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { recallDialog, rememberDialog } from '../../shared/dialog-memory';
import { CleanFoldersStore, DEFAULT_CLEAN_FORM } from '../cleanfolders/clean.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import {
  cleanupRoots,
  DEFAULT_SERIES_OPTIONS,
  planSeries,
  restoreSeriesOptions,
  SeriesOptions,
  SeriesRow,
  splitList,
} from './series-engine';
import { SG_TEXTS } from './series-texts';

export interface SeriesRequest {
  readonly side: Side;
  /** The folder that is scanned (the active side's folder). */
  readonly sourceDir: string;
  /** The other side's folder, `null` if it shows none (or an archive). */
  readonly otherDir: string | null;
}

/** A row of the preview grid. */
export interface SeriesGridRow {
  readonly nr: number;
  readonly source: string;
  readonly season: string;
  readonly episode: string;
  readonly target: string;
  readonly info: string;
  readonly row: SeriesRow;
}

/** Folders scanned below the start folder (design 045 E1). */
export const SCAN_DEPTH = 8;

function err(message: string): FsError {
  return { code: 'unknown', message, path: null };
}

function info(r: SeriesRow): string {
  const t = SG_TEXTS;
  switch (r.status) {
    case 'ok':
      return [r.subtitle ? t.infoSubtitle : t.infoOk, r.duplicate ? t.infoDuplicate : '']
        .filter((s) => s !== '')
        .join(' · ');
    case 'inPlace':
      return t.infoInPlace;
    case 'unrecognized':
      return t.infoUnrecognized;
    case 'invalid':
      return t.infoInvalid(r.error ?? t.templateInvalid);
    case 'ignored':
      return r.reason === 'junkDir'
        ? t.infoJunkDir(r.reasonName ?? '')
        : r.reason === 'junk'
          ? t.infoJunk
          : t.infoNotVideo;
  }
}

/**
 * Group series by season (OPEN_SERIES_GROUP_DLG, design 045): collects the files
 * below the active folder (Rust `collect_files`), plans with the pure engine, runs
 * one `group` job and – after a move, on request – opens "clean folders" for the
 * release folders (design 045 E4).
 */
@Injectable({ providedIn: 'root' })
export class SeriesGroupStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly api = inject(FoldersApi);
  private readonly dialogs = inject(DialogService);
  private readonly settings = inject(SettingsStore);
  private readonly clean = inject(CleanFoldersStore);
  /** The kept options are read once, at the first opening (design 027 E5). */
  private recalled = false;
  private seq = 0;
  private running: string | null = null;

  readonly request = signal<SeriesRequest | null>(null);
  readonly options = signal<SeriesOptions>(DEFAULT_SERIES_OPTIONS);
  readonly tree = signal<FileTree | null>(null);
  readonly scanError = signal<FsError | null>(null);
  readonly busy = signal(false);
  readonly runError = signal<FsError | null>(null);

  readonly scanning = computed(
    () => this.request() !== null && this.tree() === null && this.scanError() === null,
  );

  /** The folder the season folders go into. */
  readonly root = computed(() => {
    const req = this.request();
    if (!req) {
      return null;
    }
    return this.options().otherSide && req.otherDir !== null ? req.otherDir : req.sourceDir;
  });

  readonly plan = computed(() =>
    planSeries(
      this.tree()?.files ?? [],
      this.options(),
      this.root() === (this.request()?.sourceDir ?? null),
    ),
  );

  readonly rows = computed<readonly SeriesGridRow[]>(() => {
    const show = this.options().showIgnored;
    const out: SeriesGridRow[] = [];
    this.plan().rows.forEach((r, i) => {
      if (!show && r.status === 'ignored') {
        return;
      }
      const e = r.episode;
      out.push({
        nr: i + 1,
        source: r.file.rel,
        season: e ? String(e.season) : '',
        episode: e ? (e.last > e.first ? `${e.first}–${e.last}` : String(e.first)) : '',
        target: r.status === 'ok' || r.status === 'inPlace' ? (r.folder ?? '') : '',
        info: info(r),
        row: r,
      });
    });
    return out;
  });

  readonly items = computed<readonly GroupItem[]>(() =>
    this.plan()
      .rows.filter((r) => r.status === 'ok')
      .map((r) => ({ path: r.file.path, group: r.folder! })),
  );

  readonly counts = computed(() => {
    const rows = this.plan().rows;
    const ok = rows.filter((r) => r.status === 'ok').length;
    const ignored = rows.filter((r) => r.status === 'ignored').length;
    return { ok, ignored, other: rows.length - ok - ignored };
  });

  /** Hints below the preview (they never block). */
  readonly hints = computed<readonly string[]>(() => {
    const t = SG_TEXTS;
    const p = this.plan();
    const tree = this.tree();
    const out: string[] = [];
    if (p.templateInvalid) {
      out.push(t.templateInvalid);
    }
    if (p.gaps.length > 0) {
      out.push(t.hintGaps(p.gaps.map((g) => `${g.folder}: ${g.missing.join(', ')}`).join(' · ')));
    }
    const dups = p.rows.filter((r) => r.duplicate).length;
    if (dups > 0) {
      out.push(t.hintDuplicates(dups));
    }
    if (p.seriesNames.length > 1) {
      out.push(t.hintSeries(p.seriesNames.join(', ')));
    }
    if (tree?.truncated) {
      out.push(t.hintTruncated);
    }
    const unreadable = (tree?.unreadable.length ?? 0) + (tree?.unreadableMore ?? 0);
    if (unreadable > 0) {
      out.push(t.hintUnreadable(unreadable));
    }
    return out;
  });

  readonly canRun = computed(
    () => !this.busy() && !this.scanning() && this.root() !== null && this.items().length > 0,
  );

  /** The active side shows a local folder (no result tab, archive or server). */
  hasFolder(): boolean {
    const store = this.ws.panel()?.store;
    return (
      !!store &&
      store.path() !== null &&
      store.searchKey() === null &&
      store.archive() === null &&
      store.remote() === null
    );
  }

  open(): void {
    const side = this.ws.source();
    const store = this.ws.panel(side)?.store;
    const sourceDir = store?.path() ?? null;
    if (!store || sourceDir === null || !this.hasFolder()) {
      throw err(SG_TEXTS.noFolder);
    }
    if (!this.recalled) {
      this.recalled = true;
      const kept = recallDialog(this.settings, 'seriesGroup');
      if (kept !== undefined) {
        this.options.set(restoreSeriesOptions(kept));
      }
    }
    this.runError.set(null);
    this.busy.set(false);
    this.request.set({ side, sourceDir, otherDir: this.ws.targetDir(side) });
    this.dialogs.show('series-group');
    void this.scan(sourceDir);
  }

  update(patch: Partial<SeriesOptions>): void {
    this.options.set({ ...this.options(), ...patch });
    this.runError.set(null);
  }

  close(): void {
    this.cancelRunning();
    this.seq++;
    this.request.set(null);
    this.tree.set(null);
    this.dialogs.close();
  }

  private cancelRunning(): void {
    if (this.running !== null) {
      void this.api.cancelScan(this.running).catch(() => undefined);
      this.running = null;
    }
  }

  /** Collects the files; an older answer never replaces a newer one. */
  private async scan(root: string): Promise<void> {
    this.cancelRunning();
    const seq = ++this.seq;
    const id = `series-${seq}`;
    this.running = id;
    this.tree.set(null);
    this.scanError.set(null);
    try {
      const tree = await this.api.collectFiles(id, root, { maxDepth: SCAN_DEPTH });
      if (seq === this.seq && !tree.cancelled) {
        this.tree.set(tree);
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

  /** Starts the `group` job; the dialog closes. Errors stay in the dialog. */
  async run(transfer: 'copy' | 'move'): Promise<void> {
    const req = this.request();
    const root = this.root();
    const items = this.items();
    if (!req || root === null || !this.canRun()) {
      return;
    }
    const options = this.options();
    const rows = this.plan().rows;
    this.busy.set(true);
    let id: string;
    try {
      id = await this.jobs.start({ kind: 'group', root, items, transfer });
    } catch (e) {
      this.runError.set(toFsError(e));
      this.busy.set(false);
      return;
    }
    rememberDialog(this.settings, 'seriesGroup', options); // never the transfer (design 045 E3)
    this.close();
    this.busy.set(false);
    void this.jobs
      .whenFinished(id)
      .then((job) => this.afterJob(job, req, root, rows, options, transfer));
  }

  private afterJob(
    job: JobInfo,
    req: SeriesRequest,
    root: string,
    rows: readonly SeriesRow[],
    options: SeriesOptions,
    transfer: 'copy' | 'move',
  ): void {
    const s = job.summary;
    if (job.state === 'failed') {
      this.jobs.report(SG_TEXTS.failed(s?.error?.message ?? ''));
      return;
    }
    if (job.state === 'doneWithErrors' && s) {
      this.jobs.report(SG_TEXTS.withErrors(s.itemsFailed));
    } else if (job.state === 'done' && s) {
      this.jobs.report(SG_TEXTS.done(s.itemsDone));
    }
    if (job.state === 'cancelled' || transfer !== 'move' || !options.cleanup) {
      return;
    }
    // design 045 E4: the release folders of the moved files – checked and listed by
    // "clean folders"; a folder that still holds anything but extras stays
    const failed = new Set(s?.errors.map((e) => e.path) ?? []);
    const roots = cleanupRoots(rows, failed, options.template);
    if (roots.length === 0 || this.dialogs.open() !== null) {
      return;
    }
    this.clean.openPrepared(req.side, root, roots, {
      ...DEFAULT_CLEAN_FORM,
      emptyDirs: true,
      includeRoots: true,
      junkOn: true,
      junkText: [...splitList(options.junk), ...DEFAULT_JUNK].join('; '),
      patternsOn: false,
    });
  }
}
