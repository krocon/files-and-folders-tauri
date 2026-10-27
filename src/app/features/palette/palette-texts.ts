import { translatable, Translation } from '../../core/i18n/i18n';

/** Texts of the universal palette (design 043). */
const PALETTE_EN = {
  placeholder: 'Files, folders, actions… (> actions only, ~/ path, ext:pdf, in:, size>, modified:)',
  groupActions: 'Actions',
  groupFolders: 'Folders',
  groupFiles: 'Files',
  groupEntries: 'In this folder',
  more: (n: number) => `${n} more…`,
  goTo: (path: string) => `Go to ${path}`,
  counted: (shown: number, total: number) =>
    total > shown ? `${shown} of ${total.toLocaleString()}` : `${shown}`,
  searching: 'Searching…',
  results: (n: number) => (n === 1 ? '1 hit' : `${n} hits`),
  took: (ms: number) => `${ms} ms`,
  noHits: 'Nothing found',
  marked: (n: number) => (n === 1 ? '1 marked' : `${n} marked`),
  hitActions: 'Actions for the hit',
  hitActionsFor: (name: string) => `Actions for ${name}`,
  hitActionsHint: 'Tab or → shows what you can do with the hit',
  previewTitle: 'Preview',
  previewNone: 'No preview for this entry',
  previewHint: 'F3: preview',
  index: {
    off: 'Index off',
    waiting: 'Index starts soon',
    building: 'Index is being built – searching the folders directly',
    ready: (entries: number) => `Index: ${entries.toLocaleString()} entries`,
    truncated: 'Index is full (memory limit) – the rest is searched directly',
  },
  sources: {
    index: 'Index',
    live: 'Folder',
    system: 'System search',
    path: 'Path',
  } as Readonly<Record<string, string>>,
  noFolder: 'This entry is not in a folder that can be shown',
  oneOnly: 'Only for one hit',
  resultLabel: (text: string) => `Palette: ${text}`,
  similarLabel: (name: string) => `Like ${name}`,
};

const PALETTE_DE: Translation<typeof PALETTE_EN> = {
  placeholder:
    'Dateien, Ordner, Aktionen… (> nur Aktionen, ~/ Pfad, ext:pdf, in:, size>, modified:)',
  groupActions: 'Aktionen',
  groupFolders: 'Ordner',
  groupFiles: 'Dateien',
  groupEntries: 'In diesem Ordner',
  more: (n) => `${n} weitere…`,
  goTo: (path) => `Gehe zu ${path}`,
  counted: (shown, total) =>
    total > shown ? `${shown} von ${total.toLocaleString('de-DE')}` : `${shown}`,
  searching: 'Suche läuft…',
  results: (n) => (n === 1 ? '1 Treffer' : `${n} Treffer`),
  took: (ms) => `${ms} ms`,
  noHits: 'Nichts gefunden',
  marked: (n) => `${n} markiert`,
  hitActions: 'Aktionen für den Treffer',
  hitActionsFor: (name) => `Aktionen für ${name}`,
  hitActionsHint: 'Tab oder → zeigt, was mit dem Treffer geht',
  previewTitle: 'Vorschau',
  previewNone: 'Keine Vorschau für diesen Eintrag',
  previewHint: 'F3: Vorschau',
  index: {
    off: 'Index aus',
    waiting: 'Index startet gleich',
    building: 'Index wird aufgebaut – die Ordner werden direkt durchsucht',
    ready: (entries) => `Index: ${entries.toLocaleString('de-DE')} Einträge`,
    truncated: 'Index ist voll (Speichergrenze) – der Rest wird direkt durchsucht',
  },
  sources: {
    index: 'Namensindex',
    live: 'Ordner',
    system: 'Systemsuche',
    path: 'Pfad',
  },
  noFolder: 'Dieser Eintrag liegt in keinem Ordner, der sich zeigen lässt',
  oneOnly: 'Nur für einen Treffer',
  resultLabel: (text) => `Palette: ${text}`,
  similarLabel: (name) => `Wie ${name}`,
};

export const PALETTE_TEXTS = translatable('palette', PALETTE_EN, { de: PALETTE_DE });
