import { computed, inject, Injectable, signal } from '@angular/core';
import {
  CHECKSUM_ALGOS,
  ChecksumAlgo,
  checksumAlgoOfName,
  ChecksumSummary,
} from '../../core/checksum/checksum.models';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError, isNavigableDir } from '../../core/fs/fs.models';
import { JobInfo } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { ClipboardApi } from '../../core/os/clipboard';
import { Side } from '../../core/session/session.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { recallDialog, rememberDialog } from '../../shared/dialog-memory';
import { oneOf, record } from '../../shared/restore-fields';
import { selectionForAction } from '../ops/ops-logic';
import { WorkspaceStore } from '../workspace/workspace.store';
import { CS_TEXTS } from './checksum-texts';

export type ChecksumMode = 'list' | 'perFile';

export interface ChecksumForm {
  readonly algo: ChecksumAlgo;
  readonly mode: ChecksumMode;
}

export const DEFAULT_CHECKSUM_FORM: ChecksumForm = { algo: 'sha256', mode: 'list' };

/** The form kept from the last run (design 027 E5 / 039). */
export function restoreChecksumForm(v: unknown): ChecksumForm {
  const r = record(v);
  return {
    algo: oneOf(r['algo'], CHECKSUM_ALGOS, DEFAULT_CHECKSUM_FORM.algo),
    mode: oneOf(r['mode'], ['list', 'perFile'] as const, DEFAULT_CHECKSUM_FORM.mode),
  };
}

/** Default name of a list: `<file>.<ext>` for one file, else `CHECKSUMS.<ext>`. */
export function defaultListName(entries: readonly DirEntry[], algo: ChecksumAlgo): string {
  const single = entries.length === 1 && !isNavigableDir(entries[0]);
  return `${single ? entries[0].name : 'CHECKSUMS'}.${algo}`;
}

export interface ChecksumRequest {
  readonly side: Side;
  readonly folder: string;
  readonly entries: readonly DirEntry[];
  /** Names in the folder (to tell whether the list file exists). */
  readonly names: ReadonlySet<string>;
}

export interface ChecksumResult {
  readonly side: Side;
  readonly list: DirEntry;
  readonly folder: string;
  readonly summary: ChecksumSummary;
  readonly cancelled: boolean;
}

function err(message: string): FsError {
  return { code: 'unknown', message, path: null };
}

/**
 * Checksums (design 039): the create dialog (job `checksum`), verifying a checksum
 * file (job `verifyChecksums`, result dialog) and the SHA-256 of the cursor file
 * for the clipboard.
 */
@Injectable({ providedIn: 'root' })
export class ChecksumStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly dialogs = inject(DialogService);
  private readonly settings = inject(SettingsStore);
  private readonly clipboard = inject(ClipboardApi);
  private recalled = false;

  readonly request = signal<ChecksumRequest | null>(null);
  readonly form = signal<ChecksumForm>(DEFAULT_CHECKSUM_FORM);
  /** The list name; follows the algorithm until the user types one. */
  readonly name = signal('');
  private nameEdited = false;
  readonly overwrite = signal(false);
  readonly busy = signal(false);
  readonly runError = signal<string | null>(null);
  readonly result = signal<ChecksumResult | null>(null);

  readonly nameExists = computed(() => {
    const req = this.request();
    return req !== null && this.form().mode === 'list' && req.names.has(this.name().trim());
  });
  readonly canRun = computed(
    () =>
      !this.busy() &&
      this.request() !== null &&
      (this.form().mode === 'perFile' ||
        (this.name().trim() !== '' && (!this.nameExists() || this.overwrite()))),
  );

  /** A folder tab (not a result, archive or server – vetoed there) with something to hash. */
  hasFolder(): boolean {
    const store = this.ws.panel()?.store;
    return !!store && store.path() !== null && store.searchKey() === null;
  }

  /** The cursor is on a checksum file. */
  cursorList(): DirEntry | null {
    const e = this.ws.panel()?.controller()?.cursorEntry() ?? null;
    return e && e.kind === 'file' && checksumAlgoOfName(e.name) !== null ? e : null;
  }

  /** The cursor is on a file. */
  cursorFile(): DirEntry | null {
    const e = this.ws.panel()?.controller()?.cursorEntry() ?? null;
    // links are never followed by the checksum job
    return e && e.kind === 'file' ? e : null;
  }

  open(): void {
    const side = this.ws.source();
    const panel = this.ws.panel(side);
    const folder = panel?.store.path() ?? null;
    if (!panel || folder === null) {
      throw err(CS_TEXTS.noFolder);
    }
    const entries = selectionForAction({
      markedEntries: () => panel.store.markedEntries(),
      cursorEntry: () => panel.controller()?.cursorEntry() ?? null,
    });
    if (entries.length === 0) {
      throw err(CS_TEXTS.nothingSelected);
    }
    if (!this.recalled) {
      this.recalled = true;
      const kept = recallDialog(this.settings, 'checksum');
      if (kept !== undefined) {
        this.form.set(restoreChecksumForm(kept));
      }
    }
    this.nameEdited = false;
    this.name.set(defaultListName(entries, this.form().algo));
    this.overwrite.set(false);
    this.busy.set(false);
    this.runError.set(null);
    const names = new Set(panel.store.entries().map((e) => e.name));
    this.request.set({ side, folder, entries, names });
    this.dialogs.show('checksum');
  }

  update(patch: Partial<ChecksumForm>): void {
    this.form.set({ ...this.form(), ...patch });
    const req = this.request();
    if (req && !this.nameEdited) {
      this.name.set(defaultListName(req.entries, this.form().algo));
    }
    this.runError.set(null);
  }

  setName(name: string): void {
    this.nameEdited = true;
    this.name.set(name);
    this.overwrite.set(false);
    this.runError.set(null);
  }

  close(): void {
    this.request.set(null);
    this.dialogs.close();
  }

  async run(): Promise<void> {
    const req = this.request();
    if (!req || !this.canRun()) {
      return;
    }
    const { algo, mode } = this.form();
    this.busy.set(true);
    let id: string;
    try {
      id = await this.jobs.start({
        kind: 'checksum',
        paths: req.entries.map((e) => e.path),
        baseDir: req.folder,
        algo,
        output:
          mode === 'list'
            ? { kind: 'list', name: this.name().trim(), overwrite: this.overwrite() }
            : { kind: 'perFile', overwrite: false },
      });
    } catch (e) {
      this.runError.set(errorText(toFsError(e)));
      this.busy.set(false);
      return;
    }
    rememberDialog(this.settings, 'checksum', this.form());
    this.close();
    this.busy.set(false);
    void this.jobs.whenFinished(id).then((job) => this.afterCreate(job, mode));
  }

  private afterCreate(job: JobInfo, mode: ChecksumMode): void {
    const s = job.summary;
    if (job.state === 'failed') {
      this.jobs.report(CS_TEXTS.failed(s?.error ? errorText(s.error) : ''));
    } else if ((job.state === 'done' || job.state === 'doneWithErrors') && s) {
      this.jobs.report(
        mode === 'list'
          ? CS_TEXTS.written(s.itemsDone, s.checksums?.file ?? '')
          : CS_TEXTS.writtenPerFile(s.itemsDone, s.itemsSkipped),
      );
    }
  }

  /** Verifies the checksum file under the cursor; the result opens in a dialog. */
  async verify(): Promise<void> {
    const side = this.ws.source();
    const store = this.ws.panel(side)?.store;
    const list = this.cursorList();
    const folder = store?.path() ?? null;
    if (!store || !list || folder === null) {
      throw err(CS_TEXTS.noChecksumFile);
    }
    const id = await this.jobs.start({ kind: 'verifyChecksums', file: list.path });
    const job = await this.jobs.whenFinished(id);
    const summary = job.summary?.checksums;
    if (job.state === 'failed' || !summary) {
      this.jobs.report(CS_TEXTS.failed(job.summary?.error ? errorText(job.summary.error) : ''));
      return;
    }
    this.result.set({ side, list, folder, summary, cancelled: job.state === 'cancelled' });
    this.dialogs.show('checksum-result');
  }

  closeResult(): void {
    this.result.set(null);
    this.dialogs.close();
  }

  /** Marks the changed and unreadable files that the panel still shows (design 039). */
  markChanged(): void {
    const r = this.result();
    const store = this.ws.panel(r?.side)?.store;
    if (!r || !store || store.path() !== r.folder) {
      return;
    }
    const shown = new Set(store.entries().map((e) => e.path));
    const paths = r.summary.problems
      .filter((p) => (p.kind === 'mismatch' || p.kind === 'unreadable') && p.path !== null)
      .map((p) => p.path as string)
      .filter((p) => shown.has(p));
    store.setMarked(paths, true);
    this.jobs.report(CS_TEXTS.marked(paths.length));
    this.closeResult();
  }

  /** SHA-256 of the cursor file to the clipboard. */
  async copyDigest(algo: ChecksumAlgo = 'sha256'): Promise<void> {
    const file = this.cursorFile();
    const folder = this.ws.actionDir();
    if (!file || folder === null) {
      throw err(CS_TEXTS.noFile);
    }
    const id = await this.jobs.start({
      kind: 'checksum',
      paths: [file.path],
      baseDir: folder,
      algo,
      output: { kind: 'show' },
    });
    const job = await this.jobs.whenFinished(id);
    const hex = job.summary?.checksums?.digests[0]?.hex;
    if (job.state !== 'done' || !hex) {
      this.jobs.report(CS_TEXTS.failed(job.summary?.error ? errorText(job.summary.error) : ''));
      return;
    }
    await this.clipboard.writeText(hex);
    this.jobs.report(CS_TEXTS.copied(algo.toUpperCase(), file.name));
  }
}
