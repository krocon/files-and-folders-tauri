import { inject, Injectable, signal } from '@angular/core';
import { isNavigableDir } from '../../core/fs/fs.models';
import { Side } from '../../core/session/session.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { SearchStore } from '../search/search.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import {
  DEFAULT_DUP_FORM,
  DupField,
  DuplicatesForm,
  formToDuplicateCriteria,
} from './duplicates-form';
import { DUP_TEXTS } from './duplicates-texts';
import { KeepRule, marksKeepingOne } from './duplicates-logic';
import { errorText } from '../../core/fs/fs-error';

export interface DuplicatesRequest {
  readonly side: Side;
  /** The panel's folder (or the folders of the duplicate tab it was opened from). */
  readonly folder: readonly string[];
  readonly marked: readonly string[];
}

/**
 * Duplicate search (OPEN_FIND_DUPLICATES_DLG, design 016 E6): the dialog, the
 * start (a `duplicates` job shown in a result tab by the `SearchStore`) and
 * the selection helpers of a duplicate tab.
 */
@Injectable({ providedIn: 'root' })
export class DuplicatesStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly search = inject(SearchStore);
  private readonly dialogs = inject(DialogService);

  readonly request = signal<DuplicatesRequest | null>(null);
  readonly form = signal<DuplicatesForm>(DEFAULT_DUP_FORM);
  readonly where = signal<'folder' | 'marked'>('folder');
  readonly error = signal<{ field: DupField | null; message: string } | null>(null);
  readonly busy = signal(false);

  /**
   * The result (duplicates or search hits) shown on the active side, or null –
   * its roots are where a duplicate search from there looks.
   */
  private activeResult(): { key: string; roots: readonly string[] } | null {
    const side = this.ws.activeSide();
    const key = this.ws.activeTab(side).search?.key;
    const r = key ? this.search.result(key) : undefined;
    return r && r.criteria.roots.length > 0 ? { key: r.key, roots: r.criteria.roots } : null;
  }

  /** A real folder (not inside an archive) or a result tab is shown on the active side. */
  canOpen(): boolean {
    const store = this.ws.panel(this.ws.activeSide())?.store;
    return (store?.path() != null && store.archive() === null) || this.activeResult() !== null;
  }

  open(): void {
    const side = this.ws.activeSide();
    const store = this.ws.panel(side)?.store;
    const dup = this.activeResult();
    let folder: readonly string[];
    if (dup) {
      folder = dup.roots;
    } else {
      const path = store?.path() ?? null;
      if (path === null || store?.archive()) {
        return;
      }
      folder = [path];
    }
    const marked = dup
      ? []
      : (store?.markedEntries() ?? [])
          .filter((e) => isNavigableDir(e) && !e.lossyName)
          .map((e) => e.path);
    this.where.set(marked.length > 0 ? 'marked' : 'folder');
    this.error.set(null);
    this.request.set({ side, folder, marked });
    this.dialogs.show('duplicates');
  }

  update(patch: Partial<DuplicatesForm>): void {
    this.form.update((f) => ({ ...f, ...patch }));
    this.error.set(null);
  }

  async run(): Promise<void> {
    const req = this.request();
    if (!req || this.busy()) {
      return;
    }
    const roots = this.where() === 'marked' && req.marked.length > 0 ? req.marked : req.folder;
    if (roots.length === 0) {
      this.error.set({ field: null, message: DUP_TEXTS.noFolder });
      return;
    }
    const built = formToDuplicateCriteria(this.form(), roots);
    if ('error' in built) {
      this.error.set(built.error);
      return;
    }
    this.busy.set(true);
    try {
      const error = await this.search.findDuplicates(built.criteria, req.side);
      if (error) {
        this.error.set({ field: null, message: errorText(error) });
        return;
      }
      this.close();
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    if (this.request()) {
      this.request.set(null);
      this.dialogs.close();
    }
  }

  /**
   * The active panel shows duplicates (the selection helpers work there) – not
   * for "same size only": nothing says those files are copies (review 016 #6).
   */
  canMark(): boolean {
    const store = this.ws.panel()?.store;
    return (
      !!store &&
      store.searchKey() !== null &&
      store.searchKind() === 'duplicates' &&
      !this.sizeOnly()
    );
  }

  /** The duplicates shown on `side` were compared by size only. */
  sizeOnly(side: Side = this.ws.activeSide()): boolean {
    return this.search.sizeOnly(this.ws.panel(side)?.store.searchKey());
  }

  /** Marks every shown file of each group except the one `rule` keeps. */
  markAllBut(rule: KeepRule): void {
    const store = this.ws.panel()?.store;
    if (!store || !this.canMark()) {
      return;
    }
    store.clearMarks();
    store.setMarked(marksKeepingOne(store.visibleEntries(), rule), true);
  }
}
