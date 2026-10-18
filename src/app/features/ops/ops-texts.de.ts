import type { Translation } from '../../core/i18n/i18n';
import type { OPS_EN } from './ops-texts';

/** Deutsche Texte der Dateioperationen (design 015). */
export const OPS_DE: Translation<typeof OPS_EN> = {
  copy: 'Kopieren',
  move: 'Verschieben',
  entries: (n) => (n === 1 ? '1 Eintrag' : `${n} Einträge`),
  counting: 'zähle…',
  counted: (files, dirs, size) =>
    `${files} ${files === 1 ? 'Datei' : 'Dateien'}, ${dirs} Ordner, ${size}`,
  unreadable: (n) => ` (${n} nicht lesbar)`,
  to: 'In den Ordner',
  suggestions: 'Vorschläge',
  chooseTarget: 'Ordner wählen…',
  newName: 'Name im Zielordner',
  ifExists: 'Wenn eine Datei existiert',
  conflictDefaults: {
    ask: 'Fragen',
    overwrite: 'Überschreiben',
    skip: 'Überspringen',
    overwriteIfNewer: 'Überschreiben, wenn neuer',
    rename: 'Beide behalten (neuer Name)',
  },
  background: 'Im Hintergrund ausführen (neben anderen Tasks)',
  sameNames: (names) =>
    `Einträge aus verschiedenen Ordnern haben denselben Namen (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''}) – im Zielordner treffen sie aufeinander.`,
  sameNamesOverwrite:
    'Mit „Überschreiben“ ersetzt ein späterer Eintrag einen früheren gleichen Namens ohne Rückfrage.',
  cancel: 'Abbrechen',
  ctrlEnter: 'Strg/⌘+Enter startet · Esc bricht ab',
  targetIsFile: 'Das Ziel ist eine Datei – einen Ordner wählen.',
  sameFolder:
    'Quell- und Zielordner sind gleich – einen anderen Ordner oder einen neuen Namen wählen.',
  sameFolderMulti: 'Quell- und Zielordner sind gleich – einen anderen Ordner wählen.',
  emptyTarget: 'Einen Zielordner eingeben.',
  deleteTitle: 'Löschen',
  deletePermanentTitle: 'Endgültig löschen',
  deleteTrashMessage: (n) =>
    n === 1
      ? '1 Eintrag in den Papierkorb verschieben?'
      : `${n} Einträge in den Papierkorb verschieben?`,
  deletePermanentMessage: (n) =>
    n === 1
      ? '1 Eintrag endgültig löschen? Das lässt sich nicht rückgängig machen.'
      : `${n} Einträge endgültig löschen? Das lässt sich nicht rückgängig machen.`,
  trashHint: 'Sie können es aus dem Papierkorb wiederherstellen.',
  moreEntries: (n) => `… und ${n} weitere`,
  toTrash: 'In den Papierkorb',
  deletePermanent: 'Endgültig löschen',
  dangerTitle: 'Vorsicht',
  danger: (d) =>
    d === 'root'
      ? 'Wurzel eines Laufwerks oder Volumes'
      : d === 'home'
        ? 'Ihr Home-Ordner'
        : 'Systemordner',
  dangerConfirm: 'Ich weiß, was ich tue – diese Pfade einschließen',
  mkdirTitle: 'Ordner anlegen',
  mkdirLabel: 'Ordnername',
  mkdirHelp: 'a/b/c legt verschachtelte Ordner an.',
  mkdirConfirm: 'Anlegen',
  createFileTitle: 'Datei anlegen',
  createFileLabel: 'Dateiname',
  createFileConfirm: 'Anlegen',
  renameTitle: 'Umbenennen',
  renameLabel: 'Neuer Name',
  renameConfirm: 'Umbenennen',
  renameAnyway: 'Trotzdem umbenennen',
  emptyName: 'Einen Namen eingeben.',
  nothingSelected: 'Nichts ausgewählt – Einträge markieren oder den Cursor auf einen setzen.',
  noFolder: 'Diese Seite zeigt keinen Ordner.',
  oneEntry: 'Umbenennen braucht genau einen Eintrag.',
  finishedWithErrors: (title, n) =>
    `${title}: ${n === 1 ? '1 Fehler' : `${n} Fehler`} – Details in Tasks.`,
  failed: (title, message) => `${title} fehlgeschlagen: ${message}`,
  otherPanel: 'Andere Seite',
};
