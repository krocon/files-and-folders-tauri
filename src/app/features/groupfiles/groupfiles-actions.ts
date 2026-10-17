import { ActionService } from '../../core/actions/action.service';
import { GroupFilesStore } from './groupfiles.store';

/** Group files as an action (design 008): needs a folder on the active side. */
export function registerGroupFilesActions(actions: ActionService, gf: GroupFilesStore): () => void {
  return actions.register({
    OPEN_GROUPFILES_DLG: { enabled: () => gf.hasFolder(), run: () => gf.open() },
  });
}
