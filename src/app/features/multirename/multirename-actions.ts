import { ActionService } from '../../core/actions/action.service';
import { JobsStore } from '../../core/jobs/jobs.store';
import { MultiRenameStore } from './multirename.store';

/**
 * Multi-rename as actions (design 007): the dialog needs a folder and at least
 * one entry; undo needs a finished rename job that can still be undone.
 */
export function registerMultiRenameActions(
  actions: ActionService,
  mr: MultiRenameStore,
  jobs: JobsStore,
): () => void {
  return actions.register({
    OPEN_MULTIRENAME_DLG: { enabled: () => mr.hasSelection(), run: () => mr.open() },
    UNDO_RENAME: {
      enabled: () => jobs.lastUndoable() !== null,
      run: () => mr.undo(jobs.lastUndoable()?.id ?? null),
    },
  });
}
