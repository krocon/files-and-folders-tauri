import { ActionHandler, ActionService } from '../../core/actions/action.service';
import { ActionId } from '../../core/actions/action-catalog';
import { DialogService } from '../../shared/dialog/dialog.service';
import { OsStore } from './os.store';

/** The actions of design 011. Tools themselves are extra actions (`OsStore.loadTools`). */
export function registerOsActions(
  actions: ActionService,
  os: OsStore,
  dialogs: DialogService,
): () => void {
  // names, paths and tools work on full paths: also in a result tab (design 009 E4)
  const some = () => os.selection().length > 0;
  const folder = () => os.folder() !== null;
  const handlers: Partial<Record<ActionId, ActionHandler>> = {
    COPY_2_CLIPBOARD_NAMES: { enabled: some, run: () => os.copy('names', 'lines') },
    COPY_2_CLIPBOARD_FULLNAMES: { enabled: some, run: () => os.copy('paths', 'lines') },
    COPY_2_CLIPBOARD_NAMES_AS_JSON: { enabled: some, run: () => os.copy('names', 'json') },
    COPY_2_CLIPBOARD_FULLNAMES_AS_JSON: { enabled: some, run: () => os.copy('paths', 'json') },
    REVEAL_IN_FILE_MANAGER: { enabled: folder, run: () => os.reveal() },
    OPEN_TERMINAL_HERE: { enabled: folder, run: () => os.terminal() },
    OPEN_EDIT_DLG: { enabled: some, run: () => os.edit() },
    OPEN_TOOLS_DLG: { enabled: folder, run: () => dialogs.show('tools') },
    OPEN_TOOL_CONFIG_DLG: { run: () => os.openConfigDialog() },
  };
  return actions.register(handlers);
}
