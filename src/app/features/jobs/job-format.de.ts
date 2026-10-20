import type { Translation } from '../../core/i18n/i18n';
import type { JOB_EN } from './job-format';

const entries = (n: number) => (n === 1 ? '1 Eintrag' : `${n} Einträge`);

/** Deutsche Texte der Task-Oberfläche (design 015). */
export const JOB_DE: Translation<typeof JOB_EN> = {
  tasks: 'Tasks',
  jobsTitle: 'Tasks',
  noJobs: 'Keine Tasks.',
  pause: 'Pause',
  resume: 'Fortsetzen',
  cancel: 'Abbrechen',
  answer: 'Antworten…',
  clearFinished: 'Fertige entfernen',
  close: 'Schließen',
  errors: (n) => (n === 1 ? '1 Fehler' : `${n} Fehler`),
  moreErrors: (n) => `… und ${n} weitere`,
  conflictTitle: 'Datei existiert bereits',
  conflictIntro: 'Der Zielordner enthält schon eine Datei mit diesem Namen.',
  readOnlyTitle: 'Schreibgeschützt',
  readOnlyIntro: 'Dieser Eintrag ist schreibgeschützt. Trotzdem löschen?',
  entry: 'Eintrag',
  source: 'Neu',
  target: 'Vorhanden',
  overwrite: 'Überschreiben',
  skip: 'Überspringen',
  rename: 'Umbenennen',
  newer: 'Überschreiben, wenn neuer',
  cancelJob: 'Kopieren abbrechen',
  applyToAll: 'Für alle weiteren Konflikte',
  newName: 'Neuer Name',
  later: 'Später',
  diskFullHint: 'Platz schaffen, dann „Fortsetzen“ wählen – oder abbrechen.',
  copyTitle: 'Kopieren',
  copyMessage: (n) => (n === 1 ? '1 Eintrag kopieren nach' : `${n} Einträge kopieren nach`),
  copyConfirm: 'Kopieren',
  nothingToCopy: 'Nichts zu kopieren – Einträge markieren oder den Cursor auf einen setzen.',
  noTarget: 'Die andere Seite zeigt keinen Ordner.',
  quitTitle: 'Tasks laufen noch',
  quitMessage: (n) =>
    n === 1
      ? '1 Task läuft noch. Abbrechen und beenden?'
      : `${n} Tasks laufen noch. Abbrechen und beenden?`,
  quitConfirm: 'Tasks abbrechen und beenden',
  undo: 'Rückgängig',
  undoLabel: (title) => `Rückgängig: ${title}`,
  of: (done, total) => `${done} von ${total}`,
  conflictHint: 'Alt+Buchstabe wählt · Esc:',
  conflictKeys: {
    overwrite: ['Ü', 'b', 'erschreiben'],
    skip: ['Übers', 'p', 'ringen'],
    rename: ['', 'U', 'mbenennen…'],
    newer: ['Überschreiben, wenn ', 'n', 'euer'],
    deleteAnyway: ['Trotzdem ', 'l', 'öschen'],
    cancel: (kind) => [
      `${kind === 'move' ? 'Verschieben' : kind === 'delete' ? 'Löschen' : 'Kopieren'} `,
      'a',
      'bbrechen',
    ],
  },
  summary: (done, skipped, failed) =>
    `${done} erledigt · ${skipped} übersprungen · ${failed} fehlgeschlagen`,
  left: (time) => `noch ${time}`,
  states: {
    queued: 'Wartet',
    planning: 'Vorbereitung',
    running: 'Läuft',
    paused: 'Pausiert',
    waitingForDecision: 'Wartet auf Ihre Antwort',
    done: 'Fertig',
    doneWithErrors: 'Fertig mit Fehlern',
    failed: 'Fehlgeschlagen',
    cancelled: 'Abgebrochen',
  },
  titles: {
    entries,
    folders: (n) => `${n} Ordner`,
    transfer: (kind, what, target, renameTo) =>
      `${what} ${kind === 'copy' ? 'kopieren' : 'verschieben'} → ${target}${renameTo ? ` als ${renameTo}` : ''}`,
    delete: (what, trash) =>
      trash ? `${what} in den Papierkorb verschieben` : `${what} endgültig löschen`,
    rename: (what, undo) => (undo ? `Umbenennen rückgängig: ${what}` : `${what} umbenennen`),
    group: (transfer, what, root) =>
      `Dateien gruppieren: ${what} ${transfer === 'copy' ? 'kopieren' : 'verschieben'} → ${root}`,
    clean: (where, n, trash) =>
      `${where} aufräumen: ${entries(n)} ${trash ? 'in den Papierkorb' : 'endgültig'}`,
    search: (name, where) => `Suche „${name}“ in ${where}`,
    extract: (what, target) => `${what} entpacken → ${target}`,
    entriesOf: (n, archive) => `${n} Einträge aus ${archive}`,
    pack: (what, target, name) => `${what} packen → ${target} / ${name}`,
    link: (what, target, renameTo) =>
      `Verknüpfung zu ${what} → ${target}${renameTo ? ` als ${renameTo}` : ''}`,
    duplicates: (where) => `Duplikate finden in ${where}`,
    count: (what) => `${what} zählen`,
    dirSize: (path) => `Ordnergröße von ${path}`,
    simulate: (n) => `Test-Task (${n} Schritte)`,
    shell: (command, cwd) => `Shell: ${command} (in ${cwd})`,
    attributes: (what, recursive) => `Attribute ändern: ${what}${recursive ? ' samt Inhalt' : ''}`,
  },
};
