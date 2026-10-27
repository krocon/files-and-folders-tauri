import { ActionId } from '../../core/actions/action-catalog';
import { ActionService } from '../../core/actions/action.service';
import { isRemotePath } from '../../core/remote/remote-path';
import { profileOf } from '../../core/remote/remote-connect-prompt';
import { WorkspaceStore } from '../workspace/workspace.store';
import { REMOTE_TEXTS } from './remote-texts';
import { RemoteStore } from './remote.store';

/**
 * Actions that need local files or folders: off while the active panel shows a server
 * folder (design 034 §4.6). Copy/move (both directions), F7, F2, F8 (permanent), F3,
 * Enter, folder sizes, marking and navigation stay.
 */
export const OFF_ON_SERVER: ReadonlySet<ActionId> = new Set<ActionId>([
  'OPEN_EDIT_DLG',
  'OPEN_ATTRIBUTE_DLG',
  'OPEN_CHANGE_ATTRIBUTES_DLG',
  'OPEN_TOOLS_DLG',
  'REVEAL_IN_FILE_MANAGER',
  'OPEN_TERMINAL_HERE',
  'TOGGLE_SHELL',
  'SHELL_INSERT_NAMES',
  'SHELL_INSERT_PATHS',
  'OPEN_PACK_DLG',
  'OPEN_UNPACK_DLG',
  'OPEN_MULTIRENAME_DLG',
  'UNDO_RENAME',
  'OPEN_MULTIMKDIR_DLG',
  'OPEN_GROUPFILES_DLG',
  'OPEN_DELETE_EMPTY_FOLDERS_DLG',
  'OPEN_FIND_DLG',
  'OPEN_FOLDER_FINDER_DLG',
  'OPEN_FIND_DUPLICATES_DLG',
  'COMPARE_FILES',
  'OPEN_SYNC_DIRS_DLG',
  'OPEN_CHECKSUM_CREATE_DLG',
  'CHECKSUM_VERIFY',
  'COPY_CHECKSUM',
  'OPEN_DISK_USAGE',
  'OPEN_DISK_USAGE_VOLUME',
  'OPEN_LINK_DLG',
]);

/** The server tab path of the active panel, or null. */
export function activeServerPath(ws: WorkspaceStore): string | null {
  const path = ws.activeTab(ws.activeSide()).path;
  return isRemotePath(path) ? path : null;
}

/** Connect / disconnect actions and the veto on server folders (design 034 E8). */
export function registerRemoteActions(
  actions: ActionService,
  ws: WorkspaceStore,
  store: RemoteStore,
): () => void {
  const unveto = actions.setVeto((id) =>
    id !== null && OFF_ON_SERVER.has(id) && activeServerPath(ws) !== null
      ? REMOTE_TEXTS.offOnServer
      : null,
  );
  const current = () => {
    const path = activeServerPath(ws);
    return path ? profileOf(path) : null;
  };
  const unregister = actions.register({
    OPEN_CONNECTIONS_DLG: { run: () => store.openDialog(current()) },
    REMOTE_DISCONNECT: {
      enabled: () => {
        const id = current();
        return id !== null && store.state(id) === 'connected';
      },
      run: () => {
        const id = current();
        if (id) {
          void store.disconnect(id);
        }
      },
    },
    REMOTE_RECONNECT: {
      enabled: () => current() !== null,
      run: () => {
        const id = current();
        const side = ws.activeSide();
        const path = activeServerPath(ws);
        if (id) {
          void store.connect(id, { then: () => ws.requestNavigate(side, path) });
        }
      },
    },
  });
  void store.init();
  return () => {
    unregister();
    unveto();
  };
}
