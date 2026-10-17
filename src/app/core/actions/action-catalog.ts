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
  'NAVIGATE_BACK',
  'NAVIGATE_FORWARD',
  'OPEN_CHDIR_DLG',
  'OPEN_FOLDER_MENU_LEFT',
  'OPEN_FOLDER_MENU_RIGHT',
  'CALC_DIR_SIZES',
  'TOGGLE_FILTER',
  'TOGGLE_HIDDEN_FILES',
  'TOGGLE_SHELL',
  'COPY_2_CLIPBOARD_NAMES',
  'COPY_2_CLIPBOARD_FULLNAMES',
  'COPY_2_CLIPBOARD_NAMES_AS_JSON',
  'COPY_2_CLIPBOARD_FULLNAMES_AS_JSON',
  'OPEN_COMMAND_PALETTE',
  'OPEN_CALL_ACTION_DLG',
  // selection
  'TOGGLE_MARK_AND_ADVANCE',
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
  'TOGGLE_FAVORITE',
  'SPLITTER_RESET',
  'OPEN_FIND_DLG',
  // files
  'OPEN_VIEW_DLG',
  'OPEN_EDIT_DLG',
  'OPEN_CREATE_FILE_DLG',
  'OPEN_COPY_DLG',
  'OPEN_MOVE_DLG',
  'OPEN_RENAME_DLG',
  'OPEN_MKDIR_DLG',
  'OPEN_DELETE_DLG',
  'DELETE_PERMANENT',
  'RENAME_INLINE',
  'OPEN_ATTRIBUTE_DLG',
  'OPEN_PACK_DLG',
  'OPEN_UNPACK_DLG',
  'OPEN_MULTIRENAME_DLG',
  'OPEN_MULTIMKDIR_DLG',
  'OPEN_GROUPFILES_DLG',
  'OPEN_DELETE_EMPTY_FOLDERS_DLG',
  'OPEN_FIND_DUPLICATES_DLG',
  // configuration
  'OPEN_SHORTCUT_DLG',
  'OPEN_SETUP_DLG',
  'OPEN_THEMES_DLG',
  'OPEN_BUTTON_CONFIG_DLG',
  'OPEN_TOOL_CONFIG_DLG',
  'OPEN_TASK_DLG',
  'OPEN_ABOUT_DLG',
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

export const CATEGORY_LABELS: Readonly<Record<ActionCategory, string>> = {
  navigation: 'Navigation & view',
  selection: 'Selection, panels & tabs',
  files: 'File operations',
  config: 'Configuration & tools',
};

const m = (
  label: string,
  category: ActionCategory,
  availableIn: string,
  hiddenInMenu = false,
): ActionMeta => ({ label, category, availableIn, hiddenInMenu });

export const ACTIONS: Readonly<Record<ActionId, ActionMeta>> = {
  NAVIGATE_OPEN: m('Open', 'navigation', '002', true),
  NAVIGATE_PARENT: m('Parent folder', 'navigation', '002'),
  OPEN_IN_NEW_TAB: m('Open folder in new tab', 'navigation', '002'),
  RELOAD_DIR: m('Reload', 'navigation', '002'),
  NAVIGATE_BACK: m('History back', 'navigation', '003'),
  NAVIGATE_FORWARD: m('History forward', 'navigation', '003'),
  OPEN_CHDIR_DLG: m('Go to path…', 'navigation', '003'),
  OPEN_FOLDER_MENU_LEFT: m('Folder menu, left panel', 'navigation', '003'),
  OPEN_FOLDER_MENU_RIGHT: m('Folder menu, right panel', 'navigation', '003'),
  CALC_DIR_SIZES: m('Calculate folder sizes', 'navigation', '003'),
  TOGGLE_FILTER: m('Toggle filter', 'navigation', '003'),
  TOGGLE_HIDDEN_FILES: m('Toggle hidden files', 'navigation', '003'),
  TOGGLE_SHELL: m('Toggle shell', 'navigation', '011'),
  COPY_2_CLIPBOARD_NAMES: m('Copy names to clipboard', 'navigation', '011'),
  COPY_2_CLIPBOARD_FULLNAMES: m('Copy full paths to clipboard', 'navigation', '011'),
  COPY_2_CLIPBOARD_NAMES_AS_JSON: m('Copy names as JSON', 'navigation', '011'),
  COPY_2_CLIPBOARD_FULLNAMES_AS_JSON: m('Copy full paths as JSON', 'navigation', '011'),
  OPEN_COMMAND_PALETTE: m('Go to anything…', 'navigation', '002'),
  OPEN_CALL_ACTION_DLG: m('Call action…', 'navigation', '002', true),
  TOGGLE_MARK_AND_ADVANCE: m('Toggle mark and move down', 'selection', '002'),
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
  TOGGLE_FAVORITE: m('Toggle favourite', 'selection', '002'),
  SPLITTER_RESET: m('Panels 50 / 50', 'selection', '002', true),
  OPEN_FIND_DLG: m('Find…', 'selection', '009'),
  OPEN_VIEW_DLG: m('View', 'files', '010'),
  OPEN_EDIT_DLG: m('Edit', 'files', '011'),
  OPEN_CREATE_FILE_DLG: m('Create file…', 'files', '006'),
  OPEN_COPY_DLG: m('Copy…', 'files', '006'),
  OPEN_MOVE_DLG: m('Move…', 'files', '006'),
  OPEN_RENAME_DLG: m('Rename…', 'files', '006'),
  OPEN_MKDIR_DLG: m('Create folder…', 'files', '006'),
  OPEN_DELETE_DLG: m('Delete…', 'files', '006'),
  DELETE_PERMANENT: m('Delete permanently…', 'files', '006'),
  RENAME_INLINE: m('Rename in the list', 'files', '006'),
  OPEN_ATTRIBUTE_DLG: m('Properties…', 'files', '010'),
  OPEN_PACK_DLG: m('Pack…', 'files', '016'),
  OPEN_UNPACK_DLG: m('Unpack…', 'files', '016'),
  OPEN_MULTIRENAME_DLG: m('Multi rename…', 'files', '007'),
  OPEN_MULTIMKDIR_DLG: m('Create several folders…', 'files', '008'),
  OPEN_GROUPFILES_DLG: m('Group files…', 'files', '008'),
  OPEN_DELETE_EMPTY_FOLDERS_DLG: m('Delete empty folders…', 'files', '008'),
  OPEN_FIND_DUPLICATES_DLG: m('Find duplicates…', 'files', '016'),
  OPEN_SHORTCUT_DLG: m('Keyboard shortcuts…', 'config', '002'),
  OPEN_SETUP_DLG: m('Settings…', 'config', '015'),
  OPEN_THEMES_DLG: m('Themes…', 'config', '013'),
  OPEN_BUTTON_CONFIG_DLG: m('Button configuration…', 'config', '015'),
  OPEN_TOOL_CONFIG_DLG: m('Tool configuration…', 'config', '011'),
  OPEN_TASK_DLG: m('Tasks…', 'config', '005'),
  OPEN_ABOUT_DLG: m('About…', 'config', '015'),
};

export function isActionId(id: string): id is ActionId {
  return Object.prototype.hasOwnProperty.call(ACTIONS, id);
}

/** Label without the trailing "…" (buttons). */
export function shortLabel(id: ActionId): string {
  return ACTIONS[id].label.replace(/…$/, '');
}
