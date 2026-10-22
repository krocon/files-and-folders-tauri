import { DiskUsageStore } from '../diskusage/disk-usage.store';
import { isUsageKey, scanIdOf } from '../diskusage/usage-rows';
import { inject, Injectable, signal } from '@angular/core';
import { FsApi } from '../../core/fs/fs-api';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { SettingsStore } from '../../core/settings/settings.store';
import { DirEntry, FsError, PathCheck } from '../../core/fs/fs.models';
import {
  ConflictDefault,
  DeleteMode,
  ExpectedEntry,
  JobInfo,
  JobSpec,
} from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { Side } from '../../core/session/session.models';
import { isSameOrBelow, SearchStore } from '../search/search.store';
import { SearchHit } from '../../core/search/search.models';
import { ArchiveStore } from '../archive/archive.store';
import { ARCHIVE_TEXTS } from '../archive/archive-texts';
import { isRemotePath } from '../../core/remote/remote-path';
import { wholeGroups } from '../duplicates/duplicates-logic';
import { DialogService } from '../../shared/dialog/dialog.service';
import { jobTitle } from '../jobs/job-format';
import { WorkspaceStore } from '../workspace/workspace.store';
import {
  cursorAfterRemoval,
  expectedFor,
  selectionForAction,
  stemLength,
  suggestFolderName,
  TargetOption,
  targetOptions,
} from './ops-logic';
import { OPS_TEXTS } from './ops-texts';

/** The operations of the copy/move dialog – `link` creates symbolic links (design 031 E8). */
export type TransferKind = 'copy' | 'move' | 'link';

export interface CopyMoveRequest {
  readonly kind: TransferKind;
  readonly side: Side;
  readonly sourceDir: string;
  readonly sources: readonly DirEntry[];
  /** Pre-filled target: the other panel's folder. */
  readonly target: string;
  readonly targets: readonly TargetOption[];
  /** Root/home/system paths among the sources (moving them needs a second confirmation). */
  readonly dangers: readonly PathCheck[];
  /** What the panel showed when the request was made (design 030 E5, review #1). */
  readonly expected?: readonly ExpectedEntry[];
}

export interface CopyMoveInput {
  readonly target: string;
  /** Name in the target folder (single source only). */
  readonly name: string | null;
  readonly conflictDefault: ConflictDefault;
  readonly background: boolean;
  readonly allowDangerous: boolean;
  /** Link only (design 031 E8): relative target, free name when the name exists. */
  readonly relative?: boolean;
  readonly keepBoth?: boolean;
}

export interface DeleteRequest {
  readonly mode: DeleteMode;
  readonly side: Side;
  readonly sourceDir: string;
  readonly entries: readonly DirEntry[];
  readonly dangers: readonly PathCheck[];
  /** Duplicate tab (design 016 E6): groups of which every file would be deleted. */
  readonly wholeGroups?: number;
  /** Duplicate tab compared by size only: the files may well differ (review 016 #6). */
  readonly sizeOnly?: boolean;
  /** What the panel showed when the request was made (design 030 E5, review #1). */
  readonly expected?: readonly ExpectedEntry[];
  /** Disk-usage tab (design 033 E3): minutes since the scan – the entries may have changed. */
  readonly scanAgeMin?: number;
}

export interface NameRequest {
  readonly kind: 'mkdir' | 'createFile' | 'rename';
  readonly side: Side;
  readonly parent: string;
  readonly initial: string;
  /** Selected part of `initial` when the dialog opens (rename: name without extension). */
  readonly selectEnd: number;
  /** The entry to rename. */
  readonly entry: DirEntry | null;
  /** Shown at once (an in-place rename failed). */
  readonly error?: FsError | null;
  /** Rename of a hit in a result tab (design 009 E4): the result is searched again. */
  readonly searchKey?: string | null;
}

function err(code: FsError['code'], message: string): FsError {
  return { code, message, path: null };
}

/**
 * The file operations of design 006: builds the request a dialog shows
 * (selection "marked, else cursor", target suggestions, dangerous paths) and
 * runs the confirmed operation – long ones as jobs, quick ones as commands.
 * Afterwards the cursor goes to the result and both panels reload.
 */
@Injectable({ providedIn: 'root' })
export class OpsStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly fs = inject(FsApi);
  private readonly dialogs = inject(DialogService);
  private readonly search = inject(SearchStore);
  private readonly settings = inject(SettingsStore);
  private readonly archive = inject(ArchiveStore);
  private readonly usage = inject(DiskUsageStore);

  readonly copyMove = signal<CopyMoveRequest | null>(null);
  readonly del = signal<DeleteRequest | null>(null);
  readonly name = signal<NameRequest | null>(null);

  /** The entries an operation of the active panel works on. */
  selection(): readonly DirEntry[] {
    return selectionForAction(this.ws.panel()?.store);
  }

  /** The real folder of the active panel – null for result tabs and inside archives (read-only). */
  folder(): string | null {
    const store = this.ws.panel()?.store;
    return store && store.archive() === null ? store.path() : null;
  }

  /** The active panel shows a folder inside an archive (design 016 E1). */
  inArchive(): boolean {
    return (this.ws.panel()?.store.archive() ?? null) !== null;
  }

  /**
   * The folder `entry` lives in, for a rename: the shown folder, in a result tab
   * the hit's own folder – null inside an archive (read-only).
   */
  private renameParent(side: Side, entry: DirEntry): string | null {
    const store = this.ws.panel(side)?.store;
    if (!store || store.archive() !== null) {
      return null;
    }
    return store.searchKey() !== null ? ((entry as SearchHit).dir ?? null) : store.path();
  }

  /** Exactly one entry to rename – in a folder or a result tab, not inside an archive. */
  canRenameOne(): boolean {
    const sel = this.selection();
    return sel.length === 1 && this.renameParent(this.ws.activeSide(), sel[0]) !== null;
  }

  /** The folder, or the result tab (`search:<key>`) of the active panel. */
  location(): string | null {
    return this.ws.panel()?.store.locationKey() ?? null;
  }

  // ---- open the dialogs ----

  async openCopyMove(kind: 'copy' | 'move'): Promise<void> {
    const side = this.ws.source();
    if (this.inArchive()) {
      // copying out of an archive = extracting (design 016 E4); archives are read-only
      if (kind === 'move') {
        throw err('unknown', ARCHIVE_TEXTS.readOnly);
      }
      this.archive.openUnpack();
      return;
    }
    // a result tab (design 009) has no folder: its location key stands in for it
    const sourceDir = this.location();
    const sources = this.selection();
    if (sourceDir === null) {
      throw err('unknown', OPS_TEXTS.noFolder);
    }
    if (sources.length === 0) {
      throw err('unknown', OPS_TEXTS.nothingSelected);
    }
    const other = this.ws.targetDir(side);
    await this.openCopyMoveFor({
      kind,
      side,
      sourceDir,
      sources,
      target: other ?? this.folder() ?? '',
    });
  }

  /**
   * "Create link…" (design 031 E8): the dialog in link mode for the selection,
   * target = the other panel. Not inside an archive (virtual paths).
   */
  async openLink(): Promise<void> {
    if (this.inArchive()) {
      throw err('unknown', OPS_TEXTS.linkFromArchive);
    }
    const side = this.ws.source();
    const sourceDir = this.location();
    const sources = this.selection();
    if (sourceDir === null) {
      throw err('unknown', OPS_TEXTS.noFolder);
    }
    if (sources.length === 0) {
      throw err('unknown', OPS_TEXTS.nothingSelected);
    }
    await this.openCopyMoveFor({
      kind: 'link',
      side,
      sourceDir,
      sources,
      target: this.ws.targetDir(side) ?? this.folder() ?? '',
    });
  }

  /**
   * The copy/move dialog for given entries and target – drag and drop (design
   * 012 E5/E6). `side` is the panel the entries come from (or were dropped on);
   * `sourceDir` their folder ('' if they come from several folders).
   */
  async openCopyMoveFor(args: {
    kind: TransferKind;
    side: Side;
    sourceDir: string;
    sources: readonly DirEntry[];
    target: string;
  }): Promise<void> {
    if (args.sources.length === 0) {
      throw err('unknown', OPS_TEXTS.nothingSelected);
    }
    // archives are read-only (design 016): never a target; out of one only by extracting (F5)
    if (this.archive.isArchivePath(args.target)) {
      throw err('unknown', ARCHIVE_TEXTS.intoArchive); // also a tab that is not open
    }
    for (const s of ['left', 'right'] as const) {
      const info = this.ws.panel(s)?.store.archive();
      if (info && isSameOrBelow(args.target, info.path)) {
        throw err('unknown', ARCHIVE_TEXTS.intoArchive);
      }
      if (info && s === args.side && args.sources.some((e) => isSameOrBelow(e.path, info.path))) {
        throw err(
          'unknown',
          args.kind === 'link' ? OPS_TEXTS.linkFromArchive : ARCHIVE_TEXTS.readOnly,
        );
      }
    }
    const other = this.ws.targetDir(args.side);
    const panels = this.ws.panels();
    const tabPaths = [...panels.left.tabs, ...panels.right.tabs].map((t) => t.path);
    const targets = targetOptions(
      [
        { group: OPS_TEXTS.otherPanel, paths: [other] },
        { group: OPS_TEXTS.tabGroup, paths: tabPaths },
        { group: OPS_TEXTS.favouriteGroup, paths: [...this.ws.favorites()] },
        { group: OPS_TEXTS.recentGroup, paths: this.ws.recent() },
      ],
      (p) => this.archive.isArchivePath(p),
    );
    const dangers = args.kind === 'move' ? await this.dangers(args.sources) : [];
    // fixed now: the listing may be checked (and look fresh) before the dialog is confirmed
    const usageKey = this.ws.panel(args.side)?.store.searchKey();
    const expected =
      args.kind !== 'move'
        ? undefined
        : isUsageKey(usageKey)
          ? this.usage.expected(args.sources)
          : expectedFor(args.sources, this.listingState(args.side));
    this.copyMove.set({ ...args, targets, dangers, ...(expected ? { expected } : {}) });
    this.dialogs.show('copy-move');
  }

  async openDelete(mode: DeleteMode): Promise<void> {
    if (this.inArchive()) {
      throw err('unknown', ARCHIVE_TEXTS.readOnly);
    }
    const sourceDir = this.location();
    const entries = this.selection();
    if (sourceDir === null) {
      throw err('unknown', OPS_TEXTS.noFolder);
    }
    if (entries.length === 0) {
      throw err('unknown', OPS_TEXTS.nothingSelected);
    }
    const dangers = await this.dangers(entries);
    // settings (design 015): F8 deletes permanently when the trash is switched off
    // servers have no trash (design 034 E4): always permanent there
    const effective: DeleteMode =
      isRemotePath(sourceDir) || (mode === 'trash' && !this.settings.get('behavior.deleteToTrash'))
        ? 'permanent'
        : mode;
    const store = this.ws.panel()?.store;
    const whole =
      store?.searchKey() != null && store.searchKind() === 'duplicates'
        ? wholeGroups(store.entries(), new Set(entries.map((e) => e.path)))
        : 0;
    const req: DeleteRequest = {
      mode: effective,
      side: this.ws.source(),
      sourceDir,
      entries,
      dangers,
      wholeGroups: whole,
      sizeOnly: store?.searchKind() === 'duplicates' && this.search.sizeOnly(store.searchKey()),
      ...this.expectedOf(entries),
      ...this.usageExtras(entries),
    };
    // without confirmation only a plain trash delete (no dangers, no whole duplicate groups)
    if (
      effective === 'trash' &&
      dangers.length === 0 &&
      whole === 0 &&
      !this.settings.get('behavior.confirmTrash')
    ) {
      const e = await this.runDelete(req, false);
      if (e) {
        this.jobs.report(OPS_TEXTS.failed(OPS_TEXTS.deleteTitle, errorText(e)));
      }
      return;
    }
    this.del.set(req);
    this.dialogs.show('delete');
  }

  openName(kind: NameRequest['kind']): void {
    const side = this.ws.source();
    const store = this.ws.panel(side)?.store;
    if (kind === 'rename' && store && store.archive() === null) {
      const sel = this.selection();
      if (sel.length !== 1) {
        throw err('unknown', sel.length === 0 ? OPS_TEXTS.nothingSelected : OPS_TEXTS.oneEntry);
      }
      const entry = sel[0];
      const renameIn = this.renameParent(side, entry);
      if (renameIn === null) {
        throw err('unknown', OPS_TEXTS.noFolder);
      }
      this.name.set({
        kind,
        side,
        parent: renameIn,
        initial: entry.name,
        selectEnd: stemLength(entry.name, entry.kind === 'directory'),
        entry,
        searchKey: store.searchKey(),
      });
      this.dialogs.show('name');
      return;
    }
    const parent = store && store.archive() === null ? store.path() : null;
    if (!store || parent === null) {
      throw err('unknown', store?.archive() ? ARCHIVE_TEXTS.readOnly : OPS_TEXTS.noFolder);
    }
    const basis = this.selection()[0] ?? null;
    const initial =
      kind === 'mkdir'
        ? suggestFolderName(
            store.entries().map((e) => e.name),
            basis,
          )
        : '';
    this.name.set({ kind, side, parent, initial, selectEnd: initial.length, entry: null });
    this.dialogs.show('name');
  }

  /**
   * F2: rename the cursor entry in the list itself; the dialog if the list
   * cannot (marked entry elsewhere, table busy). A failed rename opens the
   * dialog with the typed name and the error.
   */
  renameInline(): void {
    const side = this.ws.source();
    const panel = this.ws.panel(side);
    const sel = this.selection();
    const entry = sel.length === 1 ? sel[0] : null;
    const parent = entry ? this.renameParent(side, entry) : null;
    const list = panel?.controller();
    if (!panel || parent === null || !entry || !list || panel.store.cursorPath() !== entry.path) {
      this.openName('rename');
      return;
    }
    const req: NameRequest = {
      kind: 'rename',
      side,
      parent,
      initial: entry.name,
      selectEnd: stemLength(entry.name, entry.kind === 'directory'),
      entry,
      searchKey: panel.store.searchKey(),
    };
    const started = list.startRename(entry, (value) => {
      if (value !== null) {
        void this.finishInline(req, value);
      }
    });
    if (!started) {
      this.openName('rename');
    }
  }

  private async finishInline(req: NameRequest, value: string): Promise<void> {
    const error = await this.runName(req, value, false);
    if (error) {
      this.name.set({ ...req, initial: value, selectEnd: stemLength(value), error });
      this.dialogs.show('name');
    }
  }

  close(): void {
    this.copyMove.set(null);
    this.del.set(null);
    this.name.set(null);
    this.dialogs.close();
  }

  // ---- run the confirmed operation ----

  /** Starts the copy/move job. Returns an error to show in the dialog, or null (closed). */
  async runCopyMove(req: CopyMoveRequest, input: CopyMoveInput): Promise<FsError | null> {
    const raw = input.target.trim();
    if (raw === '') {
      return err('invalid_path', OPS_TEXTS.emptyTarget);
    }
    let dir: string;
    try {
      const loc = await this.fs.resolveLocation(raw);
      if (loc.select !== null) {
        return err('not_a_directory', OPS_TEXTS.targetIsFile);
      }
      dir = loc.dir;
    } catch (e) {
      return toFsError(e);
    }
    const single = req.sources.length === 1 ? req.sources[0] : null;
    const name = input.name?.trim() ?? '';
    const renameTo = single && name !== '' && name !== single.name ? name : null;
    if (dir === req.sourceDir && renameTo === null && !(req.kind === 'link' && input.keepBoth)) {
      return err('same_source_target', single ? OPS_TEXTS.sameFolder : OPS_TEXTS.sameFolderMulti);
    }
    const sources = req.sources.map((e) => e.path);
    if (req.kind === 'link') {
      return this.runLink(req, dir, sources, renameTo, input);
    }
    const options = { conflictDefault: input.conflictDefault, renameTo };
    const expected = req.expected;
    const spec: JobSpec =
      req.kind === 'copy'
        ? { kind: 'copy', sources, targetDir: dir, background: input.background, options }
        : {
            kind: 'move',
            sources,
            targetDir: dir,
            background: input.background,
            options,
            allowDangerous: input.allowDangerous,
            ...(expected ? { expected } : {}),
          };
    const cursor = this.ws.panel(req.side)?.store.cursorPath() ?? null;
    if (req.kind === 'move') {
      this.moveCursorOff(req.side, req.sourceDir, sources);
    }
    let id: string;
    try {
      id = await this.jobs.start(spec);
    } catch (e) {
      this.ws.panel(req.side)?.store.setCursor(cursor);
      return toFsError(e);
    }
    this.ws.addRecent(dir);
    this.close();
    this.afterJob(id, req.side, req.sourceDir, sources, req.kind === 'move');
    return null;
  }

  /** Starts the link job (design 031 E9); nothing moves, so the cursor stays. */
  private async runLink(
    req: CopyMoveRequest,
    dir: string,
    sources: readonly string[],
    renameTo: string | null,
    input: CopyMoveInput,
  ): Promise<FsError | null> {
    let id: string;
    try {
      id = await this.jobs.start({
        kind: 'link',
        sources,
        targetDir: dir,
        options: {
          relative: input.relative ?? false,
          renameTo,
          keepBoth: input.keepBoth ?? false,
        },
      });
    } catch (e) {
      return toFsError(e);
    }
    this.ws.addRecent(dir);
    this.close();
    this.afterJob(id, req.side, req.sourceDir, sources, false);
    return null;
  }

  /**
   * Disk-usage tab (design 033 E3): the scan is an old state – always compare what the
   * job deletes with it (sizes the files report), and say how old it is.
   */
  private usageExtras(entries: readonly DirEntry[]): {
    expected?: readonly ExpectedEntry[];
    scanAgeMin?: number;
  } {
    const key = this.ws.panel()?.store.searchKey();
    if (!isUsageKey(key)) {
      return {};
    }
    const scanId = scanIdOf(key);
    return {
      expected: this.usage.expected(entries),
      scanAgeMin: this.usage.ageMinutes(scanId),
    };
  }

  private expectedOf(entries: readonly DirEntry[]): { expected?: readonly ExpectedEntry[] } {
    const expected = expectedFor(entries, this.listingState(this.ws.source()));
    return expected ? { expected } : {};
  }

  /** Whether the listing of `side` may be outdated (design 030 E5). */
  private listingState(side: Side): { network: boolean; fromCache: boolean } {
    const store = this.ws.panel(side)?.store;
    return {
      network: store?.listing()?.network === true,
      fromCache: (store?.cachedAt() ?? null) !== null,
    };
  }

  /** Starts the delete job; the cursor moves to the next remaining entry at once. */
  async runDelete(req: DeleteRequest, allowDangerous: boolean): Promise<FsError | null> {
    const paths = req.entries.map((e) => e.path);
    // before the job starts: its "folder changed" reload must already keep the new cursor
    const cursor = this.ws.panel(req.side)?.store.cursorPath() ?? null;
    this.moveCursorOff(req.side, req.sourceDir, paths);
    let id: string;
    try {
      const expected = req.expected;
      id = await this.jobs.start({
        kind: 'delete',
        paths,
        mode: req.mode,
        allowDangerous,
        ...(expected ? { expected } : {}),
      });
    } catch (e) {
      this.ws.panel(req.side)?.store.setCursor(cursor);
      return toFsError(e);
    }
    this.close();
    this.afterJob(id, req.side, req.sourceDir, paths, true);
    return null;
  }

  /** Creates or renames. Returns an error to show in the dialog, or null (closed). */
  async runName(req: NameRequest, value: string, allowDangerous: boolean): Promise<FsError | null> {
    const name = req.kind === 'rename' ? value : value.trim();
    if (name.trim() === '') {
      return err('invalid_name', OPS_TEXTS.emptyName);
    }
    if (req.kind === 'rename' && req.entry && name === req.entry.name) {
      this.close();
      return null;
    }
    let result: string;
    try {
      switch (req.kind) {
        case 'mkdir':
          result = await this.fs.makeDir(req.parent, name);
          break;
        case 'createFile':
          result = await this.fs.createFile(req.parent, name);
          break;
        case 'rename':
          result = await this.fs.renameEntry(req.entry!.path, name, allowDangerous);
          break;
      }
    } catch (e) {
      return toFsError(e);
    }
    this.close();
    if (req.searchKey) {
      // the hit carries the old name: search again (the new name may no longer match)
      // a flat view keeps the cursor on the renamed entry (review 038 B7)
      void this.search.rerun(req.searchKey, req.kind === 'rename' ? result : undefined);
    }
    this.refreshFolder(req.parent, req.side, result);
    if (req.kind === 'rename' && req.entry) {
      // a panel showing the renamed folder itself follows it
      for (const s of ['left', 'right'] as const) {
        if (this.ws.panel(s)?.store.path() === req.entry.path) {
          this.ws.requestNavigate(s, result);
        }
      }
    }
    return null;
  }

  /** Reloads every panel showing `dir`; the panel on `side` puts its cursor on `cursor`. */
  refreshFolder(dir: string, side: Side, cursor: string | null): void {
    for (const s of ['left', 'right'] as const) {
      const store = this.ws.panel(s)?.store;
      if (!store || store.path() !== dir || store.navigationLocked()) {
        continue;
      }
      if (s === side && cursor !== null) {
        store.setCursor(cursor);
      }
      void store.refresh();
    }
  }

  /**
   * The cursor leaves entries that are about to disappear (delete, move): to the
   * next remaining one – in the store and in the table, whose focus would
   * otherwise put the old entry back.
   */
  private moveCursorOff(side: Side, folder: string, paths: readonly string[]): void {
    const panel = this.ws.panel(side);
    if (!panel || panel.store.locationKey() !== folder) {
      return;
    }
    const list = panel.controller();
    const displayed = list?.displayedEntries() ?? panel.store.visibleEntries();
    panel.store.setCursor(cursorAfterRemoval(displayed, new Set(paths), panel.store.cursorPath()));
    list?.restoreCursor();
  }

  private async dangers(entries: readonly DirEntry[]): Promise<readonly PathCheck[]> {
    try {
      const checks = await this.fs.checkPaths(entries.map((e) => e.path));
      return checks.filter((c) => c.danger !== null);
    } catch {
      return []; // Rust refuses dangerous paths anyway
    }
  }

  /** Unmarks the processed entries (not the failed ones) and reports errors. */
  private afterJob(
    id: string,
    side: Side,
    folder: string,
    paths: readonly string[],
    removes: boolean,
  ): void {
    const searchKey = this.ws.panel(side)?.store.searchKey() ?? null;
    void this.jobs.whenFinished(id).then((job: JobInfo) => {
      const store = this.ws.panel(side)?.store;
      const ran = job.state === 'done' || job.state === 'doneWithErrors';
      const failed = new Set(job.summary?.errors.map((e) => e.path) ?? []);
      const done = paths.filter((p) => !failed.has(p));
      // deleted or moved away from a result tab: they leave the result (design 009 E4) – only
      // if every entry went (errors/skips may concern entries inside a source folder)
      if (isUsageKey(searchKey)) {
        // disk usage (design 033 E3): Rust drops what is really gone and corrects the sums
        if (removes && job.state !== 'failed') {
          void this.usage.afterRemoval(scanIdOf(searchKey), done);
        }
      } else if (
        job.state === 'done' &&
        removes &&
        searchKey !== null &&
        (job.summary?.itemsSkipped ?? 0) === 0
      ) {
        this.search.removePaths(searchKey, done);
      }
      if (ran && store?.locationKey() === folder) {
        store.setMarked(done, false);
      }
      const summary = job.summary;
      if (job.state === 'failed' && summary?.error) {
        this.jobs.report(OPS_TEXTS.failed(jobTitle(job), errorText(summary.error)));
      } else if (job.state === 'doneWithErrors' && summary) {
        this.jobs.report(OPS_TEXTS.finishedWithErrors(jobTitle(job), summary.itemsFailed));
      }
    });
  }
}
