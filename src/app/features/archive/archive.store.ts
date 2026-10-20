import { inject, Injectable, signal } from '@angular/core';
import { ArchiveApi } from '../../core/archive/archive-api';
import {
  ArchivePasswordPrompt,
  isPasswordError,
  PasswordNeeded,
} from '../../core/archive/archive-password-prompt';
import {
  archiveFormatOf,
  canEncrypt,
  isArchiveEntry,
  stripArchiveExtension,
} from '../../core/archive/archive-names';
import { FsApi } from '../../core/fs/fs-api';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { ArchiveFormat, DirEntry, FsError } from '../../core/fs/fs.models';
import { ConflictDefault, JobInfo, JobSpec } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { Side } from '../../core/session/session.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { jobTitle } from '../jobs/job-format';
import { selectionForAction, TargetOption, targetOptions } from '../ops/ops-logic';
import { OPS_TEXTS } from '../ops/ops-texts';
import { WorkspaceStore } from '../workspace/workspace.store';
import { isSameOrBelow } from '../search/search.store';
import { ARCHIVE_TEXTS } from './archive-texts';

export interface PackRequest {
  readonly side: Side;
  readonly sources: readonly DirEntry[];
  /** Name of the folder the sources are in (default name for several sources). */
  readonly folderName: string | null;
  readonly target: string;
  readonly targets: readonly TargetOption[];
}

export interface UnpackJob {
  readonly archive: string;
  /** Virtual paths inside the archive, empty = everything. */
  readonly entries: readonly string[];
}

export interface UnpackRequest {
  readonly side: Side;
  readonly jobs: readonly UnpackJob[];
  /** Name of the single archive (for "into a subfolder"), null for several. */
  readonly archiveName: string | null;
  /** From a panel inside an archive (F5 / Alt+F9 there): entries, no subfolder by default. */
  readonly fromArchive: boolean;
  readonly entryCount: number;
  readonly target: string;
  readonly targets: readonly TargetOption[];
  /**
   * Offer a password field (design 025 E4): inside an encrypted archive without a
   * known password, and for archives not opened yet (Alt+F9 – unknown).
   */
  readonly askPassword: boolean;
}

/** The password dialog (design 025 E4); the archive path is shown as it is (opaque). */
export type PasswordRequest = PasswordNeeded;

export interface PackInput {
  readonly name: string;
  readonly format: ArchiveFormat;
  readonly level: number;
  readonly target: string;
  /** ZIP/7z only; empty = not encrypted. */
  readonly password?: string;
  /** Must equal `password` (typos would lock the data away). */
  readonly repeat?: string;
}

export interface UnpackInput {
  readonly target: string;
  readonly intoSubfolder: boolean;
  readonly conflictDefault: ConflictDefault;
  /** Optional: checked in Rust and kept there for this run. */
  readonly password?: string;
}

function err(code: FsError['code'], message: string): FsError {
  return { code, message, path: null };
}

/** UnRAR takes at most 511 characters (external review 025 #11, Rust `rar::MAX_PASSWORD_CHARS`). */
export const MAX_RAR_PASSWORD = 511;

/** A password UnRAR cannot take – a clear message instead of "wrong" for ever. */
function rarPasswordTooLong(archive: string, password: string): FsError | null {
  return archiveFormatOf(archive) === 'rar' && [...password].length > MAX_RAR_PASSWORD
    ? err('unknown', ARCHIVE_TEXTS.passwordTooLongRar(MAX_RAR_PASSWORD))
    : null;
}

/**
 * Pack (Alt+F5) and unpack / extract (Alt+F9, F5 inside an archive) – design
 * 016 E4/E5. Builds the dialog requests from the active panel and starts the
 * `pack` / `extract` jobs; panels showing the target reload via `dirsChanged`.
 */
@Injectable({ providedIn: 'root' })
export class ArchiveStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly fs = inject(FsApi);
  private readonly dialogs = inject(DialogService);
  private readonly api = inject(ArchiveApi);
  private readonly prompt = inject(ArchivePasswordPrompt);

  readonly pack = signal<PackRequest | null>(null);
  readonly unpack = signal<UnpackRequest | null>(null);
  readonly password = signal<PasswordRequest | null>(null);

  constructor() {
    // panels and jobs that hit an encrypted archive ask through the bridge (design 025 E4)
    this.prompt.setHandler((req) => this.askPassword(req));
  }

  /** Opens the password dialog; `retry` runs once the password fits. */
  askPassword(req: PasswordNeeded): void {
    if (this.dialogs.open() !== null && this.dialogs.open() !== 'archive-password') {
      // another dialog is open: report instead of stacking dialogs
      this.jobs.report(ARCHIVE_TEXTS.passwordNeeded(req.archive));
      return;
    }
    this.password.set(req);
    this.dialogs.show('archive-password');
  }

  /** Checks the password in Rust; null = accepted (dialog closed, retry runs) or the error. */
  async submitPassword(req: PasswordRequest, password: string): Promise<FsError | null> {
    if (password === '') {
      return err('archive_password_required', ARCHIVE_TEXTS.emptyPassword);
    }
    const tooLong = rarPasswordTooLong(req.archive, password);
    if (tooLong) {
      return tooLong;
    }
    try {
      await this.api.setPassword(req.archive, password);
    } catch (e) {
      return toFsError(e);
    }
    this.password.set(null);
    this.dialogs.close();
    await req.retry();
    return null;
  }

  closePassword(): void {
    this.password.set(null);
    this.dialogs.close();
  }

  /** A real folder of `side` (null for result tabs and archives) – a possible target. */
  private folderOf(side: Side): string | null {
    const store = this.ws.panel(side)?.store;
    return store && store.archive() === null ? store.path() : null;
  }

  /**
   * `path` is an archive shown as a folder, or lies inside one (archives seen
   * this session + those shown now) – never a target (review 016 #7).
   */
  isArchivePath(path: string): boolean {
    const roots = new Set(this.ws.archiveRoots());
    for (const s of ['left', 'right'] as const) {
      const info = this.ws.panel(s)?.store.archive();
      if (info) {
        roots.add(info.path);
      }
    }
    return [...roots].some((r) => isSameOrBelow(path, r));
  }

  private targetsFor(side: Side): { target: string; targets: readonly TargetOption[] } {
    const other = this.ws.targetDir(side);
    const panels = this.ws.panels();
    const tabPaths = [...panels.left.tabs, ...panels.right.tabs].map((t) => t.path);
    const targets = targetOptions(
      [
        { group: OPS_TEXTS.otherPanel, paths: [other] },
        { group: OPS_TEXTS.thisPanel, paths: [this.folderOf(side)] },
        { group: OPS_TEXTS.tabGroup, paths: tabPaths },
        { group: OPS_TEXTS.favouriteGroup, paths: [...this.ws.favorites()] },
        { group: OPS_TEXTS.recentGroup, paths: this.ws.recent() },
      ],
      (p) => this.isArchivePath(p),
    );
    return { target: other ?? this.folderOf(side) ?? '', targets };
  }

  /** The active panel shows a folder inside an archive. */
  inArchive(): boolean {
    return (this.ws.panel()?.store.archive() ?? null) !== null;
  }

  canPack(): boolean {
    const store = this.ws.panel()?.store;
    return (
      !!store &&
      store.locationKey() !== null &&
      store.archive() === null &&
      this.selection().length > 0
    );
  }

  /** Inside an archive (anything marked or under the cursor), or archive files are selected. */
  canUnpack(): boolean {
    const store = this.ws.panel()?.store;
    if (!store) {
      return false;
    }
    return store.archive() !== null || this.selection().some(isArchiveEntry);
  }

  private selection(): readonly DirEntry[] {
    return selectionForAction(this.ws.panel()?.store);
  }

  openPack(): void {
    const side = this.ws.source();
    const store = this.ws.panel(side)?.store;
    if (!store || store.archive() !== null) {
      throw err('unknown', ARCHIVE_TEXTS.readOnly);
    }
    const sources = this.selection();
    if (sources.length === 0) {
      throw err('unknown', OPS_TEXTS.nothingSelected);
    }
    const folderName =
      store.searchKey() === null ? (store.listing()?.segments.at(-1)?.name ?? null) : null;
    this.pack.set({ side, sources, folderName, ...this.targetsFor(side) });
    this.dialogs.show('pack');
  }

  /** Alt+F9, and F5 inside an archive. */
  openUnpack(): void {
    const side = this.ws.source();
    const store = this.ws.panel(side)?.store;
    if (!store) {
      return;
    }
    const info = store.archive();
    const sel = this.selection();
    let req: Omit<UnpackRequest, 'target' | 'targets'>;
    if (info) {
      req = {
        side,
        jobs: [{ archive: info.path, entries: sel.map((e) => e.path) }],
        archiveName: null,
        fromArchive: true,
        entryCount: sel.length,
        askPassword: !!info.encrypted && !info.passwordKnown,
      };
      if (sel.length === 0) {
        throw err('unknown', OPS_TEXTS.nothingSelected);
      }
    } else {
      const archives = sel.filter(isArchiveEntry);
      if (archives.length === 0) {
        throw err('unknown', ARCHIVE_TEXTS.noArchive);
      }
      req = {
        side,
        jobs: archives.map((a) => ({ archive: a.path, entries: [] })),
        archiveName: archives.length === 1 ? stripArchiveExtension(archives[0].name) : null,
        fromArchive: false,
        entryCount: archives.length,
        askPassword: true,
      };
    }
    this.unpack.set({ ...req, ...this.targetsFor(side) });
    this.dialogs.show('unpack');
  }

  close(): void {
    this.pack.set(null);
    this.unpack.set(null);
    this.dialogs.close();
  }

  private async resolveTarget(raw: string): Promise<string | FsError> {
    const t = raw.trim();
    if (t === '') {
      return err('invalid_path', ARCHIVE_TEXTS.emptyTarget);
    }
    try {
      const loc = await this.fs.resolveLocation(t);
      return loc.select !== null ? err('not_a_directory', ARCHIVE_TEXTS.targetIsFile) : loc.dir;
    } catch (e) {
      return toFsError(e);
    }
  }

  /** Starts the pack job. Returns an error for the dialog, or null (closed). */
  async runPack(req: PackRequest, input: PackInput): Promise<FsError | null> {
    const name = input.name.trim();
    if (name === '') {
      return err('invalid_name', ARCHIVE_TEXTS.emptyName);
    }
    const password = canEncrypt(input.format) ? (input.password ?? '') : '';
    if (password !== (canEncrypt(input.format) ? (input.repeat ?? '') : '')) {
      return err('unknown', ARCHIVE_TEXTS.passwordsDiffer);
    }
    const dir = await this.resolveTarget(input.target);
    if (typeof dir !== 'string') {
      return dir;
    }
    const spec: JobSpec = {
      kind: 'pack',
      sources: req.sources.map((e) => e.path),
      targetDir: dir,
      name,
      format: input.format,
      level: input.level,
      ...(password !== '' ? { password } : {}),
    };
    try {
      this.watch(await this.jobs.start(spec));
    } catch (e) {
      return toFsError(e);
    }
    this.ws.addRecent(dir);
    this.close();
    return null;
  }

  /** Starts one extract job per archive. Returns an error for the dialog, or null (closed). */
  async runUnpack(req: UnpackRequest, input: UnpackInput): Promise<FsError | null> {
    const dir = await this.resolveTarget(input.target);
    if (typeof dir !== 'string') {
      return dir;
    }
    const password = input.password ?? '';
    if (password !== '') {
      // checked per archive before any job starts – a wrong one stays in the dialog
      for (const job of req.jobs) {
        const tooLong = rarPasswordTooLong(job.archive, password);
        if (tooLong) {
          return tooLong;
        }
        try {
          await this.api.setPassword(job.archive, password);
        } catch (e) {
          const error = toFsError(e);
          // archives without encryption accept nothing to check – only real errors count
          if (req.jobs.length === 1 || !isPasswordError(error)) {
            return error;
          }
        }
      }
    }
    for (const job of req.jobs) {
      const spec: JobSpec = {
        kind: 'extract',
        archive: job.archive,
        entries: job.entries,
        targetDir: dir,
        intoSubfolder: input.intoSubfolder,
        options: { conflictDefault: input.conflictDefault },
      };
      try {
        await this.startExtract(
          spec,
          req.fromArchive ? { side: req.side, paths: job.entries } : null,
        );
      } catch (e) {
        return toFsError(e);
      }
    }
    this.ws.addRecent(dir);
    this.close();
    return null;
  }

  /** Starts an extract job; a password error asks for it and starts the job again. */
  private async startExtract(
    spec: JobSpec & { kind: 'extract' },
    marked: { side: Side; paths: readonly string[] } | null,
  ): Promise<void> {
    const id = await this.jobs.start(spec);
    this.watch(id, marked, () => void this.startExtract(spec, marked).catch(() => undefined));
  }

  /**
   * Errors of a finished job go to the status message (details in Tasks);
   * extracted entries are unmarked like copied ones (failed ones stay marked).
   */
  private watch(
    id: string,
    marked: { side: Side; paths: readonly string[] } | null = null,
    retry: (() => void) | null = null,
  ): void {
    void this.jobs.whenFinished(id).then((job: JobInfo) => {
      const summary = job.summary;
      const archive = job.spec.kind === 'extract' ? job.spec.archive : null;
      if (job.state === 'failed' && summary?.error && retry && archive) {
        if (this.prompt.askFor(summary.error, archive, retry)) {
          return;
        }
      }
      if (marked && (job.state === 'done' || job.state === 'doneWithErrors')) {
        const failed = new Set(summary?.errors.map((e) => e.path) ?? []);
        this.ws.panel(marked.side)?.store.setMarked(
          marked.paths.filter((p) => !failed.has(p)),
          false,
        );
      }
      if (job.state === 'failed' && summary?.error) {
        this.jobs.report(OPS_TEXTS.failed(jobTitle(job), errorText(summary.error)));
      } else if (job.state === 'doneWithErrors' && summary) {
        this.jobs.report(OPS_TEXTS.finishedWithErrors(jobTitle(job), summary.itemsFailed));
      }
    });
  }
}
