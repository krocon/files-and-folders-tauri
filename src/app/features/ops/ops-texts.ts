import { Danger } from '../../core/fs/fs.models';
import { translatable } from '../../core/i18n/i18n';
import { OPS_DE } from './ops-texts.de';

/** Texts of the file operations (central for prompt 015). */
export const OPS_EN = {
  copy: 'Copy',
  move: 'Move',
  entries: (n: number) => (n === 1 ? '1 entry' : `${n} entries`),
  counting: 'counting…',
  counted: (files: number, dirs: number, size: string) =>
    `${files} ${files === 1 ? 'file' : 'files'}, ${dirs} ${dirs === 1 ? 'folder' : 'folders'}, ${size}`,
  unreadable: (n: number) => ` (${n} not readable)`,
  to: 'To folder',
  suggestions: 'Suggestions',
  chooseTarget: 'Choose a folder…',
  newName: 'Name in the target folder',
  ifExists: 'If a file exists',
  conflictDefaults: {
    ask: 'Ask',
    overwrite: 'Overwrite',
    skip: 'Skip',
    overwriteIfNewer: 'Overwrite if newer',
    rename: 'Keep both (new name)',
  },
  background: 'Run in the background (next to other tasks)',
  sameNames: (names: readonly string[]) =>
    `Entries from different folders have the same name (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''}) – in the target folder they meet.`,
  sameNamesOverwrite:
    'With “Overwrite” a later entry replaces an earlier one of the same name without asking.',
  cancel: 'Cancel',
  ctrlEnter: 'Ctrl/⌘+Enter starts · Esc cancels',
  targetIsFile: 'The target is a file – choose a folder.',
  sameFolder: 'Source and target folder are the same – choose another folder or a new name.',
  sameFolderMulti: 'Source and target folder are the same – choose another folder.',
  emptyTarget: 'Enter a target folder.',

  deleteTitle: 'Delete',
  deletePermanentTitle: 'Delete permanently',
  deleteTrashMessage: (n: number) =>
    n === 1 ? 'Move 1 entry to the trash?' : `Move ${n} entries to the trash?`,
  deletePermanentMessage: (n: number) =>
    n === 1
      ? 'Delete 1 entry permanently? This cannot be undone.'
      : `Delete ${n} entries permanently? This cannot be undone.`,
  trashHint: 'You can restore it from the trash.',
  moreEntries: (n: number) => `… and ${n} more`,
  toTrash: 'Move to trash',
  deletePermanent: 'Delete permanently',

  dangerTitle: 'Caution',
  danger: (d: Danger) =>
    d === 'root' ? 'drive or volume root' : d === 'home' ? 'your home folder' : 'system folder',
  dangerConfirm: 'I know what I am doing – include these paths',

  mkdirTitle: 'Create folder',
  mkdirLabel: 'Folder name',
  mkdirHelp: 'a/b/c creates nested folders.',
  mkdirConfirm: 'Create',
  createFileTitle: 'Create file',
  createFileLabel: 'File name',
  createFileConfirm: 'Create',
  renameTitle: 'Rename',
  renameLabel: 'New name',
  renameConfirm: 'Rename',
  renameAnyway: 'Rename anyway',
  emptyName: 'Enter a name.',

  nothingSelected: 'Nothing selected – mark entries or put the cursor on one.',
  noFolder: 'This panel shows no folder.',
  oneEntry: 'Renaming needs exactly one entry.',
  finishedWithErrors: (title: string, n: number) =>
    `${title}: ${n === 1 ? '1 error' : `${n} errors`} – details in Tasks.`,
  failed: (title: string, message: string) => `${title} failed: ${message}`,
  otherPanel: 'Other panel',
  thisPanel: 'This panel',
  tabGroup: 'Tab',
  favouriteGroup: 'Favourite',
  recentGroup: 'Recent',
} as const;

export const OPS_TEXTS = translatable('ops', OPS_EN, { de: OPS_DE });
