import { translatable } from '../../core/i18n/i18n';
import { MrScan, MrSkipReason } from '../../core/mrimport/mr-import.models';
import { MR_IMPORT_DE } from './mr-import-texts.de';
import { MrAreaId } from './mr-import-logic';

/** Texts of design 026 (import of the old configuration). */
export const MR_IMPORT_EN = {
  title: 'Import from Files and Folders (old version)',
  intro:
    'Takes over what you changed in the old version (files-and-folders-mr): shortcuts, buttons, file types, search patterns, tools, colour schemes and two settings.',
  folder: 'Folder of the old installation',
  folderHelp: 'The repository folder, apps/fnf-api/src/assets or its assets folder.',
  search: 'Search',
  searching: 'Searching…',
  found: (root: string) => `Found: ${root}`,
  notFound: (path: string) => `No configuration of the old version was found in ${path}.`,
  areasLegend: 'What to import',
  areaNames: {
    shortcuts: 'Keyboard shortcuts',
    buttons: 'Buttons',
    fileTypes: 'File types',
    search: 'Search patterns',
    tools: 'Tools',
    colors: 'Colour schemes',
    setup: 'Settings',
  } as Readonly<Record<MrAreaId, string>>,
  osNames: { osx: 'macOS', windows: 'Windows', linux: 'Linux' } as Readonly<
    Record<MrScan['os'], string>
  >,
  shortcutsOf: (os: string) => `Keyboard shortcuts (${os})`,
  toImport: (n: number) => `${n} to import`,
  conflicts: (n: number) => (n === 1 ? '1 conflict' : `${n} conflicts`),
  skipped: (n: number) => `${n} not transferred`,
  unchanged: (n: number) => `${n} unchanged`,
  nothingNew: 'nothing new',
  notFoundArea: 'not found',
  details: 'Details',
  conflictsHeading: 'Conflicts',
  skippedHeading: 'Not transferred',
  shortcutConflict: (shortcut: string, from: string, to: string) => `${shortcut}: ${from} → ${to}`,
  replaced: (name: string) => `${name} – your own entry is replaced`,
  copied: (name: string) => `${name} – exists already, added as a copy`,
  changedSetting: (name: string) => `${name} – your own value is replaced`,
  reasons: {
    table_navigation: 'navigation keys belong to the file list now',
    no_equivalent: 'this function no longer exists',
    unknown_action: 'unknown action',
    never_fired: 'never worked in the old version',
    meta_key: 'uses the Windows key',
    unknown_key: 'unknown key',
    removed: 'removed in the old version – stays as it is',
    too_many: 'too many entries',
    old_script: 'uses a script of the old version',
    invalid: 'invalid entry',
    not_applicable: 'not needed – dialogs open in the main window',
    too_big: 'the file is too big',
    broken: 'the file is invalid',
    unreadable: 'the file could not be read',
    invalid_shortcut: 'invalid shortcut',
    reserved: 'reserved shortcut',
  } as Readonly<Record<MrSkipReason, string>>,
  toolsWarning: 'Tools start programs – check them after the import.',
  modeLegend: 'On conflicts',
  merge: 'Merge – the import wins',
  replace: 'Replace my own entries in the chosen areas',
  modeHelp: 'Colour schemes are always added. Tools: replace keeps the terminal setting.',
  backupsNote: 'A backup (.bak) is kept next to every file that changes.',
  importButton: 'Import',
  close: 'Close',
  confirmTitle: 'Import the old configuration?',
  confirmConflicts: (n: number) =>
    `${n === 1 ? '1 existing entry changes' : `${n} existing entries change`} (see “Details”). Backups are kept next to the files.`,
  confirmReplace:
    'Replace: your own entries in the chosen areas are dropped. Backups are kept next to the files.',
  importing: 'Importing…',
  done: (areas: string) => `Imported: ${areas}.`,
  doneNothing: 'Nothing was imported.',
  backups: (n: number) => (n === 1 ? '1 backup made.' : `${n} backups made.`),
  partFailed: (part: string, path: string) => `${part} could not be written (${path}).`,
  partSkipped: (part: string) => `${part} were skipped: the existing file could not be read.`,
  colorFailed: (name: string, reason: string) => `${name}: ${reason}`,
  failed: (reason: string) => `The import failed: ${reason}`,
};

export const MR_IMPORT_TEXTS = translatable('mrImport', MR_IMPORT_EN, { de: MR_IMPORT_DE });
