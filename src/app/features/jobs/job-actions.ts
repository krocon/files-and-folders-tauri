import { ActionHandler, ActionService } from '../../core/actions/action.service';
import { ActionId } from '../../core/actions/action-catalog';
import { isParentRow } from '../../core/fs/fs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { ConfirmService } from '../../shared/dialog/confirm.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { JOB_TEXTS } from './job-format';

/**
 * Actions on top of the job engine (prompt 005): the task list and a minimal
 * F5 (copy marked entries – or the cursor entry – into the other panel's
 * folder after a confirmation). The full copy dialog follows in prompt 006.
 */
export function registerJobActions(
  actions: ActionService,
  ws: WorkspaceStore,
  jobs: JobsStore,
  dialogs: DialogService,
  confirm: ConfirmService,
): () => void {
  const sources = () => {
    const panel = ws.panel(ws.source());
    if (!panel) {
      return [];
    }
    const marked = panel.store.markedEntries();
    if (marked.length > 0) {
      return marked;
    }
    const cursor = panel.store.cursorEntry();
    return cursor && !isParentRow(cursor) ? [cursor] : [];
  };
  const targetDir = () => ws.panel(ws.target())?.store.path() ?? null;

  const handlers: Partial<Record<ActionId, ActionHandler>> = {
    OPEN_TASK_DLG: { run: () => dialogs.show('jobs') },
    OPEN_COPY_DLG: {
      enabled: () => sources().length > 0 && targetDir() !== null,
      run: async () => {
        const items = sources();
        const target = targetDir();
        if (items.length === 0) {
          throw { code: 'unknown', message: JOB_TEXTS.nothingToCopy, path: null };
        }
        if (target === null) {
          throw { code: 'unknown', message: JOB_TEXTS.noTarget, path: null };
        }
        const ok = await confirm.ask({
          title: JOB_TEXTS.copyTitle,
          message: JOB_TEXTS.copyMessage(items.length),
          detail: target,
          confirmLabel: JOB_TEXTS.copyConfirm,
          danger: false,
        });
        if (!ok) {
          return;
        }
        const source = ws.panel(ws.source())?.store;
        const folder = source?.path();
        const paths = items.map((e) => e.path);
        const id = await jobs.start({ kind: 'copy', sources: paths, targetDir: target });
        // like Total Commander: copied entries are unmarked when the job is done
        void jobs.whenFinished(id).then((job) => {
          if (
            (job.state === 'done' || job.state === 'doneWithErrors') &&
            source?.path() === folder
          ) {
            source?.setMarked(paths, false);
          }
        });
      },
    },
  };
  return actions.register(handlers);
}
