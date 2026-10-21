import { inject, Injectable, signal } from '@angular/core';
import { ActionService, ExtraAction } from '../../core/actions/action.service';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { isParentRow } from '../../core/fs/fs.models';
import { StarterApi } from '../../core/starter/starter-api';
import {
  SavedStarter,
  StarterContext,
  StarterItem,
  StarterProblem,
} from '../../core/starter/starter.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CONFIG_TEXTS } from '../config/config-texts';
import { OsStore } from '../osintegration/os.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { menuTree, problemMap, runnable, starterActionId } from './starter-logic';
import { STARTER_TEXTS } from './starter-texts';

const SOURCE = 'starter';

/**
 * The starter menu (design 032, Total Commander's Start menu): loads `starter.json`,
 * offers every program/folder entry as an extra action (`starter:<id>`, with its own
 * shortcut) and the tree to the menus. Root.
 */
@Injectable({ providedIn: 'root' })
export class StarterStore {
  private readonly api = inject(StarterApi);
  private readonly actions = inject(ActionService);
  private readonly ws = inject(WorkspaceStore);
  private readonly os = inject(OsStore);
  private readonly dialogs = inject(DialogService);

  readonly items = signal<readonly StarterItem[]>([]);
  readonly problems = signal<readonly StarterProblem[]>([]);
  readonly file = signal<string | null>(null);
  /** Last success message (live region). */
  readonly status = signal('');

  /** Loads `starter.json` and offers the entries as actions; problems are reported. */
  async init(): Promise<void> {
    try {
      const loaded = await this.api.load();
      this.file.set(loaded.file);
      this.apply(loaded.items, loaded.problems);
      if (loaded.warning) {
        const name = 'starter.json';
        const w = loaded.warning;
        this.actions.report(
          w.code === 'unreadable'
            ? CONFIG_TEXTS.unreadable(name)
            : w.path
              ? CONFIG_TEXTS.brokenKept(name, w.path)
              : CONFIG_TEXTS.brokenStayed(name),
        );
      }
    } catch (err) {
      this.apply([], []);
      this.actions.report(STARTER_TEXTS.loadFailed(errorText(toFsError(err))));
    }
  }

  /** Writes the draft; `saved: false` comes back with the problems of the entries. */
  async save(items: readonly StarterItem[]): Promise<SavedStarter> {
    const result = await this.api.save(items);
    if (result.saved) {
      this.apply(result.items, []);
    }
    return result;
  }

  openEditor(): void {
    this.dialogs.show('starter-config');
  }

  private apply(items: readonly StarterItem[], problems: readonly StarterProblem[]): void {
    this.items.set(items);
    this.problems.set(problems);
    const why = problemMap(problems);
    this.actions.setExtras(
      runnable(items).map((it) => this.extra(it, why.get(it.id) ?? null)),
      SOURCE,
    );
    this.actions.starterTree.set(menuTree(items));
  }

  private extra(it: StarterItem, problem: string | null): ExtraAction {
    const hint = problem
      ? STARTER_TEXTS.problems[problem as keyof typeof STARTER_TEXTS.problems]
      : (it.kind === 'folder' ? it.folder : [it.program, it.params].filter(Boolean).join(' ')) ||
        undefined;
    return {
      id: starterActionId(it.id),
      label: it.label ?? '',
      shortcut: it.shortcut ?? null,
      category: STARTER_TEXTS.category,
      hint,
      // programs start without a folder too (home); folders always work
      enabled: () => problem === null,
      run: () => this.run(it.id),
    };
  }

  /** What an entry works on: the marked entries, the cursor and both folders. */
  context(): StarterContext {
    const cursor = this.ws.panel()?.store.cursorEntry() ?? null;
    return {
      files: this.os.selection().map((e) => e.path),
      cursor: cursor && !isParentRow(cursor) ? cursor.path : null,
      dir: this.os.folder(),
      targetDir: this.ws.targetDir(),
    };
  }

  /** Runs entry `id`: a program starts, a folder opens in the active panel. */
  async run(id: string): Promise<void> {
    const item = runnable(this.items()).find((i) => i.id === id);
    const label = item?.label ?? id;
    const ctx = this.context();
    let result;
    try {
      result = await this.api.run(id, ctx);
    } catch (e) {
      // a default-app launcher (open, xdg-open) would run a program: ask like Enter
      const error = toFsError(e);
      const panel = this.ws.panel()?.store;
      const exe = this.os.selection().find((x) => x.path === error.path);
      if (error.code !== 'executable' || !panel || !exe) {
        throw e;
      }
      if (!(await panel.confirmExecutable(exe))) {
        return;
      }
      result = await this.api.run(id, ctx, true);
    }
    if (result.kind === 'folder') {
      const side = this.ws.activeSide();
      this.ws.requestNavigate(side, result.path);
      this.ws.requestFocus(side);
    } else {
      this.status.set(STARTER_TEXTS.started(label, result.count));
    }
  }
}
