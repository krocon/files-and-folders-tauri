import { ActionService } from '../../core/actions/action.service';
import { SyncStore } from './sync.store';

/** Folder comparison and sync (design 036). */
export function registerSyncActions(actions: ActionService, sync: SyncStore): () => void {
  return actions.register({
    COMPARE_DIRS: { enabled: () => sync.quickAvailable(), run: () => sync.quickCompare() },
    OPEN_SYNC_DIRS_DLG: { enabled: () => sync.available(), run: () => sync.open() },
  });
}
