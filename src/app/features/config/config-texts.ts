import { Platform } from '../../core/actions/platform';
import { ConfigWarning } from '../../core/config/config.models';
import { translatable } from '../../core/i18n/i18n';
import { ModifierSet } from '../workspace/button-bar/button-config';
import { CONFIG_DE } from './config-texts.de';

export type ConfigFileId = 'buttons' | 'fileTypes';

/** Texts of design 022 (button and file type configuration). */
export const CONFIG_EN = {
  what: { buttons: 'button configuration', fileTypes: 'file types' } as Readonly<
    Record<ConfigFileId, string>
  >,
  loadFailed: (what: ConfigFileId, reason: string) =>
    `The ${CONFIG_EN.what[what]} could not be loaded: ${reason}`,
  brokenKept: (file: string, bad: string) =>
    `${file} was invalid; the defaults are used. The old file was kept as ${bad}.`,
  brokenStayed: (file: string) =>
    `${file} was invalid; the defaults are used and changes are not saved in this session.`,
  unreadable: (file: string) =>
    `${file} could not be read; the defaults are used and changes are not saved in this session.`,
  unknownIds: (ids: string) => `buttons.json names unknown actions; they were left out: ${ids}`,
  saveFailed: (reason: string) => `Saving failed: ${reason}`,
  fullscreenFailed: (reason: string) => `Full screen could not be switched: ${reason}`,
  cancel: 'Cancel',
  save: 'Save',
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove',
  add: 'Add',
  // button configuration
  buttonsTitle: 'Button configuration',
  buttonsIntro:
    'The function buttons of the bottom bar, one set per held modifier key. Your changes are kept in buttons.json.',
  setsLabel: 'Modifier sets',
  setName: (set: ModifierSet, platform: Platform) =>
    ({
      default: 'Without modifier',
      shift: 'With Shift',
      ctrl: 'With Ctrl',
      alt: platform === 'macos' ? 'With ⌥ Option' : 'With Alt',
      cmd: 'With ⌘ Command',
    })[set],
  changed: 'changed',
  preview: 'Preview',
  slots: 'Buttons of this set',
  slotsHelp: 'Arrow keys choose, Alt+arrow up/down moves, Delete removes.',
  noSlots: 'No buttons in this set.',
  action: 'Action',
  actionPlaceholder: 'Search an action…',
  noMatch: 'No action found',
  replace: 'Replace',
  problemNone: 'Choose an action first.',
  problemFull: (max: number) => `At most ${max} buttons per set.`,
  problemPresent: 'This action is already in the set.',
  resetSet: 'Reset this set',
  resetAll: 'Reset all sets',
  unknownNotice: (ids: string) => `Unknown actions in buttons.json were left out: ${ids}`,
  // file types
  typesTitle: 'File types',
  typesIntro:
    'Categories of file extensions: icon and colour in the file list and presets for marking by type. The first category wins for an extension. Your changes are kept in filetypes.json.',
  categories: 'Categories',
  categoriesHelp: 'Arrow keys choose, Alt+arrow up/down moves.',
  name: 'Name',
  extensions: 'Extensions',
  extensionsHelp: 'Separated by spaces, commas or lines, e.g. .cbz .cbr',
  icon: 'Icon',
  color: 'Colour',
  noColor: 'None (text colour)',
  newType: 'New type',
  extensionCount: (n: number) => `${n} ${n === 1 ? 'extension' : 'extensions'}`,
  labelMissing: 'The name is missing.',
  labelTooLong: (max: number) => `The name is too long (max. ${max} characters).`,
  labelTaken: 'Another category has this name.',
  tooManyExtensions: (max: number) => `Too many extensions (max. ${max}).`,
  invalidExtensions: (list: string) => `Not an extension: ${list}`,
  fixProblems: 'Correct the marked categories first.',
  resetDefaults: 'Reset to defaults',
  everything: 'Everything',
  builtInLabels: {
    movies: 'Movies',
    audio: 'Audio',
    images: 'Images',
    documents: 'Documents',
    archives: 'Archives',
    code: 'Source code',
    executables: 'Programs',
    fonts: 'Fonts',
    ebooks: 'E-books',
    design: 'Design files',
    '3d': '3D models',
  } as Readonly<Record<string, string>>,
  colorNames: {
    folder: 'Folder',
    document: 'Document',
    image: 'Image',
    video: 'Video',
    audio: 'Music',
    archive: 'Archive',
    code: 'Source code',
    executable: 'Program',
  } as Readonly<Record<string, string>>,
  iconNames: {
    'fa-file-o': 'File',
    'fa-file-text-o': 'Text file',
    'fa-file-video-o': 'Video file',
    'fa-file-audio-o': 'Audio file',
    'fa-file-image-o': 'Image file',
    'fa-file-archive-o': 'Archive file',
    'fa-file-code-o': 'Code file',
    'fa-file-pdf-o': 'PDF file',
    'fa-file-word-o': 'Word file',
    'fa-file-excel-o': 'Spreadsheet',
    'fa-file-powerpoint-o': 'Presentation',
    'fa-cogs': 'Gears',
    'fa-font': 'Font',
    'fa-book': 'Book',
    'fa-paint-brush': 'Brush',
    'fa-cube': 'Cube',
    'fa-database': 'Database',
    'fa-music': 'Note',
    'fa-film': 'Film strip',
    'fa-picture-o': 'Picture',
    'fa-terminal': 'Terminal',
    'fa-envelope-o': 'Envelope',
    'fa-globe': 'Globe',
    'fa-lock': 'Lock',
    'fa-gamepad': 'Gamepad',
    'fa-camera': 'Camera',
    'fa-table': 'Table',
    'fa-key': 'Key',
    'fa-calendar-o': 'Calendar',
    'fa-certificate': 'Certificate',
  } as Readonly<Record<string, string>>,
};

/** The file names (not translated). */
export const CONFIG_FILE_NAMES: Readonly<Record<ConfigFileId, string>> = {
  buttons: 'buttons.json',
  fileTypes: 'filetypes.json',
};

export const CONFIG_TEXTS = translatable('config', CONFIG_EN, { de: CONFIG_DE });

/** A built-in category in the current language; the user's names stay as they are. */
export function fileTypeLabel(label: string): string {
  return CONFIG_TEXTS.builtInLabels[label] ?? label;
}

export function describeConfigWarning(file: ConfigFileId, w: ConfigWarning): string {
  const name = CONFIG_FILE_NAMES[file];
  if (w.code === 'unreadable') {
    return CONFIG_TEXTS.unreadable(name);
  }
  return w.path ? CONFIG_TEXTS.brokenKept(name, w.path) : CONFIG_TEXTS.brokenStayed(name);
}
