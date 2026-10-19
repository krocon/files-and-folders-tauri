import type { Translation } from '../../core/i18n/i18n';
import type { CL_EN } from './clean-texts';

const entries = (n: number) => (n === 1 ? '1 Eintrag' : `${n} Einträge`);

/** Deutsche Texte des Dialogs „Ordner aufräumen“ (design 015). */
export const CL_DE: Translation<typeof CL_EN> = {
  title: (where) => `Ordner aufräumen – ${where}`,
  folders: (n) => `${n} Ordner`,
  startFolders: 'Startordner',
  emptyDirs: 'Leere Ordner löschen',
  includeRoots: 'Auch den Startordner selbst',
  junk: 'Ordner als leer behandeln, die nur enthalten',
  junkField: 'Namen von Müll-Dateien (getrennt durch ;)',
  patterns: 'Dateien löschen, die passen auf',
  patternsField: 'Dateinamen-Muster (* und ?, getrennt durch ;)',
  preview: 'Wird gelöscht (Inhalt zuerst)',
  colNr: 'Nr.',
  colKind: 'Art',
  colPath: 'Pfad',
  colInfo: 'Info',
  kindDir: 'Ordner',
  kindFile: 'Datei',
  junkInside: (n) => (n === 1 ? 'mit 1 Müll-Datei' : `mit ${n} Müll-Dateien`),
  scanning: 'Suche läuft…',
  summary: (dirs, files) =>
    `${dirs === 1 ? '1 Ordner' : `${dirs} Ordner`} · ${files === 1 ? '1 Datei' : `${files} Dateien`}`,
  unreadable: (n) => (n === 1 ? '1 Ordner nicht lesbar' : `${n} Ordner nicht lesbar`),
  truncated: 'Die Suche hat ihr Limit erreicht – für den Rest einen kleineren Ordner wählen',
  nothing: 'Nichts zu löschen',
  mode: 'Löschen',
  trash: 'in den Papierkorb',
  permanent: 'endgültig',
  cancel: 'Abbrechen',
  delete: 'Löschen',
  deletePermanent: 'Endgültig löschen',
  noFolder: 'Diese Seite zeigt keinen Ordner',
  failed: (msg) => `Aufräumen fehlgeschlagen: ${msg}`,
  withErrors: (n) => `Aufräumen beendet – ${entries(n)} nicht entfernt`,
  done: (n) => `${entries(n)} aufgeräumt`,
};
