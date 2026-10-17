import { inject, Injectable, signal } from '@angular/core';
import { FsApi } from '../../core/fs/fs-api';
import { toFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError, PathCheck } from '../../core/fs/fs.models';
import { ConflictDefault, DeleteMode, JobInfo, JobSpec } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { Side } from '../../core/session/session.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { jobTitle } from '../jobs/job-format';
import { otherSide, WorkspaceStore } from '../workspace/workspace.store';
import {
  cursorAfterRemoval,
  selectionForAction,
  stemLength,
  suggestFolderName,
  TargetOption,
  targetOptions,
} from './ops-logic';
import { OPS_TEXTS } from './ops-texts';

export interface CopyMoveRequest {
  readonly kind: 'copy' | 'move';
  readonly side: Side;
  readonly sourceDir: string;
  readonly sources: readonly DirEntry[];
  /** Pre-filled target: the other panel's folder. */
  readonly target: string;
  readonly targets: readonly TargetOption[];
  /** Root/home/system paths among the sources (moving them needs a second confirmation). */
  readonly dangers: readonly PathCheck[];
}

export interface CopyMoveInput {
  readonly target: string;
  /** Name in the target folder (single source only). */
  readonly name: string | null;
  readonly conflictDefault: ConflictDefault;
  readonly background: boolean;
  readonly allowDangerous: boolean;
}

export interface DeleteRequest {
  readonly mode: DeleteMode;
  readonly side: Side;
  readonly sourceDir: string;
  readonly entries: readonly DirEntry[];
  readonly dangers: readonly PathCheck[];
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

  readonly copyMove = signal<CopyMoveRequest | null>(null);
  readonly del = signal<DeleteRequest | null>(null);
  readonly name = signal<NameRequest | null>(null);

  /** The entries an operation of the active panel works on. */
  selection(): readonly DirEntry[] {
    return selectionForAction(this.ws.panel()?.store);
  }

  folder(): string | null {
    return this.ws.panel()?.store.path() ?? null;
  }

  // ---- open the dialogs ----

  async openCopyMove(kind: 'copy' | 'move'): Promise<void> {
    const side = this.ws.source();
    const sourceDir = this.folder();
    const sources = this.selection();
    if (sourceDir === null) {
      throw err('unknown', OPS_TEXTS.noFolder);
    }
    if (sources.length === 0) {
      throw err('unknown', OPS_TEXTS.nothingSelected);
    }
    const other = this.ws.panel(otherSide(side))?.store.path() ?? null;
    const panels = this.ws.panels();
    const tabPaths = [...panels.left.tabs, ...panels.right.tabs].map((t) => t.path);
    const targets = targetOptions([
      { group: 'Other panel', paths: [other] },
      { group: 'Tab', paths: tabPaths },
      { group: 'Favourite', paths: [...this.ws.favorites()] },
      { group: 'Recent', paths: this.ws.recent() },
    ]);
    const dangers = kind === 'move' ? await this.dangers(sources) : [];
    this.copyMove.set({
      kind,
      side,
      sourceDir,
      sources,
      target: other ?? sourceDir,
      targets,
      dangers,
    });
    this.dialogs.show('copy-move');
  }

  async openDelete(mode: DeleteMode): Promise<void> {
    const sourceDir = this.folder();
    const entries = this.selection();
    if (sourceDir === null) {
      throw err('unknown', OPS_TEXTS.noFolder);
    }
    if (entries.length === 0) {
      throw err('unknown', OPS_TEXTS.nothingSelected);
    }
    const dangers = await this.dangers(entries);
    this.del.set({ mode, side: this.ws.source(), sourceDir, entries, dangers });
    this.dialogs.show('delete');
  }

  openName(kind: NameRequest['kind']): void {
    const side = this.ws.source();
    const store = this.ws.panel(side)?.store;
    const parent = store?.path() ?? null;
    if (!store || parent === null) {
      throw err('unknown', OPS_TEXTS.noFolder);
    }
    if (kind === 'rename') {
      const sel = this.selection();
      if (sel.length !== 1) {
        throw err('unknown', sel.length === 0 ? OPS_TEXTS.nothingSelected : OPS_TEXTS.oneEntry);
      }
      const entry = sel[0];
      this.name.set({
        kind,
        side,
        parent,
        initial: entry.name,
        selectEnd: stemLength(entry.name, entry.kind === 'directory'),
        entry,
      });
    } else {
      const basis = this.selection()[0] ?? null;
      const initial =
        kind === 'mkdir'
          ? suggestFolderName(
              store.entries().map((e) => e.name),
              basis,
            )
          : '';
      this.name.set({ kind, side, parent, initial, selectEnd: initial.length, entry: null });
    }
    this.dialogs.show('name');
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
    if (dir === req.sourceDir && renameTo === null) {
      return err('same_source_target', single ? OPS_TEXTS.sameFolder : OPS_TEXTS.sameFolderMulti);
    }
    const sources = req.sources.map((e) => e.path);
    const options = { conflictDefault: input.conflictDefault, renameTo };
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
          };
    let id: string;
    try {
      id = await this.jobs.start(spec);
    } catch (e) {
      return toFsError(e);
    }
    this.ws.addRecent(dir);
    this.close();
    this.afterJob(id, req.side, req.sourceDir, sources);
    return null;
  }

  /** Starts the delete job; the cursor moves to the next remaining entry at once. */
  async runDelete(req: DeleteRequest, allowDangerous: boolean): Promise<FsError | null> {
    const paths = req.entries.map((e) => e.path);
    const panel = this.ws.panel(req.side);
    let id: string;
    try {
      id = await this.jobs.start({ kind: 'delete', paths, mode: req.mode, allowDangerous });
    } catch (e) {
      return toFsError(e);
    }
    if (panel && panel.store.path() === req.sourceDir) {
      const displayed = panel.controller()?.displayedEntries() ?? panel.store.visibleEntries();
      panel.store.setCursor(
        cursorAfterRemoval(displayed, new Set(paths), panel.store.cursorPath()),
      );
    }
    this.close();
    this.afterJob(id, req.side, req.sourceDir, paths);
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
    this.refreshFolder(req.parent, req.side, result);
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

  private async dangers(entries: readonly DirEntry[]): Promise<readonly PathCheck[]> {
    try {
      const checks = await this.fs.checkPaths(entries.map((e) => e.path));
      return checks.filter((c) => c.danger !== null);
    } catch {
      return []; // Rust refuses dangerous paths anyway
    }
  }

  /** Unmarks the processed entries (not the failed ones) and reports errors. */
  private afterJob(id: string, side: Side, folder: string, paths: readonly string[]): void {
    void this.jobs.whenFinished(id).then((job: JobInfo) => {
      const store = this.ws.panel(side)?.store;
      if ((job.state === 'done' || job.state === 'doneWithErrors') && store?.path() === folder) {
        const failed = new Set(job.summary?.errors.map((e) => e.path) ?? []);
        store.setMarked(
          paths.filter((p) => !failed.has(p)),
          false,
        );
      }
      const summary = job.summary;
      if (job.state === 'failed' && summary?.error) {
        this.jobs.report(OPS_TEXTS.failed(jobTitle(job), summary.error.message));
      } else if (job.state === 'doneWithErrors' && summary) {
        this.jobs.report(OPS_TEXTS.finishedWithErrors(jobTitle(job), summary.itemsFailed));
      }
    });
  }
}
