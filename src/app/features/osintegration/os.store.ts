import { inject, Injectable, signal } from '@angular/core';
import { ActionService, ExtraAction } from '../../core/actions/action.service';
import { toFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError } from '../../core/fs/fs.models';
import {
  ClipboardApi,
  ClipboardFormat,
  ClipboardWhat,
  clipboardText,
} from '../../core/os/clipboard';
import { OsApi } from '../../core/os/os-api';
import { ToolContext, ToolInfo } from '../../core/os/os.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { selectionForAction } from '../ops/ops-logic';
import { WorkspaceStore } from '../workspace/workspace.store';
import { OS_TEXTS } from './os-texts';

function err(message: string): FsError {
  return { code: 'unknown', message, path: null };
}

export const TOOL_PREFIX = 'tool:';

/**
 * OS integration of design 011 (root): external tools (as extra actions), file
 * manager / terminal, clipboard. The drives live in `VolumesStore`.
 */
@Injectable({ providedIn: 'root' })
export class OsStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly api = inject(OsApi);
  private readonly clipboard = inject(ClipboardApi);
  private readonly actions = inject(ActionService);
  private readonly dialogs = inject(DialogService);

  readonly tools = signal<readonly ToolInfo[]>([]);
  readonly warnings = signal<readonly string[]>([]);
  readonly file = signal<string | null>(null);
  /** Last success message (live region). */
  readonly status = signal('');

  /** Loads `tools.json` and offers the tools as actions. */
  async loadTools(): Promise<void> {
    try {
      const loaded = await this.api.loadTools();
      this.tools.set(loaded.tools);
      this.warnings.set(loaded.warnings);
      this.file.set(loaded.file);
    } catch (e) {
      const error = toFsError(e);
      this.tools.set([]);
      // plain browser (`pnpm start`): the keymap already says that there is no backend
      this.warnings.set(error.code === 'no_backend' ? [] : [error.message]);
    }
    this.actions.setExtras(this.tools().map((t) => this.extra(t)));
  }

  /** Loads and reports problems (start of the app). */
  async init(): Promise<void> {
    await this.loadTools();
    for (const w of [...this.warnings(), ...this.actions.extraProblems()]) {
      this.actions.report(w);
    }
  }

  private extra(t: ToolInfo): ExtraAction {
    return {
      id: TOOL_PREFIX + t.id,
      label: t.label,
      shortcut: t.shortcut,
      enabled: () => this.folder() !== null,
      run: () => this.runTool(t.id),
    };
  }

  /** Entries of the active panel: marked, else the cursor – in the list's display order. */
  selection(): readonly DirEntry[] {
    const panel = this.ws.panel();
    const chosen = selectionForAction(panel?.store);
    const displayed = panel?.controller()?.displayedEntries() ?? [];
    if (chosen.length < 2 || displayed.length === 0) {
      return chosen;
    }
    const order = new Map(displayed.map((e, i) => [e.path, i]));
    return [...chosen].sort(
      (a, b) => (order.get(a.path) ?? Infinity) - (order.get(b.path) ?? Infinity),
    );
  }

  folder(): string | null {
    return this.ws.panel()?.store.path() ?? null;
  }

  context(): ToolContext {
    // a folder inside an archive is no target for a tool (virtual path, review 016 #7)
    const other = this.ws.targetDir();
    return {
      files: this.selection().map((e) => e.path),
      dir: this.folder(),
      targetDir: other,
    };
  }

  async runTool(id: string): Promise<void> {
    const tool = this.tools().find((t) => t.id === id);
    if (!tool) {
      throw { code: 'unknown_tool', message: `There is no tool "${id}"`, path: null };
    }
    const ctx = this.context();
    if (tool.needsFiles && ctx.files.length === 0) {
      throw err(OS_TEXTS.nothingSelected);
    }
    let n: number;
    try {
      n = await this.api.runTool(id, ctx);
    } catch (e) {
      // a default-app tool (F4 `edit` = xdg-open …) would run a program: ask like Enter
      const error = toFsError(e);
      const panel = this.ws.panel()?.store;
      const exe = this.selection().find((x) => x.path === error.path);
      if (error.code !== 'executable' || !panel || !exe) {
        throw e;
      }
      if (!(await panel.confirmExecutable(exe))) {
        return;
      }
      n = await this.api.runTool(id, ctx, true);
    }
    this.status.set(OS_TEXTS.toolStarted(tool.label, n));
  }

  /** F4: the tool `edit`. */
  async edit(): Promise<void> {
    if (!this.tools().some((t) => t.id === 'edit')) {
      throw err(OS_TEXTS.noEditTool);
    }
    await this.runTool('edit');
  }

  /** Cursor / first selected entry, else the folder itself. */
  async reveal(): Promise<void> {
    const target = this.selection()[0]?.path ?? this.folder();
    if (target === null) {
      throw err(OS_TEXTS.noFolder);
    }
    await this.api.reveal(target);
  }

  async terminal(): Promise<void> {
    const dir = this.folder();
    if (dir === null) {
      throw err(OS_TEXTS.noFolder);
    }
    await this.api.openTerminal(dir);
  }

  async copy(what: ClipboardWhat, format: ClipboardFormat): Promise<void> {
    const entries = this.selection();
    if (entries.length === 0) {
      throw err(OS_TEXTS.nothingSelected);
    }
    await this.clipboard.writeText(clipboardText(entries, what, format));
    this.status.set(OS_TEXTS.copied(entries.length, what, format === 'json'));
  }

  async openConfigDialog(): Promise<void> {
    await this.loadTools();
    this.dialogs.show('tool-config');
  }

  async openConfigFile(): Promise<void> {
    this.file.set(await this.api.openToolsConfig());
  }

  async reload(): Promise<void> {
    await this.loadTools();
    this.status.set(OS_TEXTS.reloaded(this.tools().length));
  }
}
