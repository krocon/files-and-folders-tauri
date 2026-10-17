import { ActionService } from '../../core/actions/action.service';
import { SearchHit } from '../../core/search/search.models';
import { WorkspaceStore } from '../workspace/workspace.store';
import { FindStore } from './find.store';
import { FolderFinderStore } from './folder-finder.store';
import { SearchStore } from './search.store';

/** Search actions (design 009 E8). */
export function registerSearchActions(
  actions: ActionService,
  ws: WorkspaceStore,
  find: FindStore,
  search: SearchStore,
  finder: FolderFinderStore,
): () => void {
  const resultKey = () => ws.activeTab(ws.activeSide()).search?.key ?? null;
  const cursorHit = () => {
    const store = ws.panel()?.store;
    return store?.searchKey() != null ? (store.cursorEntry() as SearchHit | null) : null;
  };
  return actions.register({
    OPEN_FIND_DLG: { enabled: () => find.canOpen(), run: () => find.open() },
    OPEN_FOLDER_FINDER_DLG: { enabled: () => finder.hasFolder(), run: () => finder.open() },
    RERUN_SEARCH: {
      enabled: () => resultKey() !== null,
      run: () => {
        const key = resultKey();
        if (key) {
          void search.rerun(key);
        }
      },
    },
    GOTO_FILE: {
      enabled: () => cursorHit() !== null,
      run: () => {
        const hit = cursorHit();
        if (hit) {
          ws.openInNewTab(ws.activeSide(), hit.dir, '', hit.path);
        }
      },
    },
  });
}
