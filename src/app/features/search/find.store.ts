import { inject, Injectable, signal } from '@angular/core';
import { isNavigableDir } from '../../core/fs/fs.models';
import { Side } from '../../core/session/session.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { DEFAULT_FORM, errorField, FindForm, FormError, formToCriteria } from './find-form';
import { SEARCH_TEXTS } from './search-texts';
import { SearchStore } from './search.store';

/** What the find dialog works on. */
export interface FindRequest {
  readonly side: Side;
  /** The panel's folder, or the folders of the result tab it was opened from. */
  readonly folder: readonly string[];
  /** Marked folders of the panel (search in them instead). */
  readonly marked: readonly string[];
  /** Opened from a result tab: run again in that tab unless "new tab" is chosen. */
  readonly reuse: { readonly tabId: string; readonly key: string } | null;
}

/**
 * The find dialog (OPEN_FIND_DLG, Alt+F7, design 009 E5): builds the request
 * from the active panel, keeps the fields for the session and starts the search.
 */
@Injectable({ providedIn: 'root' })
export class FindStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly search = inject(SearchStore);
  private readonly dialogs = inject(DialogService);

  readonly request = signal<FindRequest | null>(null);
  readonly form = signal<FindForm>(DEFAULT_FORM);
  readonly where = signal<'folder' | 'marked'>('folder');
  readonly newTab = signal(true);
  readonly error = signal<FormError | null>(null);
  readonly busy = signal(false);

  /** A folder or a result tab is shown on the active side. */
  canOpen(): boolean {
    const side = this.ws.activeSide();
    return this.ws.panel(side)?.store.path() != null || !!this.ws.activeTab(side).search;
  }

  open(): void {
    const side = this.ws.activeSide();
    const store = this.ws.panel(side)?.store;
    const tab = this.ws.activeTab(side);
    const result = tab.search ? this.search.result(tab.search.key) : undefined;
    let folder: readonly string[];
    let reuse: FindRequest['reuse'] = null;
    if (tab.search && result) {
      folder = result.criteria.roots;
      reuse = { tabId: tab.id, key: tab.search.key };
      if (result.form) {
        this.form.set(result.form);
      }
    } else {
      const path = store?.path() ?? null;
      if (path === null) {
        return;
      }
      folder = [path];
    }
    const marked = (store?.markedEntries() ?? [])
      .filter((e) => isNavigableDir(e) && !e.lossyName)
      .map((e) => e.path);
    this.where.set(marked.length > 0 && !reuse ? 'marked' : 'folder');
    this.newTab.set(reuse === null);
    this.error.set(null);
    this.request.set({ side, folder, marked, reuse });
    this.dialogs.show('find');
  }

  update(patch: Partial<FindForm>): void {
    this.form.update((f) => ({ ...f, ...patch }));
    this.error.set(null);
  }

  /** A recent search or template: its fields (the folders stay). */
  apply(form: FindForm): void {
    this.form.set(form);
    this.error.set(null);
  }

  saveTemplate(label: string): void {
    this.search.saveTemplate(label, this.form());
  }

  async run(): Promise<void> {
    const req = this.request();
    if (!req || this.busy()) {
      return;
    }
    const roots = this.where() === 'marked' && req.marked.length > 0 ? req.marked : req.folder;
    if (roots.length === 0) {
      this.error.set({ field: 'name', message: SEARCH_TEXTS.noFolder });
      return;
    }
    const built = formToCriteria(this.form(), roots);
    if ('error' in built) {
      this.error.set(built.error);
      return;
    }
    this.busy.set(true);
    try {
      const reuse = this.newTab() ? null : req.reuse;
      const error = await this.search.search(built.criteria, req.side, reuse, this.form());
      if (error) {
        this.error.set({ field: errorField(error) ?? 'name', message: error.message });
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
}
