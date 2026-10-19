import { ActionHandler, ActionService } from '../../core/actions/action.service';
import { ActionId } from '../../core/actions/action-catalog';
import { DialogService } from '../../shared/dialog/dialog.service';
import { SettingsStore } from '../../core/settings/settings.store';
import { WorkspaceStore } from '../workspace/workspace.store';

/**
 * Handlers of everything that exists after prompts 001/004/002. Later prompts
 * register their own actions the same way. Returns the unregister function.
 */
export function registerWorkspaceActions(
  actions: ActionService,
  ws: WorkspaceStore,
  dialogs: DialogService,
  settings?: SettingsStore,
): () => void {
  const panel = () => ws.panel();
  const list = () => panel()?.controller();
  const hasCursor = () => list()?.cursorEntry() !== undefined;
  const focusActive = () => ws.requestFocus(ws.activeSide());

  const handlers: Partial<Record<ActionId, ActionHandler>> = {
    NAVIGATE_OPEN: { run: () => void list()?.openCursor(), enabled: hasCursor },
    NAVIGATE_PARENT: {
      run: () => panel()?.store.up(),
      enabled: () => panel()?.store.canGoUp() ?? false,
    },
    OPEN_IN_NEW_TAB: { run: () => void list()?.openCursorInNewTab(), enabled: hasCursor },
    RELOAD_DIR: { run: () => panel()?.store.refresh() },
    TOGGLE_MARK_AND_ADVANCE: {
      // Space on a folder also calculates its size (design 002 D3 / 003 E7)
      run: () => {
        const entry = list()?.cursorEntry();
        const calc = settings?.get('behavior.spaceCalcSize') ?? true;
        if (calc && entry && !panel()?.store.isMarked(entry.path)) {
          void panel()?.store.calcDirSize(entry);
        }
        list()?.toggleMarkAndAdvance();
      },
      enabled: hasCursor,
    },
    CALC_DIR_SIZES: {
      run: () => {
        const store = panel()?.store;
        const targets = store?.markedEntries().length
          ? store.markedEntries()
          : [list()?.cursorEntry()];
        for (const e of targets) {
          if (e) {
            void store?.calcDirSize(e);
          }
        }
      },
    },
    NAVIGATE_BACK: {
      run: () => panel()?.store.back(),
      enabled: () => panel()?.store.canGoBack() ?? false,
    },
    NAVIGATE_FORWARD: {
      run: () => panel()?.store.forward(),
      enabled: () => panel()?.store.canGoForward() ?? false,
    },
    TOGGLE_HIDDEN_FILES: { run: () => panel()?.store.hiddenVisible.update((v) => !v) },
    TOGGLE_FILTER: {
      run: () => {
        const store = panel()?.store;
        if (!store) {
          return;
        }
        const on = !store.filterActive();
        store.filterActive.set(on);
        if (on) {
          setTimeout(() =>
            document
              .querySelector<HTMLInputElement>(`.side-${ws.activeSide()} .filter-input`)
              ?.focus(),
          );
        } else {
          focusActive();
        }
      },
    },
    OPEN_CHDIR_DLG: { run: () => ws.requestPathEdit(ws.activeSide()) },
    OPEN_FOLDER_MENU_LEFT: { run: () => ws.requestFolderMenu('left') },
    OPEN_FOLDER_MENU_RIGHT: { run: () => ws.requestFolderMenu('right') },
    MARK_DOWN: { run: () => list()?.markAndMove(1), enabled: hasCursor },
    MARK_UP: { run: () => list()?.markAndMove(-1), enabled: hasCursor },
    MARK_TO_START: { run: () => list()?.markToEdge('start'), enabled: hasCursor },
    MARK_TO_END: { run: () => list()?.markToEdge('end'), enabled: hasCursor },
    SELECT_ALL: { run: () => list()?.markAll() },
    DESELECT_ALL: { run: () => list()?.clearMarks() },
    INVERT_MARKS: { run: () => list()?.invertMarks() },
    OPEN_MARK_PATTERN_DLG: { run: () => dialogs.show('mark-pattern') },
    OPEN_UNMARK_PATTERN_DLG: { run: () => dialogs.show('unmark-pattern') },
    TOGGLE_PANEL: { run: () => ws.toggleActive() },
    SELECT_LEFT_PANEL: {
      run: () => {
        ws.setActive('left');
        ws.requestFocus('left');
      },
    },
    SELECT_RIGHT_PANEL: {
      run: () => {
        ws.setActive('right');
        ws.requestFocus('right');
      },
    },
    NEXT_TAB: {
      run: () => {
        ws.cycleTab(ws.activeSide(), 1);
        focusActive();
      },
    },
    PREV_TAB: {
      run: () => {
        ws.cycleTab(ws.activeSide(), -1);
        focusActive();
      },
    },
    CLONE_TAB: {
      run: () => {
        ws.cloneTab(ws.activeSide());
        focusActive();
      },
    },
    CLOSE_TAB: {
      run: () => {
        ws.closeTab(ws.activeSide());
        focusActive();
      },
      enabled: () => ws.panels()[ws.activeSide()].tabs.length > 1,
    },
    TOGGLE_FAVORITE: {
      run: () => {
        const path = panel()?.store.path();
        if (path) {
          ws.toggleFavorite(path);
        }
      },
      enabled: () => (panel()?.store.path() ?? null) !== null,
    },
    SPLITTER_RESET: { run: () => ws.setSplitter(0.5) },
    OPEN_COMMAND_PALETTE: { run: () => dialogs.show('palette') },
    OPEN_CALL_ACTION_DLG: { run: () => dialogs.show('call-action') },
    OPEN_SHORTCUT_DLG: { run: () => dialogs.show('shortcuts') },
  };
  return actions.register(handlers);
}
