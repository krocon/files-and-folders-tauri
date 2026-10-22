import { ActionService } from '../../core/actions/action.service';
import { WorkspaceStore } from '../workspace/workspace.store';

/**
 * Flat view actions (design 038 E7/E8): `TOGGLE_FLAT_VIEW` (Mod+B) turns the flat view
 * of the active tab on and off, `TOGGLE_FLAT_VIEW_DIRS` its "Show folders". The panel
 * does the work ({@link PanelHandle.toggleFlat}).
 */
export function registerFlatActions(actions: ActionService, ws: WorkspaceStore): () => void {
  const flatOn = () => ws.activeTab(ws.activeSide()).search?.flat !== undefined;
  return actions.register({
    TOGGLE_FLAT_VIEW: {
      enabled: () => flatOn() || canShowFlat(ws),
      run: () => void ws.panel()?.toggleFlat?.(),
    },
    TOGGLE_FLAT_VIEW_DIRS: {
      enabled: flatOn,
      run: () => {
        const flat = ws.activeTab(ws.activeSide()).search?.flat;
        if (flat) {
          ws.panel()?.setFlatDirs?.(!flat.showDirs);
        }
      },
    },
  });
}

/**
 * A flat view can start in a local folder tab whose listing is checked: not in a
 * result tab, an archive, on a server or on a listing from the cache (design 038 E7).
 */
export function canShowFlat(ws: WorkspaceStore): boolean {
  const tab = ws.activeTab(ws.activeSide());
  const store = ws.panel()?.store;
  return (
    !tab.search &&
    !!store &&
    store.path() !== null &&
    store.archive() === null &&
    store.remote() === null &&
    store.cachedAt() === null &&
    !store.loading()
  );
}
