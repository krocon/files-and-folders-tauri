import { ActionId } from '../../core/actions/action-catalog';

/** `'-'` = divider, `'@tools'` = the configured tools (tools.json). */
export type ActionsMenuEntry = ActionId | '-' | '@tools';

/**
 * The four columns of the Actions menu ▴ as in the old version (mr
 * `buttonpanel.component.ts` menuItems0–3, design 020 E1). Left out (✖, see design):
 * Download (HTTP transport), Server Shell (the terminal is a tool), Theme
 * Configuration (same dialog as the theme editor), File Type and Prompt
 * Configuration (no such configuration yet). Added: Find Duplicates, Shortcuts.
 */
export const ACTIONS_MENU_COLUMNS: readonly (readonly ActionsMenuEntry[])[] = [
  [
    'OPEN_COMMAND_PALETTE',
    '-',
    'RELOAD_DIR',
    'OPEN_CHDIR_DLG',
    'TOGGLE_FILTER',
    'TOGGLE_HIDDEN_FILES',
    'TOGGLE_SHELL',
    '-',
    'COPY_2_CLIPBOARD_NAMES',
    'COPY_2_CLIPBOARD_FULLNAMES',
    'COPY_2_CLIPBOARD_NAMES_AS_JSON',
    'COPY_2_CLIPBOARD_FULLNAMES_AS_JSON',
  ],
  [
    'OPEN_FIND_DLG',
    '-',
    'OPEN_MARK_PATTERN_DLG',
    'OPEN_UNMARK_PATTERN_DLG',
    'INVERT_MARKS',
    'SELECT_ALL',
    'DESELECT_ALL',
    '-',
    'NAVIGATE_PARENT',
    'NAVIGATE_BACK',
    '-',
    'SELECT_LEFT_PANEL',
    'SELECT_RIGHT_PANEL',
    'TOGGLE_PANEL',
    '-',
    'CLONE_TAB',
    'CLOSE_TAB',
  ],
  [
    'OPEN_COPY_DLG',
    'OPEN_MOVE_DLG',
    'OPEN_DELETE_DLG',
    'OPEN_MKDIR_DLG',
    'OPEN_RENAME_DLG',
    'OPEN_ATTRIBUTE_DLG',
    'OPEN_UNPACK_DLG',
    'OPEN_PACK_DLG',
    '-',
    'OPEN_MULTIRENAME_DLG',
    'OPEN_MULTIMKDIR_DLG',
    'OPEN_GROUPFILES_DLG',
    'OPEN_DELETE_EMPTY_FOLDERS_DLG',
    'OPEN_FIND_DUPLICATES_DLG',
  ],
  [
    'OPEN_SETUP_DLG',
    'OPEN_THEMES_DLG',
    'OPEN_BUTTON_CONFIG_DLG',
    'OPEN_TOOL_CONFIG_DLG',
    'OPEN_SHORTCUT_DLG',
    'OPEN_ABOUT_DLG',
    '-',
    '@tools',
  ],
];
