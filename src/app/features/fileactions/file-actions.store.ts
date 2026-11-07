import { inject, Injectable, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { FileActionsApi } from '../../core/fileactions/file-actions-api';
import {
  FileActionProblem,
  FileActionRule,
  SavedFileActions,
} from '../../core/fileactions/file-actions.models';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { DirEntry } from '../../core/fs/fs.models';
import { isRemotePath } from '../../core/remote/remote-path';
import { ConfirmService } from '../../shared/dialog/confirm.service';
import { FileBrowserStore } from '../browser/file-browser.store';
import { CONFIG_TEXTS } from '../config/config-texts';
import { OsStore } from '../osintegration/os.store';
import { findRule } from './file-actions-logic';
import { FILE_ACTIONS_TEXTS } from './file-actions-texts';

/**
 * Double-click actions (design 072): rules from `file-actions.json` decide what a double
 * click on a matching file does instead of opening it. Root.
 */
@Injectable({ providedIn: 'root' })
export class FileActionsStore {
  private readonly api = inject(FileActionsApi);
  private readonly actions = inject(ActionService);
  private readonly confirm = inject(ConfirmService);
  private readonly os = inject(OsStore);

  readonly rules = signal<readonly FileActionRule[]>([]);
  readonly problems = signal<readonly FileActionProblem[]>([]);
  /** Last success message (live region). */
  readonly status = signal('');

  async init(): Promise<void> {
    try {
      const loaded = await this.api.load();
      this.rules.set(loaded.rules);
      this.problems.set(loaded.problems);
      const w = loaded.warning;
      if (w) {
        const name = 'file-actions.json';
        this.actions.report(
          w.code === 'unreadable'
            ? CONFIG_TEXTS.unreadable(name)
            : w.path
              ? CONFIG_TEXTS.brokenKept(name, w.path)
              : CONFIG_TEXTS.brokenStayed(name),
        );
      }
    } catch (err) {
      this.rules.set([]);
      this.problems.set([]);
      this.actions.report(FILE_ACTIONS_TEXTS.loadFailed(errorText(toFsError(err))));
    }
  }

  /** Writes the draft; `saved: false` comes back with the problems of the rules. */
  async save(rules: readonly FileActionRule[]): Promise<SavedFileActions> {
    const result = await this.api.save(rules);
    if (result.saved) {
      this.rules.set(result.rules);
      this.problems.set([]);
    }
    return result;
  }

  /**
   * A double click on `entry`: true if a rule took it over (else the caller opens the entry
   * as usual). A rule that still has a problem does not run: the file opens as usual.
   */
  handleDoubleClick(entry: DirEntry, panel: FileBrowserStore): boolean {
    // inside an archive, on a server or in the group view a click means something else
    if (
      panel.navigationLocked() ||
      panel.archive() !== null ||
      panel.remote() !== null ||
      panel.searchKind() === 'duplicates' ||
      isRemotePath(entry.path)
    ) {
      return false;
    }
    const rule = findRule(this.rules(), 'doubleClick', entry);
    if (!rule || this.problems().some((p) => p.id === rule.id)) {
      return false;
    }
    void this.run(rule, entry, panel);
    return true;
  }

  private async run(rule: FileActionRule, entry: DirEntry, panel: FileBrowserStore): Promise<void> {
    const t = FILE_ACTIONS_TEXTS;
    if (
      rule.confirm &&
      !(await this.confirm.ask({
        title: t.confirmTitle,
        message: rule.command,
        detail: entry.path,
        confirmLabel: t.confirmRun,
      }))
    ) {
      return;
    }
    const target = this.os.toolTargetDir();
    try {
      if (await this.start(rule, entry, target, panel)) {
        this.status.set(t.started(rule.command, entry.name));
      }
    } catch (err) {
      panel.error.set(toFsError(err));
    }
  }

  /** A default-app launcher (`open %P%N`) would run a program: ask like Enter. False: declined. */
  private async start(
    rule: FileActionRule,
    entry: DirEntry,
    target: string | null,
    panel: FileBrowserStore,
  ): Promise<boolean> {
    try {
      await this.api.run(rule.id, entry.path, target);
      return true;
    } catch (err) {
      if (toFsError(err).code !== 'executable') {
        throw err;
      }
    }
    if (!(await panel.confirmExecutable(entry))) {
      return false;
    }
    await this.api.run(rule.id, entry.path, target, true);
    return true;
  }
}
