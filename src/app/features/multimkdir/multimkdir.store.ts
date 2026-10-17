import { computed, inject, Injectable, signal } from '@angular/core';
import { FoldersApi } from '../../core/folders/folders-api';
import { describeFsError, toFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { Side } from '../../core/session/session.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { parentNames } from '../multirename/multirename-logic';
import { WorkspaceStore } from '../workspace/workspace.store';
import { DEFAULT_MKDIR, folderNames, MkdirTemplate } from './mkdir-engine';
import { MM_TEXTS } from './multimkdir-texts';

export interface MkdirRequest {
  readonly side: Side;
  readonly parent: string;
  readonly parents: readonly [string, string, string];
}

export interface MkdirRow {
  readonly nr: number;
  readonly name: string;
  readonly info: string;
  readonly error: boolean;
}

function err(message: string): FsError {
  return { code: 'unknown', message, path: null };
}

/**
 * Multi-MkDir (OPEN_MULTIMKDIR_DLG, design 008 E4): names from the template
 * (pure engine), created by one Rust command that never touches an existing
 * entry; names that failed stay in the dialog.
 */
@Injectable({ providedIn: 'root' })
export class MultiMkdirStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly api = inject(FoldersApi);
  private readonly dialogs = inject(DialogService);

  readonly request = signal<MkdirRequest | null>(null);
  readonly template = signal<MkdirTemplate>(DEFAULT_MKDIR);
  readonly busy = signal(false);
  readonly runError = signal<string | null>(null);

  readonly outcome = computed(() => {
    const req = this.request();
    return folderNames(this.template(), req?.parents ?? ['', '', '']);
  });
  readonly rows = computed<readonly MkdirRow[]>(() =>
    this.outcome().names.map((n, i) => ({
      nr: i + 1,
      name: n.name,
      info: n.error ?? MM_TEXTS.ok,
      error: n.error !== null,
    })),
  );
  /** After a partial failure Create waits for a change (review 008 #6): the same names again would only fail again. */
  readonly canRun = computed(() => {
    const o = this.outcome();
    return (
      !this.busy() &&
      this.runError() === null &&
      o.error === null &&
      o.names.length > 0 &&
      o.names.every((n) => !n.error)
    );
  });

  hasFolder(): boolean {
    return (this.ws.panel()?.store.path() ?? null) !== null;
  }

  open(): void {
    const side = this.ws.source();
    const store = this.ws.panel(side)?.store;
    const parent = store?.path() ?? null;
    if (!store || parent === null) {
      throw err(MM_TEXTS.noFolder);
    }
    // the new folders go *into* this folder: its name is [P] (as for files in 007)
    const parents = parentNames(store.listing()?.segments ?? []);
    this.busy.set(false);
    this.runError.set(null);
    this.request.set({ side, parent, parents });
    this.dialogs.show('multi-mkdir');
  }

  update(patch: Partial<MkdirTemplate>): void {
    this.template.set({ ...this.template(), ...patch });
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
    const names = this.outcome().names.map((n) => n.name);
    this.busy.set(true);
    try {
      const res = await this.api.createFolders(req.parent, names);
      this.refresh(req, res.created[0] ?? null);
      if (res.errors.length > 0) {
        const list = res.errors.map((e) => `${e.name} (${describeFsError(e.error)})`).join(', ');
        this.runError.set(MM_TEXTS.notCreated(list));
        return;
      }
      this.jobs.report(MM_TEXTS.created(res.created.length));
      this.close();
    } catch (e) {
      this.runError.set(toFsError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  private refresh(req: MkdirRequest, cursor: string | null): void {
    for (const s of ['left', 'right'] as const) {
      const store = this.ws.panel(s)?.store;
      if (!store || store.path() !== req.parent || store.navigationLocked()) {
        continue;
      }
      if (s === req.side && cursor !== null) {
        store.setCursor(cursor);
      }
      void store.refresh();
    }
  }
}
