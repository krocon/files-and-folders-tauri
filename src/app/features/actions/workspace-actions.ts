import { ActionHandler, ActionService } from '../../core/actions/action.service';
import { ActionId } from '../../core/actions/action-catalog';
import { DialogService } from '../../shared/dialog/dialog.service';
import { SettingsStore } from '../../core/settings/settings.store';
import { MAX_TABS, otherSide, WorkspaceStore } from '../workspace/workspace.store';
import { TEXTS } from '../workspace/texts';
import { transferPath } from '../workspace/panel-transfer-logic';
import { Side } from '../../core/session/session.models';

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
  const activeIndex = () => ws.panels()[ws.activeSide()].activeTab;
  const otherHasRoom = () => ws.panels()[otherSide(ws.activeSide())].tabs.length < MAX_TABS;
  /** Moves the active tab within its side; a focused tab keeps the focus (design 031 E6). */
  const moveActiveTab = (delta: -1 | 1) => {
    const side = ws.activeSide();
    const id = ws.activeTab(side).id;
    const tabFocused =
      typeof document !== 'undefined' && document.activeElement?.id === `fnf-tab-${id}`;
    ws.moveTab(side, activeIndex(), delta);
    if (tabFocused) {
      setTimeout(() => document.getElementById(`fnf-tab-${id}`)?.focus());
    }
  };
  /** The active tab (or a copy) goes to the end of the other side, which becomes active. */
  const toOtherSide = (copy: boolean) => {
    const to = otherSide(ws.activeSide());
    const id = ws.activeTab(ws.activeSide()).id;
    if (ws.placeTab(id, to, ws.panels()[to].tabs.length, copy) !== null) {
      ws.setActive(to);
      ws.requestFocus(to);
    }
  };

  /** Folder for the other side (design 040): the entry under the cursor or the shown folder. */
  const transferTarget = () => {
    const store = panel()?.store;
    if (!store) {
      return null;
    }
    return transferPath(list()?.cursorEntry(), {
      folder: ws.actionDir(),
      inArchive: store.archive() !== null,
      onServer: store.remote() !== null,
    });
  };
  /** Ctrl+←/→: the named side opens it; the named side being the active one is Enter. */
  const transferTo = (to: Side) => {
    if (to === ws.activeSide()) {
      const path = transferTarget();
      if (path !== null && path === list()?.cursorEntry()?.path) {
        list()?.openCursor();
      }
      return;
    }
    const path = transferTarget();
    if (path !== null) {
      ws.requestNavigate(to, path);
    }
  };

  const handlers: Partial<Record<ActionId, ActionHandler>> = {
    NAVIGATE_OPEN: { run: () => void list()?.openCursor(), enabled: hasCursor },
    NAVIGATE_PARENT: {
      run: () => panel()?.store.up(),
      enabled: () => panel()?.store.canGoUp() ?? false,
    },
    OPEN_IN_NEW_TAB: { run: () => void list()?.openCursorInNewTab(), enabled: hasCursor },
    RELOAD_DIR: { run: () => panel()?.store.refresh() },
    // Esc in the list while a folder opens (design 029 E4)
    CANCEL_LOADING: {
      run: () => {
        const p = panel();
        if (p && !p.cancelLoading?.()) {
          p.store.cancelLoad();
        }
      },
      enabled: () => panel()?.store.loading() ?? false,
    },
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
    TOGGLE_MARK_AND_RETREAT: { run: () => list()?.toggleMarkAndMove(-1), enabled: hasCursor },
    TOGGLE_MARK: { run: () => list()?.toggleMarkAndMove(0), enabled: hasCursor },
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
    // design 031 E5: the keyboard side of dragging tabs
    MOVE_TAB_LEFT: { run: () => moveActiveTab(-1), enabled: () => activeIndex() > 0 },
    MOVE_TAB_RIGHT: {
      run: () => moveActiveTab(1),
      enabled: () => activeIndex() < ws.panels()[ws.activeSide()].tabs.length - 1,
    },
    MOVE_TAB_TO_OTHER_SIDE: {
      run: () => toOtherSide(false),
      enabled: () => ws.panels()[ws.activeSide()].tabs.length > 1 && otherHasRoom(),
    },
    COPY_TAB_TO_OTHER_SIDE: { run: () => toOtherSide(true), enabled: otherHasRoom },
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
    // design 040: Total Commander Ctrl+U, Ctrl+Shift+U, "Target = Source", Ctrl+←/→
    SWAP_PANELS: {
      run: () => {
        ws.swapActiveTabs();
        focusActive();
      },
    },
    SWAP_PANELS_WITH_TABS: {
      run: () => {
        ws.swapSides();
        focusActive();
      },
    },
    TARGET_EQUALS_SOURCE: {
      run: () => {
        const path = ws.actionDir();
        if (path !== null) {
          ws.requestNavigate(otherSide(ws.activeSide()), path);
        }
      },
      enabled: () => ws.actionDir() !== null,
    },
    OPEN_CURSOR_IN_LEFT: {
      run: () => transferTo('left'),
      enabled: () => transferTarget() !== null,
    },
    OPEN_CURSOR_IN_RIGHT: {
      run: () => transferTo('right'),
      enabled: () => transferTarget() !== null,
    },
    OPEN_COMMAND_PALETTE: { run: () => dialogs.show('palette') },
    OPEN_CALL_ACTION_DLG: { run: () => dialogs.show('call-action') },
    OPEN_SHORTCUT_DLG: { run: () => dialogs.show('shortcuts') },
  };
  const unregister = actions.register(handlers);
  // nothing that changes or removes entries while the panel shows an unchecked
  // listing from the cache (design 030 E4) – copying from it and viewing stay
  const unveto = actions.setVeto((id) =>
    id !== null && OFF_WHILE_UNCHECKED.has(id) && (panel()?.store.cachedAt() ?? null) !== null
      ? TEXTS.unchecked
      : null,
  );
  return () => {
    unveto();
    unregister();
  };
}

/** Actions that wait until a listing from the cache is checked (design 030 E4). */
export const OFF_WHILE_UNCHECKED: ReadonlySet<ActionId> = new Set<ActionId>([
  'OPEN_CREATE_FILE_DLG',
  'OPEN_MKDIR_DLG',
  'OPEN_RENAME_DLG',
  'RENAME_INLINE',
  'OPEN_MOVE_DLG',
  'OPEN_DELETE_DLG',
  'DELETE_PERMANENT',
  'OPEN_MULTIRENAME_DLG',
  'OPEN_MULTIMKDIR_DLG',
  'OPEN_GROUPFILES_DLG',
  'OPEN_DELETE_EMPTY_FOLDERS_DLG',
  'OPEN_CHANGE_ATTRIBUTES_DLG',
]);
