import { ActionHandler, ActionService } from '../../core/actions/action.service';
import { ActionId } from '../../core/actions/action-catalog';
import { ShellStore } from './shell.store';

/** The actions of the shell bar (design 021 E12/E13). Running a line is no action. */
export function registerShellActions(actions: ActionService, shell: ShellStore): () => void {
  const enabled = () => shell.enabled();
  // inserting needs an open field: not inside an archive, not without a folder
  const canInsert = () => shell.locked() === null;
  const handlers: Partial<Record<ActionId, ActionHandler>> = {
    TOGGLE_SHELL: { enabled, run: () => shell.toggle() },
    SHELL_INSERT_NAMES: { enabled: canInsert, run: () => shell.insert(false) },
    SHELL_INSERT_PATHS: { enabled: canInsert, run: () => shell.insert(true) },
    SHELL_CLEAR_OUTPUT: { enabled: () => shell.hasOutput(), run: () => shell.clear() },
  };
  return actions.register(handlers);
}
