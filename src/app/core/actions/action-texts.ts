import { translatable, Translation } from '../i18n/i18n';

/** Messages of the action system and the keymap (design 015). */
export const ACTION_EN = {
  defaultKeymap: 'Default keymap',
  shortcutFile: 'Shortcut file',
  invalidShortcut: (source: string, raw: string, id: string) =>
    `${source}: "${raw}" for ${id} is not a valid shortcut.`,
  reservedShortcut: (source: string, raw: string, id: string) =>
    `${source}: "${raw}" for ${id} is reserved and was ignored.`,
  unknownDefault: (id: string) => `Default keymap: unknown action ${id}.`,
  unknownOverride: (id: string) => `Shortcut file: unknown action ${id} was ignored.`,
  conflict: (s: string, owner: string, id: string) =>
    `Shortcut ${s} is used by ${owner} and ${id}; ${owner} keeps it.`,
  chordBlocked: (first: string, s: string) => `Shortcut ${first} blocks the chord ${s}.`,
  extraInvalid: (label: string, shortcut: string) =>
    `${label}: the shortcut "${shortcut}" is not valid.`,
  extraTaken: (label: string, shortcut: string, owner: string) =>
    `${label}: the shortcut ${shortcut} is taken by "${owner}".`,
  comingIn: (label: string, prompt: string) => `${label} – coming in prompt ${prompt}.`,
  failed: (label: string, message: string) => `${label}: ${message}`,
  loadFailed: (message: string) => `The keyboard shortcuts could not be loaded: ${message}`,
  saveFailed: (message: string) => `The keyboard shortcuts could not be saved: ${message}`,
  menuFailed: (message: string) => `Menu: ${message}`,
  jobsUnavailable: (message: string) => `Jobs are not available: ${message}`,
  themesLoadFailed: (message: string) => `The colour schemes could not be loaded: ${message}`,
  themesSaveFailed: (message: string) => `The colour schemes could not be saved: ${message}`,
  cancel: 'Cancel',
};

const ACTION_DE: Translation<typeof ACTION_EN> = {
  defaultKeymap: 'Standard-Kürzel',
  shortcutFile: 'Kürzel-Datei',
  invalidShortcut: (source, raw, id) => `${source}: „${raw}“ für ${id} ist kein gültiges Kürzel.`,
  reservedShortcut: (source, raw, id) =>
    `${source}: „${raw}“ für ${id} ist reserviert und wurde ignoriert.`,
  unknownDefault: (id) => `Standard-Kürzel: unbekannte Aktion ${id}.`,
  unknownOverride: (id) => `Kürzel-Datei: unbekannte Aktion ${id} wurde ignoriert.`,
  conflict: (s, owner, id) =>
    `Kürzel ${s} ist für ${owner} und ${id} vergeben; ${owner} behält es.`,
  chordBlocked: (first, s) => `Kürzel ${first} blockiert die Tastenfolge ${s}.`,
  extraInvalid: (label, shortcut) => `${label}: das Kürzel „${shortcut}“ ist ungültig.`,
  extraTaken: (label, shortcut, owner) => `${label}: das Kürzel ${shortcut} hat schon „${owner}“.`,
  comingIn: (label, prompt) => `${label} – kommt mit Prompt ${prompt}.`,
  failed: (label, message) => `${label}: ${message}`,
  loadFailed: (message) => `Die Tastenkürzel konnten nicht geladen werden: ${message}`,
  saveFailed: (message) => `Die Tastenkürzel konnten nicht gespeichert werden: ${message}`,
  menuFailed: (message) => `Menü: ${message}`,
  jobsUnavailable: (message) => `Tasks sind nicht verfügbar: ${message}`,
  themesLoadFailed: (message) => `Die Farbschemata konnten nicht geladen werden: ${message}`,
  themesSaveFailed: (message) => `Die Farbschemata konnten nicht gespeichert werden: ${message}`,
  cancel: 'Abbrechen',
};

export const ACTION_TEXTS = translatable('actionMessages', ACTION_EN, { de: ACTION_DE });
