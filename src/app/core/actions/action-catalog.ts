import { translatable } from '../i18n/i18n';
import { ACTION_LABELS_DE, CATEGORY_LABELS_DE } from './action-catalog.de';

/**
 * All actions of the app with stable ids (design 002 §3.2). Features register
 * handlers for the ids they implement (`ActionService.register`); ids without
 * handler are shown dimmed with the prompt that brings them (`availableIn`).
 */
export const ACTION_IDS = [
  // navigation / view
  'NAVIGATE_OPEN',
  'NAVIGATE_PARENT',
  'OPEN_IN_NEW_TAB',
  'RELOAD_DIR',
  'CANCEL_LOADING',
  'NAVIGATE_BACK',
  'NAVIGATE_FORWARD',
  'OPEN_CHDIR_DLG',
  'OPEN_FOLDER_MENU_LEFT',
  'OPEN_FOLDER_MENU_RIGHT',
  'CALC_DIR_SIZES',
  'TOGGLE_FILTER',
  'TOGGLE_HIDDEN_FILES',
  'TOGGLE_SHELL',
  'TOGGLE_FULLSCREEN',
  'SHELL_INSERT_NAMES',
  'SHELL_INSERT_PATHS',
  'SHELL_CLEAR_OUTPUT',
  'COPY_2_CLIPBOARD_NAMES',
  'COPY_2_CLIPBOARD_FULLNAMES',
  'COPY_2_CLIPBOARD_NAMES_AS_JSON',
  'COPY_2_CLIPBOARD_FULLNAMES_AS_JSON',
  'REVEAL_IN_FILE_MANAGER',
  'OPEN_TERMINAL_HERE',
  'OPEN_CONNECTIONS_DLG',
  'REMOTE_DISCONNECT',
  'REMOTE_RECONNECT',
  'OPEN_COMMAND_PALETTE',
  'OPEN_CALL_ACTION_DLG',
  'OPEN_CONTEXT_MENU',
  'FOCUS_MENU_BAR',
  'OPEN_ACTIONS_MENU',
  // selection
  'TOGGLE_MARK_AND_ADVANCE',
  'TOGGLE_MARK_AND_RETREAT',
  'TOGGLE_MARK',
  'MARK_DOWN',
  'MARK_UP',
  'MARK_TO_START',
  'MARK_TO_END',
  'SELECT_ALL',
  'DESELECT_ALL',
  'INVERT_MARKS',
  'OPEN_MARK_PATTERN_DLG',
  'OPEN_UNMARK_PATTERN_DLG',
  // panels / tabs
  'TOGGLE_PANEL',
  'SELECT_LEFT_PANEL',
  'SELECT_RIGHT_PANEL',
  'NEXT_TAB',
  'PREV_TAB',
  'CLONE_TAB',
  'CLOSE_TAB',
  'MOVE_TAB_LEFT',
  'MOVE_TAB_RIGHT',
  'MOVE_TAB_TO_OTHER_SIDE',
  'COPY_TAB_TO_OTHER_SIDE',
  'SWAP_PANELS',
  'SWAP_PANELS_WITH_TABS',
  'TARGET_EQUALS_SOURCE',
  'OPEN_CURSOR_IN_LEFT',
  'OPEN_CURSOR_IN_RIGHT',
  'TOGGLE_FAVORITE',
  'SPLITTER_RESET',
  'OPEN_FIND_DLG',
  'OPEN_FOLDER_FINDER_DLG',
  'RERUN_SEARCH',
  'GOTO_FILE',
  'TOGGLE_FLAT_VIEW',
  'TOGGLE_FLAT_VIEW_DIRS',
  // files
  'OPEN_VIEW_DLG',
  'QUICK_VIEW',
  'OPEN_EDIT_DLG',
  'OPEN_CREATE_FILE_DLG',
  'OPEN_COPY_DLG',
  'OPEN_MOVE_DLG',
  'OPEN_RENAME_DLG',
  'OPEN_MKDIR_DLG',
  'OPEN_DELETE_DLG',
  'DELETE_PERMANENT',
  'OPEN_LINK_DLG',
  'RENAME_INLINE',
  'OPEN_ATTRIBUTE_DLG',
  'OPEN_CHANGE_ATTRIBUTES_DLG',
  'OPEN_PACK_DLG',
  'OPEN_UNPACK_DLG',
  'OPEN_MULTIRENAME_DLG',
  'UNDO_RENAME',
  'OPEN_MULTIMKDIR_DLG',
  'OPEN_GROUPFILES_DLG',
  'OPEN_DELETE_EMPTY_FOLDERS_DLG',
  'OPEN_FIND_DUPLICATES_DLG',
  'COMPARE_FILES',
  'OPEN_CHECKSUM_CREATE_DLG',
  'CHECKSUM_VERIFY',
  'COPY_CHECKSUM',
  'OPEN_DISK_USAGE',
  'OPEN_DISK_USAGE_VOLUME',
  'DISK_USAGE_TOGGLE_CHART',
  'DISK_USAGE_LARGEST',
  'DUP_MARK_KEEP_NEWEST',
  'DUP_MARK_KEEP_OLDEST',
  'DUP_MARK_KEEP_FIRST',
  'DUP_APPLY_RULES',
  'DUP_RULES_DLG',
  'DUP_KEEP_THIS',
  'DUP_DELETE_MARKED',
  'DUP_NEXT_GROUP',
  'DUP_PREV_GROUP',
  // configuration
  'OPEN_SHORTCUT_DLG',
  'OPEN_SETUP_DLG',
  'OPEN_THEMES_DLG',
  'NEXT_THEME',
  'THEME_FOLLOW_SYSTEM',
  'OPEN_BUTTON_CONFIG_DLG',
  'OPEN_FILETYPE_CONFIG_DLG',
  'OPEN_TOOL_CONFIG_DLG',
  'OPEN_TOOLS_DLG',
  'OPEN_STARTER_MENU',
  'OPEN_STARTER_CONFIG_DLG',
  'OPEN_IMPORT_OLD_CONFIG_DLG',
  'OPEN_TASK_DLG',
  'OPEN_ABOUT_DLG',
  'QUIT_APP',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

/** Columns of the Actions menu (mr §1.8). */
export type ActionCategory = 'navigation' | 'selection' | 'files' | 'config';

export interface ActionMeta {
  readonly label: string;
  readonly category: ActionCategory;
  /** Prompt that implements it – until a handler is registered. */
  readonly availableIn: string;
  /** Not listed in the Actions menu (still in the palette). */
  readonly hiddenInMenu?: boolean;
}

export const CATEGORY_LABELS = translatable(
  'actionCategories',
  {
    navigation: 'Navigation & view',
    selection: 'Selection, panels & tabs',
    files: 'File operations',
    config: 'Configuration & tools',
  } as Readonly<Record<ActionCategory, string>>,
  { de: CATEGORY_LABELS_DE },
);

const m = (
  label: string,
  category: ActionCategory,
  availableIn: string,
  hiddenInMenu = false,
): ActionMeta => ({ label, category, availableIn, hiddenInMenu });

/** English source of the catalog; `ACTIONS[id].label` follows the language (design 015). */
const ACTIONS_EN: Readonly<Record<ActionId, ActionMeta>> = {
  NAVIGATE_OPEN: m('Open', 'navigation', '002', true),
  NAVIGATE_PARENT: m('Parent folder', 'navigation', '002'),
  OPEN_IN_NEW_TAB: m('Open folder in new tab', 'navigation', '002'),
  RELOAD_DIR: m('Reload', 'navigation', '002'),
  CANCEL_LOADING: m('Cancel opening the folder', 'navigation', '029'),
  NAVIGATE_BACK: m('History back', 'navigation', '003'),
  NAVIGATE_FORWARD: m('History forward', 'navigation', '003'),
  OPEN_CHDIR_DLG: m('Go to path…', 'navigation', '003'),
  OPEN_FOLDER_MENU_LEFT: m('Folder menu, left panel', 'navigation', '003'),
  OPEN_FOLDER_MENU_RIGHT: m('Folder menu, right panel', 'navigation', '003'),
  CALC_DIR_SIZES: m('Calculate folder sizes', 'navigation', '003'),
  TOGGLE_FILTER: m('Toggle filter', 'navigation', '003'),
  TOGGLE_HIDDEN_FILES: m('Toggle hidden files', 'navigation', '003'),
  TOGGLE_SHELL: m('Toggle shell', 'navigation', '021'),
  TOGGLE_FULLSCREEN: m('Full screen', 'navigation', '022'),
  SHELL_INSERT_NAMES: m('Insert names into the shell', 'navigation', '021', true),
  SHELL_INSERT_PATHS: m('Insert full paths into the shell', 'navigation', '021', true),
  SHELL_CLEAR_OUTPUT: m('Clear shell output', 'navigation', '021', true),
  COPY_2_CLIPBOARD_NAMES: m('Copy names to clipboard', 'navigation', '011'),
  COPY_2_CLIPBOARD_FULLNAMES: m('Copy full paths to clipboard', 'navigation', '011'),
  COPY_2_CLIPBOARD_NAMES_AS_JSON: m('Copy names as JSON', 'navigation', '011'),
  COPY_2_CLIPBOARD_FULLNAMES_AS_JSON: m('Copy full paths as JSON', 'navigation', '011'),
  REVEAL_IN_FILE_MANAGER: m('Show in file manager', 'navigation', '011'),
  OPEN_CONNECTIONS_DLG: m('Connect to server…', 'navigation', '034'),
  REMOTE_DISCONNECT: m('Disconnect from server', 'navigation', '034'),
  REMOTE_RECONNECT: m('Connect the server of this tab', 'navigation', '034', true),
  OPEN_TERMINAL_HERE: m('Open terminal here', 'navigation', '011'),
  OPEN_COMMAND_PALETTE: m('Command Palette…', 'navigation', '002'),
  OPEN_CALL_ACTION_DLG: m('Call action…', 'navigation', '002', true),
  OPEN_CONTEXT_MENU: m('Context menu', 'navigation', '014', true),
  FOCUS_MENU_BAR: m('Menu bar', 'navigation', '014', true),
  OPEN_ACTIONS_MENU: m('Actions menu', 'navigation', '020', true),
  TOGGLE_MARK_AND_ADVANCE: m('Toggle mark and move down', 'selection', '002'),
  TOGGLE_MARK_AND_RETREAT: m('Toggle mark and move up', 'selection', '018', true),
  TOGGLE_MARK: m('Toggle mark', 'selection', '018', true),
  MARK_DOWN: m('Mark and move down', 'selection', '002', true),
  MARK_UP: m('Mark and move up', 'selection', '002', true),
  MARK_TO_START: m('Mark to the first entry', 'selection', '002', true),
  MARK_TO_END: m('Mark to the last entry', 'selection', '002', true),
  SELECT_ALL: m('Mark all', 'selection', '002'),
  DESELECT_ALL: m('Unmark all', 'selection', '002'),
  INVERT_MARKS: m('Invert marks', 'selection', '002'),
  OPEN_MARK_PATTERN_DLG: m('Mark by pattern…', 'selection', '002'),
  OPEN_UNMARK_PATTERN_DLG: m('Unmark by pattern…', 'selection', '002'),
  TOGGLE_PANEL: m('Switch panel', 'selection', '002'),
  SELECT_LEFT_PANEL: m('Left panel', 'selection', '002'),
  SELECT_RIGHT_PANEL: m('Right panel', 'selection', '002'),
  NEXT_TAB: m('Next tab', 'selection', '002'),
  PREV_TAB: m('Previous tab', 'selection', '002'),
  CLONE_TAB: m('Clone tab', 'selection', '002'),
  CLOSE_TAB: m('Close tab', 'selection', '002'),
  MOVE_TAB_LEFT: m('Move tab left', 'selection', '031'),
  MOVE_TAB_RIGHT: m('Move tab right', 'selection', '031'),
  MOVE_TAB_TO_OTHER_SIDE: m('Move tab to the other side', 'selection', '031'),
  COPY_TAB_TO_OTHER_SIDE: m('Copy tab to the other side', 'selection', '031'),
  SWAP_PANELS: m('Swap panels', 'selection', '040'),
  SWAP_PANELS_WITH_TABS: m('Swap panels with all tabs', 'selection', '040'),
  TARGET_EQUALS_SOURCE: m('Target = source', 'selection', '040'),
  OPEN_CURSOR_IN_LEFT: m('Open in the left panel', 'navigation', '040'),
  OPEN_CURSOR_IN_RIGHT: m('Open in the right panel', 'navigation', '040'),
  TOGGLE_FAVORITE: m('Toggle favourite', 'selection', '002'),
  SPLITTER_RESET: m('Panels 50 / 50', 'selection', '002', true),
  OPEN_FIND_DLG: m('Find…', 'selection', '009'),
  OPEN_FOLDER_FINDER_DLG: m('Find folder (change dir)…', 'navigation', '009'),
  RERUN_SEARCH: m('Search again', 'selection', '009'),
  GOTO_FILE: m('Go to file (search result)', 'navigation', '009'),
  TOGGLE_FLAT_VIEW: m('Flat view (all files below)', 'navigation', '038'),
  TOGGLE_FLAT_VIEW_DIRS: m('Flat view: show folders', 'navigation', '038'),
  OPEN_VIEW_DLG: m('View', 'files', '010'),
  QUICK_VIEW: m('Quick view in the other panel', 'files', '010'),
  OPEN_EDIT_DLG: m('Edit', 'files', '011'),
  OPEN_CREATE_FILE_DLG: m('Create file…', 'files', '006'),
  OPEN_COPY_DLG: m('Copy…', 'files', '006'),
  OPEN_MOVE_DLG: m('Move…', 'files', '006'),
  OPEN_RENAME_DLG: m('Rename…', 'files', '006'),
  OPEN_MKDIR_DLG: m('Create folder…', 'files', '006'),
  OPEN_DELETE_DLG: m('Delete…', 'files', '006'),
  DELETE_PERMANENT: m('Delete permanently…', 'files', '006'),
  OPEN_LINK_DLG: m('Create link…', 'files', '031'),
  RENAME_INLINE: m('Rename in the list', 'files', '006'),
  OPEN_ATTRIBUTE_DLG: m('Properties…', 'files', '010'),
  OPEN_CHANGE_ATTRIBUTES_DLG: m('Change attributes…', 'files', '024'),
  OPEN_PACK_DLG: m('Pack…', 'files', '016'),
  OPEN_UNPACK_DLG: m('Unpack…', 'files', '016'),
  OPEN_MULTIRENAME_DLG: m('Multi rename…', 'files', '007'),
  UNDO_RENAME: m('Undo last multi rename', 'files', '007'),
  OPEN_MULTIMKDIR_DLG: m('Create several folders…', 'files', '008'),
  OPEN_GROUPFILES_DLG: m('Group files…', 'files', '008'),
  OPEN_DELETE_EMPTY_FOLDERS_DLG: m('Clean folders (delete empty folders)…', 'files', '008'),
  OPEN_FIND_DUPLICATES_DLG: m('Find duplicates…', 'files', '016'),
  COMPARE_FILES: m('Compare files…', 'files', '037'),
  OPEN_CHECKSUM_CREATE_DLG: m('Create checksums…', 'files', '039'),
  CHECKSUM_VERIFY: m('Verify checksums', 'files', '039'),
  COPY_CHECKSUM: m('Copy SHA-256 to clipboard', 'files', '039', true),
  OPEN_DISK_USAGE: m('Disk usage…', 'files', '033'),
  OPEN_DISK_USAGE_VOLUME: m('Disk usage of the drive…', 'files', '033'),
  DISK_USAGE_TOGGLE_CHART: m('Disk usage: rings or tiles', 'navigation', '033', true),
  DISK_USAGE_LARGEST: m('Disk usage: largest files', 'navigation', '033', true),
  DUP_MARK_KEEP_NEWEST: m('Duplicates: mark all but the newest', 'selection', '016'),
  DUP_MARK_KEEP_OLDEST: m('Duplicates: mark all but the oldest', 'selection', '016'),
  DUP_MARK_KEEP_FIRST: m('Duplicates: mark all but the first (shortest path)', 'selection', '016'),
  DUP_APPLY_RULES: m('Duplicates: apply the rules', 'selection', '042'),
  DUP_RULES_DLG: m('Duplicates: rules…', 'selection', '042'),
  DUP_KEEP_THIS: m('Duplicates: keep this file', 'selection', '042', true),
  DUP_DELETE_MARKED: m('Duplicates: delete the marked copies…', 'files', '042'),
  DUP_NEXT_GROUP: m('Duplicates: next group', 'navigation', '042'),
  DUP_PREV_GROUP: m('Duplicates: previous group', 'navigation', '042'),
  OPEN_SHORTCUT_DLG: m('Keyboard shortcuts…', 'config', '002'),
  OPEN_SETUP_DLG: m('Settings…', 'config', '015'),
  OPEN_THEMES_DLG: m('Colour schemes…', 'config', '013'),
  NEXT_THEME: m('Next colour scheme', 'config', '013'),
  THEME_FOLLOW_SYSTEM: m('Colour scheme: follow the system', 'config', '013'),
  OPEN_BUTTON_CONFIG_DLG: m('Button configuration…', 'config', '022'),
  OPEN_FILETYPE_CONFIG_DLG: m('File types…', 'config', '022'),
  OPEN_TOOL_CONFIG_DLG: m('Tool configuration…', 'config', '011'),
  OPEN_TOOLS_DLG: m('Open with tool…', 'config', '011'),
  OPEN_STARTER_MENU: m('Starter menu', 'config', '032'),
  OPEN_STARTER_CONFIG_DLG: m('Change starter menu…', 'config', '032'),
  OPEN_IMPORT_OLD_CONFIG_DLG: m('Import from Files and Folders (old)…', 'config', '026'),
  OPEN_TASK_DLG: m('Tasks…', 'config', '005'),
  OPEN_ABOUT_DLG: m('About…', 'config', '017'),
  QUIT_APP: m('Quit', 'config', '014'),
};

/** Action labels in English (source of the translations). */
export const ACTION_LABELS_EN = Object.fromEntries(
  ACTION_IDS.map((id) => [id, ACTIONS_EN[id].label]),
) as Readonly<Record<ActionId, string>>;

const LABELS = translatable('actions', ACTION_LABELS_EN, { de: ACTION_LABELS_DE });

export const ACTIONS: Readonly<Record<ActionId, ActionMeta>> = Object.fromEntries(
  ACTION_IDS.map((id) => {
    const en = ACTIONS_EN[id];
    const meta: ActionMeta = {
      get label() {
        return LABELS[id];
      },
      category: en.category,
      availableIn: en.availableIn,
      hiddenInMenu: en.hiddenInMenu,
    };
    return [id, meta];
  }),
) as Record<ActionId, ActionMeta>;

export function isActionId(id: string): id is ActionId {
  return Object.prototype.hasOwnProperty.call(ACTIONS, id);
}

/** Label without the trailing "…" (buttons). */
export function shortLabel(id: ActionId): string {
  return ACTIONS[id].label.replace(/…$/, '');
}
