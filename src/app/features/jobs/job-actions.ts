import { ActionService } from '../../core/actions/action.service';
import { DialogService } from '../../shared/dialog/dialog.service';

/** Actions on top of the job engine (prompt 005): the task list. Copy & co.: `ops/ops-actions.ts`. */
export function registerJobActions(actions: ActionService, dialogs: DialogService): () => void {
  return actions.register({
    OPEN_TASK_DLG: { run: () => dialogs.show('jobs') },
  });
}
