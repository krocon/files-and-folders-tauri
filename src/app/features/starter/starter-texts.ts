import { translatable } from '../../core/i18n/i18n';
import { StarterKind, StarterProblemCode } from '../../core/starter/starter.models';
import { STARTER_DE } from './starter-texts.de';

/** Texts of the starter menu (design 032). */
export const STARTER_EN = {
  category: 'Starter menu',
  title: 'Change starter menu',
  intro:
    'Your own quick launch menu (Start menu, Alt+S): programs and scripts with parameters, folders to jump to, submenus. Nothing runs through a shell – every parameter word is one argument.',
  entries: 'Entries',
  noEntries: 'No entries yet – add one with the buttons below.',
  listHelp: 'Alt+↑/↓ move, Alt+→/← into / out of the submenu above, Delete removes.',
  kinds: {
    program: 'Program',
    folder: 'Folder',
    submenu: 'Submenu',
    separator: 'Separator',
  } as Readonly<Record<StarterKind, string>>,
  addFolder: 'Folder',
  addSubmenu: 'Submenu',
  addSeparator: 'Separator',
  addCurrentFolder: 'Current folder',
  addCursorFile: 'File under cursor',
  addGroup: 'Add',
  arrangeGroup: 'Arrange',
  moveUp: 'Up',
  moveDown: 'Down',
  indent: 'Into submenu',
  outdent: 'Out of submenu',
  remove: 'Remove',
  details: 'Entry',
  noSelection: 'Choose an entry on the left or add one.',
  label: 'Title',
  program: 'Command (program or script)',
  programHelp:
    'A program name found in PATH (code, notepad.exe) or an absolute path; ~ is your home folder. On macOS also an .app.',
  params: 'Parameters',
  paramsHelp:
    '%P%N file under the cursor (full path) · %N its name · %O name without extension · %E extension · %P / %T folder of the active / other panel · %S all marked entries · %% a percent sign. Quotes group words.',
  workingDir: 'Start folder',
  workingDirHelp: 'Empty = folder of the active panel. %P, %T and ~ are allowed.',
  folder: 'Folder',
  folderHelp: 'Absolute path or ~/… – the active panel goes there.',
  shortcut: 'Shortcut',
  shortcutHelp: 'Optional, keymap notation like Alt+Shift+1 or Mod+Shift+E.',
  shortcutInvalid: 'This is no valid shortcut.',
  shortcutTaken: (owner: string) => `Already used by “${owner}”.`,
  separatorInfo: 'A dividing line between entries.',
  submenuInfo: 'Entries below it with more indentation belong to this submenu.',
  newProgram: 'New program',
  newFolder: 'New folder',
  newSubmenu: 'New submenu',
  problems: {
    label: 'The title is empty.',
    program: 'The command must be a program name or an absolute path, without placeholders.',
    folder: 'The folder must be an absolute path (or start with ~).',
    params_quote: 'A quote in the parameters is not closed.',
    params_files: '%S must be a parameter word of its own.',
    working_dir: 'The start folder must be absolute (or start with %P, %T or ~).',
    too_deep: 'Too many nested submenus.',
    too_long: 'Too many parameters.',
  } as Readonly<Record<StarterProblemCode, string>>,
  problemCount: (n: number) =>
    n === 1 ? '1 entry needs a fix before saving.' : `${n} entries need a fix before saving.`,
  file: (path: string) => `Saved in ${path}`,
  cancel: 'Cancel',
  save: 'Save',
  saveFailed: (reason: string) => `Saving failed: ${reason}`,
  loadFailed: (reason: string) => `The starter menu could not be loaded: ${reason}`,
  invalidEntry: (label: string, problem: string) => `${label}: ${problem}`,
  started: (label: string, n: number) =>
    n === 1 ? `${label} started` : `${label} started ${n} times`,
  noFolder: 'There is no folder in the active panel.',
  tooMany: (max: number) => `At most ${max} entries.`,
};

export const STARTER_TEXTS = translatable('starter', STARTER_EN, { de: STARTER_DE });
