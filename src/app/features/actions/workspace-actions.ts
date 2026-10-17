import { ActionHandler, ActionService } from '../../core/actions/action.service';
import { ActionId } from '../../core/actions/action-catalog';
import { DialogService } from '../../shared/dialog/dialog.service';
import { WorkspaceStore } from '../workspace/workspace.store';

/**
 * Handlers of everything that exists after prompts 001/004/002. Later prompts
 * register their own actions the same way. Returns the unregister function.
 */
export function registerWorkspaceActions(
  actions: ActionService,
  ws: WorkspaceStore,
  dialogs: DialogService,
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
    TOGGLE_MARK_AND_ADVANCE: { run: () => list()?.toggleMarkAndAdvance(), enabled: hasCursor },
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
