import buttonSets from './buttons.json';

/**
 * Function buttons of the button bar (row 6 of `docs/ui-layout.md`).
 * `buttons.json` holds one set per held modifier (format of files-and-folders-mr,
 * plus `ctrl` for Windows/Linux); prompt 002 switches between them and binds
 * the actions. Until an action exists, its button is dimmed with a hint.
 */
export type ModifierSet = 'default' | 'shift' | 'cmd' | 'ctrl' | 'alt';

export interface ButtonMeta {
  readonly label: string;
  /** Badge text (without held modifiers, prompt 002 computes it from the keymap). */
  readonly key: string;
  /** Prompt that implements the action – shown as hint while it is missing. */
  readonly prompt: string;
}

export const BUTTON_META: Readonly<Record<string, ButtonMeta>> = {
  OPEN_EDIT_DLG: { label: 'Edit', key: 'F4', prompt: '011' },
  OPEN_VIEW_DLG: { label: 'View', key: 'F3', prompt: '010' },
  OPEN_CREATE_FILE_DLG: { label: 'Create File', key: 'F4', prompt: '006' },
  OPEN_COPY_DLG: { label: 'Copy', key: 'F5', prompt: '006' },
  OPEN_MOVE_DLG: { label: 'Move', key: 'F6', prompt: '006' },
  OPEN_RENAME_DLG: { label: 'Rename', key: 'F6', prompt: '006' },
  OPEN_MULTIRENAME_DLG: { label: 'Multi Rename', key: 'F6', prompt: '007' },
  OPEN_MKDIR_DLG: { label: 'MkDir', key: 'F7', prompt: '006' },
  OPEN_DELETE_DLG: { label: 'Delete', key: 'F8', prompt: '006' },
};

export const BUTTON_SETS: Readonly<Record<ModifierSet, readonly string[]>> = buttonSets;

export interface FunctionButton extends ButtonMeta {
  readonly id: string;
}

export function buttonsFor(set: ModifierSet): FunctionButton[] {
  return BUTTON_SETS[set].map((id) => ({ id, ...(BUTTON_META[id] ?? fallback(id)) }));
}

function fallback(id: string): ButtonMeta {
  return { label: id, key: '', prompt: '002' };
}
