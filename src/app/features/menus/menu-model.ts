import { ACTIONS, ActionId } from '../../core/actions/action-catalog';
import { ActionState, ExtraAction } from '../../core/actions/action.service';
import { Platform } from '../../core/actions/platform';
import { canonicalShortcut } from '../../core/actions/shortcut';
import { NativeMenuNode, NativeMenuSpec, PredefinedItem } from '../../core/menu/menu.models';
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
}

const T = MENU_TEXTS;

const COPY_AS: MenuDef = {
  sub: T.copyAs,
  items: [
    'COPY_2_CLIPBOARD_NAMES',
    'COPY_2_CLIPBOARD_FULLNAMES',
    'COPY_2_CLIPBOARD_NAMES_AS_JSON',
    'COPY_2_CLIPBOARD_FULLNAMES_AS_JSON',
  ],
};
const WITH_TOOL: MenuDef = { sub: T.openWithTool, items: ['@tools', '-', 'OPEN_TOOLS_DLG'] };

/** The menu bar (design 014 E8) – native on macOS, in the window elsewhere. */
export const MENU_BAR: readonly TopMenu[] = [
  {
    id: 'app',
    label: T.appName,
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
    label: T.file,
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
    label: T.edit,
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
      '-',
      COPY_AS,
    ],
  },
  {
    id: 'view',
    label: T.view,
    items: [
      'RELOAD_DIR',
      'TOGGLE_HIDDEN_FILES',
      'TOGGLE_FILTER',
      'CALC_DIR_SIZES',
      '-',
      'QUICK_VIEW',
      'TOGGLE_SHELL',
      'SPLITTER_RESET',
      '-',
      'OPEN_THEMES_DLG',
    ],
  },
  {
    id: 'go',
    label: T.go,
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
    label: T.tools,
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
      'OPEN_CALL_ACTION_DLG',
      { when: 'notMacos', items: ['OPEN_SETUP_DLG'] },
    ],
  },
  {
    id: 'window',
    label: T.window,
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
    label: T.help,
    items: [
      'OPEN_SHORTCUT_DLG',
      'OPEN_COMMAND_PALETTE',
      { when: 'notMacos', items: ['-', 'OPEN_ABOUT_DLG'] },
    ],
  },
];

/** Where a context menu was opened (design 014 E2). */
export type ContextKind = 'file' | 'folder' | 'marked' | 'empty' | 'result';

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
    'CALC_DIR_SIZES',
    '-',
    'SELECT_ALL',
    'OPEN_MARK_PATTERN_DLG',
    '-',
    'OPEN_TERMINAL_HERE',
    'REVEAL_IN_FILE_MANAGER',
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
    'OPEN_ATTRIBUTE_DLG',
  ],
};

/** Definitions of a context menu; `marked` > 0 adds the heading "N marked entries". */
export function contextMenuFor(kind: ContextKind, marked = 0): readonly MenuDef[] {
  return kind === 'marked' ? [{ heading: T.marked(marked) }, ...CONTEXT.marked] : CONTEXT[kind];
}

/** Which context a right click / Shift+F10 means (design 014 E2/E3). */
export function contextKind(input: {
  readonly resultTab: boolean;
  readonly markedCount: number;
  /** Entry under the cursor (after the right click moved it), null on free space or `..`. */
  readonly entry: { readonly kind: string } | null;
}): ContextKind {
  if (input.markedCount > 0) {
    return 'marked';
  }
  if (!input.entry) {
    return 'empty';
  }
  if (input.resultTab) {
    return 'result';
  }
  return input.entry.kind === 'directory' ? 'folder' : 'file';
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
          disabled: !x.enabled(),
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
            label: x.label,
            accelerator: shown ? canonicalShortcut(x.shortcut!, platform) : null,
            enabled: !blocked && x.enabled(),
          });
        }
      } else if (typeof d === 'string') {
        out.push({
          kind: 'item',
          id: d,
          label: ACTIONS[d].label,
          accelerator: src.shortcuts(d)[0] ?? null,
          enabled: !blocked && src.state(d) === 'ready',
        });
      } else if ('sub' in d) {
        out.push({ kind: 'submenu', label: d.sub, items: nodes(d.items) });
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
