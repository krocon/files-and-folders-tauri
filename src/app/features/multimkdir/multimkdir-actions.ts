import { ActionService } from '../../core/actions/action.service';
import { MultiMkdirStore } from './multimkdir.store';

/** Multi-MkDir as an action (design 008): needs a folder on the active side. */
export function registerMultiMkdirActions(actions: ActionService, mm: MultiMkdirStore): () => void {
  return actions.register({
    OPEN_MULTIMKDIR_DLG: { enabled: () => mm.hasFolder(), run: () => mm.open() },
  });
}
