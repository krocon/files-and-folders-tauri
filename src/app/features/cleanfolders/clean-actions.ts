import { ActionService } from '../../core/actions/action.service';
import { CleanFoldersStore } from './clean.store';

/** Clean folders as an action (design 008): needs a folder on the active side. */
export function registerCleanFoldersActions(
  actions: ActionService,
  cl: CleanFoldersStore,
): () => void {
  return actions.register({
    OPEN_DELETE_EMPTY_FOLDERS_DLG: { enabled: () => cl.hasFolder(), run: () => cl.open() },
  });
}
