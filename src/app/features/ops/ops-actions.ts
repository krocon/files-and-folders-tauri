import { ActionHandler, ActionService } from '../../core/actions/action.service';
import { ActionId } from '../../core/actions/action-catalog';
import { OpsStore } from './ops.store';

/**
 * The file operations of design 006 as actions. Enabled rules (mr §3):
 * copy, move and delete need at least one entry, rename exactly one, creating
 * needs a folder. F2 renames in the list itself.
 */
export function registerOpsActions(actions: ActionService, ops: OpsStore): () => void {
  // copy, move and delete also work in a search result tab (design 009 E4)
  const some = () => ops.location() !== null && ops.selection().length > 0;
  const one = () => ops.folder() !== null && ops.selection().length === 1;
  const folder = () => ops.folder() !== null;
  const handlers: Partial<Record<ActionId, ActionHandler>> = {
    OPEN_COPY_DLG: { enabled: some, run: () => ops.openCopyMove('copy') },
    OPEN_MOVE_DLG: { enabled: some, run: () => ops.openCopyMove('move') },
    OPEN_DELETE_DLG: { enabled: some, run: () => ops.openDelete('trash') },
    DELETE_PERMANENT: { enabled: some, run: () => ops.openDelete('permanent') },
    OPEN_MKDIR_DLG: { enabled: folder, run: () => ops.openName('mkdir') },
    OPEN_CREATE_FILE_DLG: { enabled: folder, run: () => ops.openName('createFile') },
    OPEN_RENAME_DLG: { enabled: one, run: () => ops.openName('rename') },
    RENAME_INLINE: { enabled: one, run: () => ops.renameInline() },
  };
  return actions.register(handlers);
}
