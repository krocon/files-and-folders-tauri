import { ActionId } from '../../core/actions/action-catalog';
import { ActionService } from '../../core/actions/action.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { ImageOverviewStore } from './image-overview.store';
import { IMAGE_OVERVIEW_TEXTS } from './image-overview-texts';

/**
 * Actions that keep working while the image overview is open (design 074 E15): the operations
 * on its marks and what does not depend on a panel. Everything else is vetoed – the panels are
 * hidden, an action on them would act unseen.
 */
export const OVERVIEW_ACTIONS: ReadonlySet<ActionId> = new Set<ActionId>([
  'TOGGLE_IMAGE_OVERVIEW',
  'OPEN_COPY_DLG',
  'OPEN_MOVE_DLG',
  'OPEN_DELETE_DLG',
  'DELETE_PERMANENT',
  'OPEN_RENAME_DLG',
  'TOGGLE_FULLSCREEN',
  'FOCUS_MENU_BAR',
  'OPEN_TASK_DLG',
  'OPEN_SHORTCUT_DLG',
  'OPEN_SETUP_DLG',
  'OPEN_THEMES_DLG',
  'OPEN_THEME_PICKER',
  'NEXT_THEME',
  'THEME_FOLLOW_SYSTEM',
  'OPEN_ABOUT_DLG',
  'QUIT_APP',
]);

/** Can the active panel open the overview: a local folder tab with a checked listing? */
export function overviewOrigin(ws: WorkspaceStore): string | null {
  const side = ws.activeSide();
  const store = ws.panel(side)?.store;
  if (!store || ws.activeTab(side).search || store.archive() || store.remote()) {
    return null;
  }
  return store.path();
}

/**
 * `TOGGLE_IMAGE_OVERVIEW` (Mod+Shift+I, design 074 E18): opens the overview for the folder of
 * the active panel, or closes it – the panel's cursor goes to the last image shown when that
 * image is in the panel's folder.
 */
export function registerImageOverviewActions(
  actions: ActionService,
  ws: WorkspaceStore,
  overview: ImageOverviewStore,
): () => void {
  const off = actions.register({
    TOGGLE_IMAGE_OVERVIEW: {
      run: () => {
        if (overview.isOpen()) {
          closeOverview(ws, overview);
          return;
        }
        const folder = overviewOrigin(ws);
        if (folder === null) {
          actions.report(IMAGE_OVERVIEW_TEXTS.notLocal);
          return;
        }
        const side = ws.activeSide();
        void overview.show({
          side,
          folder,
          cursor: ws.panel(side)?.store.cursorPath() ?? null,
        });
      },
    },
  });
  const veto = actions.setVeto((id) =>
    overview.isOpen() && (id === null || !OVERVIEW_ACTIONS.has(id))
      ? IMAGE_OVERVIEW_TEXTS.notHere
      : null,
  );
  return () => {
    off();
    veto();
  };
}

/** Closes the overview; the panel it came from shows the last image and gets the focus. */
export function closeOverview(ws: WorkspaceStore, overview: ImageOverviewStore): void {
  const origin = overview.origin();
  const item = overview.cursorItem();
  overview.close();
  if (!origin) {
    return;
  }
  if (item && item.dir === origin.folder) {
    ws.panel(origin.side)?.controller()?.moveCursorTo(item.path);
  }
  ws.requestFocus(origin.side);
}
