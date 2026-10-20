import { ActionService } from '../../core/actions/action.service';
import { MrImportStore } from './mr-import.store';

/** Handler of design 026: the import assistant for the old configuration. */
export function registerMrImportActions(actions: ActionService, store: MrImportStore): () => void {
  return actions.register({
    OPEN_IMPORT_OLD_CONFIG_DLG: { run: () => store.open() },
  });
}
