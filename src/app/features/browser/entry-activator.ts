import { inject, Injectable, Injector } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { FileActionModifier } from '../../core/fileactions/file-actions.models';
import { DirEntry, isNavigableDir, isParentRow } from '../../core/fs/fs.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { FileActionsStore } from '../fileactions/file-actions.store';
import { FileBrowserStore } from './file-browser.store';
import type { DoubleClickResult } from './file-list/file-list-controller';

/**
 * The one place that knows what a double click on an entry does (designs 072, 073,
 * 079 E1): a double-click rule first, then the setting "double click views", else the
 * entry opens. The file list asks `decide` for a real double click; the path field
 * calls `activate` after Enter on a typed file path – its only caller, and it must stay
 * the only one: nothing but the user's own Enter there may open a file by its path.
 */
@Injectable({ providedIn: 'root' })
export class EntryActivator {
  private readonly settings = inject(SettingsStore);
  // lazy: the rules and the actions pull in the workspace
  private readonly injector = inject(Injector);

  /**
   * What a double click on `entry` with `modifiers` held does in `panel`: `'rule'` – a rule
   * took it over (already started), `'handled'` – the viewer opens it (the cursor is on the
   * entry), `'open'` – the caller opens it as usual.
   */
  decide(
    entry: DirEntry,
    modifiers: readonly FileActionModifier[],
    panel: FileBrowserStore,
  ): DoubleClickResult {
    if (this.injector.get(FileActionsStore).handleDoubleClick(entry, modifiers, panel)) {
      return 'rule';
    }
    if (
      this.settings.get('behavior.doubleClick') !== 'view' ||
      isNavigableDir(entry) ||
      isParentRow(entry)
    ) {
      return 'open';
    }
    void this.injector.get(ActionService).run('OPEN_VIEW_DLG');
    return 'handled';
  }

  /**
   * As if `entry` of `panel` had been double-clicked with no key held (design 079): the
   * cursor goes on it, then the same chain runs. The marks stay – there was no click.
   */
  async activate(entry: DirEntry, panel: FileBrowserStore): Promise<DoubleClickResult> {
    if (!isParentRow(entry)) {
      panel.setCursor(entry.path);
    }
    const result = this.decide(entry, [], panel);
    if (result === 'open') {
      await panel.open(entry);
    }
    return result;
  }
}
