import { computed, inject, Injectable, signal } from '@angular/core';
import { FoldersApi } from '../../core/folders/folders-api';
import { DEFAULT_JUNK, FileTree } from '../../core/folders/folders.models';
import { toFsError } from '../../core/fs/fs-error';
import { DirectoryListing, DirEntry, FsError, isParentRow } from '../../core/fs/fs.models';
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
  RELEASE_EXTRAS,
  SeriesPlan,
  SeriesRow,
  SeriesTarget,
} from './series-engine';
import { checkGroupName } from '../groupfiles/group-engine';
import { SG_TEXTS } from './series-texts';

/** A series folder to collect from: a marked folder, or the folder the panel shows. */
export interface SeriesSource {
  readonly path: string;
  /** Its name – the series name for the target `otherSeries` (design 045 E8). */
  readonly name: string;
}

export interface SeriesRequest {
  readonly side: Side;
  /** The folder the panel shows. */
  readonly sourceDir: string;
  /** The series folders: the marked folders, otherwise `sourceDir` (design 045 E8). */
  readonly sources: readonly SeriesSource[];
  /** The other side's folder, `null` if it shows none (or an archive). */
  readonly otherDir: string | null;
}

/** The plan of one series folder. */
export interface SourcePlan {
  readonly source: SeriesSource;
  readonly plan: SeriesPlan;
  /** Where its season folders go; `subdir` = the series folder on the other side. */
  readonly root: string;
  readonly subdir: string | null;
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
      return r.copied ? t.infoCopied(r.folder ?? '') : t.infoInPlace;
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
 * below each series folder (Rust `collect_files`), plans with the pure engine, runs
 * one `group` job per series folder and – after a move, on request – opens "clean folders" for the
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
  private running: string[] = [];

  readonly request = signal<SeriesRequest | null>(null);
  readonly options = signal<SeriesOptions>(DEFAULT_SERIES_OPTIONS);
  /** One answer per source (same order), `null` while it is collected. */
  readonly trees = signal<readonly (FileTree | null)[]>([]);
  readonly scanError = signal<FsError | null>(null);
  readonly busy = signal(false);
  readonly runError = signal<FsError | null>(null);

  readonly scanning = computed(
    () =>
      this.request() !== null &&
      this.scanError() === null &&
      (this.trees().length === 0 || this.trees().some((t) => t === null)),
  );

  /** The chosen target – without a folder on the other side always the series folder. */
  readonly target = computed<SeriesTarget>(() =>
    this.request()?.otherDir === null ? 'source' : this.options().target,
  );

  readonly plans = computed<readonly SourcePlan[]>(() => {
    const req = this.request();
    if (!req) {
      return [];
    }
    const target = this.target();
    const trees = this.trees();
    return req.sources.map((source, i) => ({
      source,
      plan: planSeries(trees[i]?.files ?? [], this.options(), target === 'source'),
      root: target === 'source' ? source.path : (req.otherDir ?? source.path),
      subdir: target === 'otherSeries' ? source.name : null,
    }));
  });

  /** For the summary: the plan of the only source (one series folder). */
  readonly plan = computed(() => this.plans()[0]?.plan ?? planSeries([], this.options(), true));

  readonly rows = computed<readonly SeriesGridRow[]>(() => {
    const show = this.options().showIgnored;
    const many = this.plans().length > 1;
    const out: SeriesGridRow[] = [];
    let nr = 0;
    for (const sp of this.plans()) {
      for (const r of sp.plan.rows) {
        nr++;
        if (!show && r.status === 'ignored') {
          continue;
        }
        const e = r.episode;
        const folder = r.status === 'ok' || r.status === 'inPlace' ? (r.folder ?? '') : '';
        out.push({
          nr,
          // display only – never split or joined as a path
          source: many ? `${sp.source.name} › ${r.file.rel}` : r.file.rel,
          season: e ? String(e.season) : '',
          episode: e ? (e.last > e.first ? `${e.first}–${e.last}` : String(e.first)) : '',
          target: folder && sp.subdir !== null ? `${sp.subdir} › ${folder}` : folder,
          info: info(r),
          row: r,
        });
      }
    }
    return out;
  });

  /** The jobs to start: one per series folder with something to do. */
  readonly jobsToRun = computed(() =>
    this.plans()
      .map((sp) => ({
        sp,
        items: sp.plan.rows
          .filter((r) => r.status === 'ok')
          .map((r): GroupItem => ({ path: r.file.path, group: r.folder! })),
      }))
      .filter((j) => j.items.length > 0),
  );

  readonly items = computed<readonly GroupItem[]>(() => this.jobsToRun().flatMap((j) => j.items));

  readonly counts = computed(() => {
    const rows = this.plans().flatMap((sp) => sp.plan.rows);
    const ok = rows.filter((r) => r.status === 'ok').length;
    const ignored = rows.filter((r) => r.status === 'ignored').length;
    return { ok, ignored, other: rows.length - ok - ignored };
  });

  /**
   * Why the run is blocked (design 045 E8): several series into one folder of the
   * other side would mix their seasons; a series name that is no valid folder name.
   */
  readonly blocked = computed<string | null>(() => {
    const t = SG_TEXTS;
    const target = this.target();
    if (target === 'other' && this.jobsToRun().length > 1) {
      return t.blockedMixed;
    }
    if (target === 'otherSeries') {
      for (const j of this.jobsToRun()) {
        const why = checkGroupName(j.sp.source.name);
        if (why !== null) {
          return t.blockedSeriesName(j.sp.source.name, why);
        }
      }
    }
    return null;
  });

  /** Hints below the preview (they never block). */
  readonly hints = computed<readonly string[]>(() => {
    const t = SG_TEXTS;
    const out: string[] = [];
    const plans = this.plans();
    if (plans[0]?.plan.templateInvalid) {
      out.push(t.templateInvalid);
    }
    const many = plans.length > 1;
    for (const sp of plans) {
      const p = sp.plan;
      const pre = many ? `${sp.source.name}: ` : '';
      if (p.gaps.length > 0) {
        out.push(
          pre + t.hintGaps(p.gaps.map((g) => `${g.folder}: ${g.missing.join(', ')}`).join(' · ')),
        );
      }
      const dups = p.rows.filter((r) => r.duplicate).length;
      if (dups > 0) {
        out.push(pre + t.hintDuplicates(dups));
      }
      if (p.seriesNames.length > 1) {
        out.push(pre + t.hintSeries(p.seriesNames.join(', ')));
      }
    }
    const trees = this.trees().filter((x): x is FileTree => x !== null);
    if (trees.some((x) => x.truncated)) {
      out.push(t.hintTruncated);
    }
    const unreadable = trees.reduce((n, x) => n + x.unreadable.length + x.unreadableMore, 0);
    if (unreadable > 0) {
      out.push(t.hintUnreadable(unreadable));
    }
    return out;
  });

  readonly canRun = computed(
    () => !this.busy() && !this.scanning() && this.items().length > 0 && this.blocked() === null,
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
    this.request.set({
      side,
      sourceDir,
      sources: seriesSources(store.markedEntries(), sourceDir, store.listing()),
      otherDir: this.ws.targetDir(side),
    });
    this.dialogs.show('series-group');
    void this.scan();
  }

  update(patch: Partial<SeriesOptions>): void {
    this.options.set({ ...this.options(), ...patch });
    this.runError.set(null);
  }

  close(): void {
    this.cancelRunning();
    this.seq++;
    this.request.set(null);
    this.trees.set([]);
    this.dialogs.close();
  }

  private cancelRunning(): void {
    for (const id of this.running) {
      void this.api.cancelScan(id).catch(() => undefined);
    }
    this.running = [];
  }

  /** Collects the files of every source; an older answer never replaces a newer one. */
  private async scan(): Promise<void> {
    const req = this.request();
    if (!req) {
      return;
    }
    this.cancelRunning();
    const seq = ++this.seq;
    this.trees.set(req.sources.map(() => null));
    this.scanError.set(null);
    await Promise.all(
      req.sources.map(async (source, i) => {
        const id = `series-${seq}-${i}`;
        this.running.push(id);
        try {
          const tree = await this.api.collectFiles(id, source.path, { maxDepth: SCAN_DEPTH });
          if (seq === this.seq && !tree.cancelled) {
            this.trees.update((list) => list.map((t, j) => (j === i ? tree : t)));
          }
        } catch (e) {
          if (seq === this.seq) {
            this.scanError.set(toFsError(e));
          }
        } finally {
          this.running = this.running.filter((r) => r !== id);
        }
      }),
    );
  }

  /** Starts one `group` job per series folder; the dialog closes. Errors stay in it. */
  async run(transfer: 'copy' | 'move'): Promise<void> {
    const req = this.request();
    if (!req || !this.canRun()) {
      return;
    }
    const options = this.options();
    const jobs = this.jobsToRun();
    this.busy.set(true);
    const started: { id: string; rows: readonly SeriesRow[] }[] = [];
    for (const j of jobs) {
      try {
        const id = await this.jobs.start({
          kind: 'group',
          root: j.sp.root,
          ...(j.sp.subdir !== null ? { subdir: j.sp.subdir } : {}),
          items: j.items,
          transfer,
        });
        started.push({ id, rows: j.sp.plan.rows });
      } catch (e) {
        this.runError.set(toFsError(e));
        this.busy.set(false);
        if (started.length === 0) {
          return; // nothing runs: the dialog stays with the error
        }
        break; // the started ones go on; their results are reported
      }
    }
    rememberDialog(this.settings, 'seriesGroup', options); // never the transfer (design 045 E3)
    this.close();
    this.busy.set(false);
    void Promise.all(started.map((s) => this.jobs.whenFinished(s.id))).then((infos) =>
      this.afterJobs(
        infos.map((job, i) => ({ job, rows: started[i].rows })),
        req,
        options,
        transfer,
      ),
    );
  }

  private afterJobs(
    done: readonly { job: JobInfo; rows: readonly SeriesRow[] }[],
    req: SeriesRequest,
    options: SeriesOptions,
    transfer: 'copy' | 'move',
  ): void {
    const failedJob = done.find((d) => d.job.state === 'failed');
    const itemsDone = done.reduce((n, d) => n + (d.job.summary?.itemsDone ?? 0), 0);
    const itemsFailed = done.reduce((n, d) => n + (d.job.summary?.itemsFailed ?? 0), 0);
    if (failedJob) {
      this.jobs.report(SG_TEXTS.failed(failedJob.job.summary?.error?.message ?? ''));
    } else if (itemsFailed > 0) {
      this.jobs.report(SG_TEXTS.withErrors(itemsFailed));
    } else if (done.some((d) => d.job.state === 'done')) {
      this.jobs.report(SG_TEXTS.done(itemsDone));
    }
    if (transfer !== 'move' || !options.cleanup) {
      return;
    }
    // design 045 E4: the release folders of the moved files – checked and listed by
    // "clean folders"; a folder that still holds anything but extras stays
    const roots = done
      .filter((d) => d.job.state === 'done' || d.job.state === 'doneWithErrors')
      .flatMap((d) => {
        const failed = new Set(d.job.summary?.errors.map((e) => e.path) ?? []);
        return cleanupRoots(d.rows, failed, options.template);
      });
    if (roots.length === 0 || this.dialogs.open() !== null) {
      return;
    }
    // the start folders lie below the scanned folders, also when the target was the other side
    this.clean.openPrepared(req.side, req.sourceDir, roots, {
      ...DEFAULT_CLEAN_FORM,
      emptyDirs: true,
      includeRoots: true,
      junkOn: true,
      junkText: [...RELEASE_EXTRAS, ...DEFAULT_JUNK].join('; '),
      patternsOn: false,
    });
  }
}

/**
 * The series folders (design 045 E8): the marked real folders of the panel, otherwise
 * the folder it shows – named after the last segment of its listing.
 */
export function seriesSources(
  marked: readonly DirEntry[],
  sourceDir: string,
  listing: DirectoryListing | null,
): readonly SeriesSource[] {
  const dirs = marked.filter((e) => !isParentRow(e) && e.kind === 'directory');
  if (dirs.length > 0) {
    return dirs.map((e) => ({ path: e.path, name: e.name }));
  }
  const last = listing?.segments.at(-1);
  return [{ path: sourceDir, name: last?.name ?? '' }];
}
