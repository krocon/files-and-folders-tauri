import { ACTIONS, ActionId } from '../../core/actions/action-catalog';
import { ActionState, ExtraAction } from '../../core/actions/action.service';
import { Platform } from '../../core/actions/platform';
import { canonicalShortcut } from '../../core/actions/shortcut';
import {
  MenuItemEnabled,
  NativeMenuNode,
  NativeMenuSpec,
  PredefinedItem,
} from '../../core/menu/menu.models';
import { MenuItem } from '../workspace/context-menu';
import { MENU_TEXTS } from './menu-texts';

/**
 * Menu definitions (design 014): every entry is an action id of the catalog – the
 * menus only arrange them. `'-'` = separator, `'@tools'` = the tools of
 * `tools.json` (extra actions, design 011 E4).
 */
export type MenuDef =
  | ActionId
  | '-'
  | '@tools'
  | { readonly sub: string; readonly items: readonly MenuDef[] }
  | { readonly native: PredefinedItem }
  | { readonly heading: string }
  | { readonly when: 'macos' | 'notMacos'; readonly items: readonly MenuDef[] };

export interface TopMenu {
  readonly id: string;
  readonly label: string;
  readonly items: readonly MenuDef[];
  /** Only in the native macOS menu (the application menu). */
  readonly macosOnly?: boolean;
}

/** What the menus need from the {@link ActionService} (keeps the model testable). */
export interface MenuSource {
  state(id: ActionId): ActionState;
  shortcutLabel(id: ActionId): string;
  shortcuts(id: ActionId): readonly string[];
  extras(): readonly ExtraAction[];
  extraShortcutLabel(id: string): string;
  /** Enabled and not vetoed (e.g. no tools inside an archive, design 016). */
  extraReady(id: string): boolean;
}

/** Labels are getters: they follow the language (design 015) instead of being read at load. */
const T = MENU_TEXTS;

const COPY_AS: MenuDef = {
  get sub() {
    return T.copyAs;
  },
  items: [
    'COPY_2_CLIPBOARD_NAMES',
    'COPY_2_CLIPBOARD_FULLNAMES',
    'COPY_2_CLIPBOARD_NAMES_AS_JSON',
    'COPY_2_CLIPBOARD_FULLNAMES_AS_JSON',
  ],
};
/** Selection helpers of a duplicate tab (design 016 E6). */
const DUP_MARK: MenuDef = {
  get sub() {
    return T.duplicates;
  },
  items: ['DUP_MARK_KEEP_NEWEST', 'DUP_MARK_KEEP_OLDEST', 'DUP_MARK_KEEP_FIRST'],
};
const WITH_TOOL: MenuDef = {
  get sub() {
    return T.openWithTool;
  },
  items: ['@tools', '-', 'OPEN_TOOLS_DLG'],
};

/** The menu bar (design 014 E8) – native on macOS, in the window elsewhere. */
export const MENU_BAR: readonly TopMenu[] = [
  {
    id: 'app',
    get label() {
      return T.appName;
    },
    macosOnly: true,
    items: [
      { native: 'about' },
      '-',
      'OPEN_SETUP_DLG',
      'OPEN_SHORTCUT_DLG',
      '-',
      { native: 'services' },
      '-',
      { native: 'hide' },
      { native: 'hideOthers' },
      { native: 'showAll' },
      '-',
      { native: 'quit' },
    ],
  },
  {
    id: 'file',
    get label() {
      return T.file;
    },
    items: [
      'NAVIGATE_OPEN',
      'OPEN_IN_NEW_TAB',
      'OPEN_VIEW_DLG',
      'OPEN_EDIT_DLG',
      '-',
      'OPEN_CREATE_FILE_DLG',
      'OPEN_MKDIR_DLG',
      'OPEN_MULTIMKDIR_DLG',
      '-',
      'OPEN_COPY_DLG',
      'OPEN_MOVE_DLG',
      'OPEN_RENAME_DLG',
      'RENAME_INLINE',
      'OPEN_DELETE_DLG',
      'DELETE_PERMANENT',
      '-',
      'OPEN_MULTIRENAME_DLG',
      'UNDO_RENAME',
      'OPEN_GROUPFILES_DLG',
      'OPEN_DELETE_EMPTY_FOLDERS_DLG',
      'OPEN_PACK_DLG',
      'OPEN_UNPACK_DLG',
      'OPEN_FIND_DUPLICATES_DLG',
      '-',
      'OPEN_ATTRIBUTE_DLG',
      { when: 'notMacos', items: ['-', 'QUIT_APP'] },
    ],
  },
  {
    id: 'edit',
    get label() {
      return T.edit;
    },
    items: [
      {
        when: 'macos',
        items: [
          { native: 'undo' },
          { native: 'redo' },
          '-',
          { native: 'cut' },
          { native: 'copy' },
          { native: 'paste' },
          { native: 'selectAll' },
          '-',
        ],
      },
      'SELECT_ALL',
      'DESELECT_ALL',
      'INVERT_MARKS',
      'TOGGLE_MARK_AND_ADVANCE',
      'OPEN_MARK_PATTERN_DLG',
      'OPEN_UNMARK_PATTERN_DLG',
      DUP_MARK,
      '-',
      COPY_AS,
    ],
  },
  {
    id: 'view',
    get label() {
      return T.view;
    },
    items: [
      'RELOAD_DIR',
      'CANCEL_LOADING',
      'TOGGLE_HIDDEN_FILES',
      'TOGGLE_FILTER',
      'CALC_DIR_SIZES',
      '-',
      'QUICK_VIEW',
      'TOGGLE_SHELL',
      'SHELL_INSERT_NAMES',
      'SHELL_INSERT_PATHS',
      'SHELL_CLEAR_OUTPUT',
      'SPLITTER_RESET',
      { when: 'notMacos', items: ['TOGGLE_FULLSCREEN'] },
      '-',
      'NEXT_THEME',
      'THEME_FOLLOW_SYSTEM',
      'OPEN_THEMES_DLG',
    ],
  },
  {
    id: 'go',
    get label() {
      return T.go;
    },
    items: [
      'NAVIGATE_PARENT',
      'NAVIGATE_BACK',
      'NAVIGATE_FORWARD',
      'OPEN_CHDIR_DLG',
      '-',
      'OPEN_FOLDER_MENU_LEFT',
      'OPEN_FOLDER_MENU_RIGHT',
      'OPEN_FOLDER_FINDER_DLG',
      'OPEN_COMMAND_PALETTE',
      'GOTO_FILE',
      'TOGGLE_FAVORITE',
      '-',
      'REVEAL_IN_FILE_MANAGER',
      'OPEN_TERMINAL_HERE',
    ],
  },
  {
    id: 'tools',
    get label() {
      return T.tools;
    },
    items: [
      'OPEN_FIND_DLG',
      'RERUN_SEARCH',
      '-',
      'OPEN_TOOLS_DLG',
      '@tools',
      'OPEN_TOOL_CONFIG_DLG',
      '-',
      'OPEN_SHORTCUT_DLG',
      'OPEN_BUTTON_CONFIG_DLG',
      'OPEN_FILETYPE_CONFIG_DLG',
      'OPEN_CALL_ACTION_DLG',
      { when: 'notMacos', items: ['OPEN_SETUP_DLG'] },
    ],
  },
  {
    id: 'window',
    get label() {
      return T.window;
    },
    items: [
      {
        when: 'macos',
        items: [{ native: 'minimize' }, { native: 'maximize' }, { native: 'fullscreen' }, '-'],
      },
      'TOGGLE_PANEL',
      'SELECT_LEFT_PANEL',
      'SELECT_RIGHT_PANEL',
      '-',
      'NEXT_TAB',
      'PREV_TAB',
      'CLONE_TAB',
      'CLOSE_TAB',
      '-',
      'OPEN_TASK_DLG',
    ],
  },
  {
    id: 'help',
    get label() {
      return T.help;
    },
    items: [
      'OPEN_SHORTCUT_DLG',
      'OPEN_COMMAND_PALETTE',
      { when: 'notMacos', items: ['-', 'OPEN_ABOUT_DLG'] },
    ],
  },
];

/** Where a context menu was opened (design 014 E2). */
export type ContextKind =
  'file' | 'archiveFile' | 'folder' | 'marked' | 'empty' | 'result' | 'archive';

const CONTEXT: Readonly<Record<ContextKind, readonly MenuDef[]>> = {
  file: [
    'NAVIGATE_OPEN',
    'OPEN_VIEW_DLG',
    'OPEN_EDIT_DLG',
    WITH_TOOL,
    '-',
    'OPEN_COPY_DLG',
    'OPEN_MOVE_DLG',
    'OPEN_RENAME_DLG',
    'OPEN_DELETE_DLG',
    '-',
    COPY_AS,
    'REVEAL_IN_FILE_MANAGER',
    'OPEN_ATTRIBUTE_DLG',
  ],
  // the cursor is on a ZIP/TAR file (design 016): open it like a folder or unpack it
  archiveFile: [
    'NAVIGATE_OPEN',
    'OPEN_IN_NEW_TAB',
    'OPEN_UNPACK_DLG',
    WITH_TOOL,
    '-',
    'OPEN_COPY_DLG',
    'OPEN_MOVE_DLG',
    'OPEN_RENAME_DLG',
    'OPEN_DELETE_DLG',
    '-',
    COPY_AS,
    'REVEAL_IN_FILE_MANAGER',
    'OPEN_ATTRIBUTE_DLG',
  ],
  folder: [
    'NAVIGATE_OPEN',
    'OPEN_IN_NEW_TAB',
    'CALC_DIR_SIZES',
    WITH_TOOL,
    '-',
    'OPEN_COPY_DLG',
    'OPEN_MOVE_DLG',
    'OPEN_RENAME_DLG',
    'OPEN_DELETE_DLG',
    '-',
    COPY_AS,
    'REVEAL_IN_FILE_MANAGER',
    'OPEN_TERMINAL_HERE',
    'OPEN_ATTRIBUTE_DLG',
  ],
  marked: [
    'OPEN_COPY_DLG',
    'OPEN_MOVE_DLG',
    'OPEN_DELETE_DLG',
    'OPEN_MULTIRENAME_DLG',
    'OPEN_GROUPFILES_DLG',
    'OPEN_PACK_DLG',
    'OPEN_UNPACK_DLG',
    '-',
    WITH_TOOL,
    COPY_AS,
    'OPEN_ATTRIBUTE_DLG',
    '-',
    'DESELECT_ALL',
    'INVERT_MARKS',
  ],
  empty: [
    'OPEN_MKDIR_DLG',
    'OPEN_CREATE_FILE_DLG',
    'OPEN_MULTIMKDIR_DLG',
    '-',
    'RELOAD_DIR',
    'TOGGLE_HIDDEN_FILES',
    'TOGGLE_FILTER',
    '-',
    'SELECT_ALL',
    'OPEN_MARK_PATTERN_DLG',
    '-',
    // no REVEAL_IN_FILE_MANAGER / CALC_DIR_SIZES: they act on the cursor row,
    // which a click on free space does not move (review 014 #2)
    'OPEN_TERMINAL_HERE',
  ],
  result: [
    'GOTO_FILE',
    'NAVIGATE_OPEN',
    'OPEN_VIEW_DLG',
    'OPEN_EDIT_DLG',
    WITH_TOOL,
    '-',
    'OPEN_COPY_DLG',
    'OPEN_MOVE_DLG',
    'OPEN_DELETE_DLG',
    '-',
    COPY_AS,
    'REVEAL_IN_FILE_MANAGER',
    'RERUN_SEARCH',
    DUP_MARK,
    'OPEN_ATTRIBUTE_DLG',
  ],
  // inside an archive (read-only, design 016): extract, marks, names
  archive: [
    'NAVIGATE_OPEN',
    'OPEN_UNPACK_DLG',
    'OPEN_COPY_DLG',
    '-',
    COPY_AS,
    '-',
    'SELECT_ALL',
    'DESELECT_ALL',
    'INVERT_MARKS',
    'OPEN_MARK_PATTERN_DLG',
  ],
};

/** Definitions of a context menu; `marked` > 0 adds the heading "N marked entries". */
export function contextMenuFor(kind: ContextKind, marked = 0): readonly MenuDef[] {
  if (kind === 'marked' || (kind === 'archive' && marked > 0)) {
    return [{ heading: T.marked(marked) }, ...CONTEXT[kind]];
  }
  return CONTEXT[kind];
}

/** Which context a right click / Shift+F10 means (design 014 E2/E3). */
export function contextKind(input: {
  readonly resultTab: boolean;
  readonly markedCount: number;
  /** Entry under the cursor (after the right click moved it), null on free space or `..`. */
  readonly entry: { readonly kind: string } | null;
  /** The panel shows a folder inside an archive (design 016). */
  readonly inArchive?: boolean;
  /** The entry is a ZIP/TAR file (`isArchiveEntry`). */
  readonly archiveFile?: boolean;
}): ContextKind {
  if (input.inArchive) {
    return 'archive';
  }
  if (input.markedCount > 0) {
    return 'marked';
  }
  if (!input.entry) {
    return 'empty';
  }
  if (input.resultTab) {
    return 'result';
  }
  if (input.entry.kind === 'directory') {
    return 'folder';
  }
  return input.archiveFile ? 'archiveFile' : 'file';
}

function expand(defs: readonly MenuDef[], platform: Platform): MenuDef[] {
  const out: MenuDef[] = [];
  for (const d of defs) {
    if (typeof d === 'object' && 'when' in d) {
      if ((d.when === 'macos') === (platform === 'macos')) {
        out.push(...expand(d.items, platform));
      }
    } else {
      out.push(d);
    }
  }
  return out;
}

/** No separator first, last or twice in a row (a hidden tool list can leave one). */
function tidy<T>(items: T[], isSeparator: (t: T) => boolean): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (isSeparator(item) && (out.length === 0 || isSeparator(out[out.length - 1]))) {
      continue;
    }
    out.push(item);
  }
  while (out.length > 0 && isSeparator(out[out.length - 1])) {
    out.pop();
  }
  return out;
}

let separatorSeq = 0;

/** Definitions → items of the HTML menus (label, badge, dimmed + hint). Native-only entries are left out. */
export function resolveMenu(
  defs: readonly MenuDef[],
  src: MenuSource,
  platform: Platform,
): MenuItem[] {
  const items: MenuItem[] = [];
  for (const d of expand(defs, platform)) {
    if (d === '-') {
      items.push({ id: `-${++separatorSeq}`, label: '', separator: true });
    } else if (d === '@tools') {
      for (const x of src.extras()) {
        items.push({
          id: x.id,
          label: x.label,
          shortcut: src.extraShortcutLabel(x.id),
          disabled: !src.extraReady(x.id),
        });
      }
    } else if (typeof d === 'string') {
      const state = src.state(d);
      items.push({
        id: d,
        label: ACTIONS[d].label,
        shortcut: src.shortcutLabel(d),
        disabled: state !== 'ready',
        hint: state === 'unavailable' ? T.comingIn(ACTIONS[d].availableIn) : undefined,
      });
    } else if ('sub' in d) {
      const children = resolveMenu(d.items, src, platform);
      items.push({
        id: `sub:${d.sub}`,
        label: d.sub,
        children,
        disabled: children.every((c) => c.disabled || c.separator),
      });
    } else if ('heading' in d) {
      items.push({ id: `h:${d.heading}`, label: d.heading, heading: true });
    }
  }
  return tidy(items, (i) => i.separator === true);
}

/** The menu bar for the HTML menus of Windows/Linux. */
export function resolveMenuBar(
  src: MenuSource,
  platform: Platform,
): { id: string; label: string; items: MenuItem[] }[] {
  return MENU_BAR.filter((m) => !m.macosOnly || platform === 'macos').map((m) => ({
    id: m.id,
    label: m.label,
    items: resolveMenu(m.items, src, platform),
  }));
}

/**
 * The native menu (design 014 E6/E7): shortcuts in keymap notation (the first one,
 * like the badges – Rust keeps only the safe ones); `blocked` (a dialog is open)
 * disables every action but leaves the native Edit items working.
 */
export function toNativeSpec(
  src: MenuSource,
  platform: Platform,
  blocked: boolean,
): NativeMenuSpec {
  const nodes = (defs: readonly MenuDef[]): NativeMenuNode[] => {
    const out: NativeMenuNode[] = [];
    for (const d of expand(defs, platform)) {
      if (d === '-') {
        out.push({ kind: 'separator' });
      } else if (d === '@tools') {
        for (const x of src.extras()) {
          const shown = src.extraShortcutLabel(x.id) !== '' && x.shortcut;
          out.push({
            kind: 'item',
            id: x.id,
            label: nativeLabel(x.label),
            accelerator: shown ? canonicalShortcut(x.shortcut!, platform) : null,
            enabled: !blocked && src.extraReady(x.id),
          });
        }
      } else if (typeof d === 'string') {
        out.push({
          kind: 'item',
          id: d,
          label: nativeLabel(ACTIONS[d].label),
          accelerator: src.shortcuts(d)[0] ?? null,
          enabled: !blocked && src.state(d) === 'ready',
        });
      } else if ('sub' in d) {
        out.push({ kind: 'submenu', label: nativeLabel(d.sub), items: nodes(d.items) });
      } else if ('native' in d) {
        out.push({ kind: 'predefined', name: d.native });
      }
    }
    return tidy(out, (n) => n.kind === 'separator');
  };
  return {
    menus: MENU_BAR.filter((m) => !m.macosOnly || platform === 'macos').map((m) => ({
      kind: 'submenu',
      label: m.label,
      items: nodes(m.items),
    })),
  };
}

/** Longest label Rust accepts (`app_menu::MAX_LABEL`). */
export const NATIVE_MAX_LABEL = 120;

/**
 * A label the native menu accepts (review 014 #4): control characters and runs of
 * whitespace become one space, at most {@link NATIVE_MAX_LABEL} characters – one
 * odd tool label must not cost the whole menu bar.
 */
export function nativeLabel(label: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = label.replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, ' ').trim();
  const chars = [...clean];
  return (
    (chars.length > NATIVE_MAX_LABEL
      ? chars.slice(0, NATIVE_MAX_LABEL - 1).join('') + '…'
      : clean) || '?'
  );
}

/** The spec without the enabled flags: equal keys = same menu, only states differ (review 014 #7). */
export function nativeStructureKey(spec: NativeMenuSpec): string {
  return JSON.stringify(spec, (key, value: unknown) => (key === 'enabled' ? undefined : value));
}

/** Enabled flag per item id (an action in several menus has one state). */
export function nativeEnabled(spec: NativeMenuSpec): ReadonlyMap<string, boolean> {
  const out = new Map<string, boolean>();
  const walk = (nodes: readonly NativeMenuNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'submenu') {
        walk(n.items);
      } else if (n.kind === 'item') {
        out.set(n.id, n.enabled);
      }
    }
  };
  walk(spec.menus);
  return out;
}

/** Items whose enabled flag differs between two specs of the same structure. */
export function enabledChanges(
  prev: ReadonlyMap<string, boolean>,
  next: ReadonlyMap<string, boolean>,
): MenuItemEnabled[] {
  const out: MenuItemEnabled[] = [];
  for (const [id, enabled] of next) {
    if (prev.get(id) !== enabled) {
      out.push({ id, enabled });
    }
  }
  return out;
}
