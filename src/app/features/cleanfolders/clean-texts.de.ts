import type { Translation } from '../../core/i18n/i18n';
import type { CL_EN } from './clean-texts';

const entries = (n: number) => (n === 1 ? '1 Eintrag' : `${n} Einträge`);
const dirs = (n: number) => (n === 1 ? '1 Ordner' : `${n} Ordner`);
const files = (n: number) => (n === 1 ? '1 Datei' : `${n} Dateien`);

/** Deutsche Texte des Dialogs „Ordner aufräumen“ (design 015, 077). */
export const CL_DE: Translation<typeof CL_EN> = {
  title: (where) => `Ordner aufräumen – ${where}`,
  folders: (n) => dirs(n),
  foldersIn: (n, where) => `${dirs(n)} in ${where}`,
  profile: 'Profil',
  profiles: {
    empty: 'Nur leere Ordner',
    release: 'Release-Reste',
    custom: 'Eigene',
  },
  profileHelp: {
    empty: 'Ordner, in denen nichts liegt – oder nur .DS_Store, Thumbs.db, desktop.ini.',
    release:
      'Ein Ordner, in dem nur noch Reste eines Releases liegen (.nfo, .sfv, Samples …), geht als Ganzes. Alles andere ist Inhalt und bleibt.',
    custom: 'Eigene Namen und Muster.',
  },
  rules: 'Regeln',
  extras: (names) => `Beiwerk: ${names}`,
  samples: (names) => `Samples: ${names}`,
  junkMax: 'Beiwerk nach Muster bis (MiB)',
  sampleMax: 'Samples bis (MiB)',
  junkDirs: 'Auch Ordner, die nur Beiwerk enthalten, neben Inhalt (Sample/ neben dem Film)',
  emptyDirs: 'Leere Ordner löschen',
  junk: 'Ordner als leer behandeln, die nur enthalten',
  junkField: 'Namen oder Muster von Müll-Dateien wie *.nfo (getrennt durch ;)',
  patterns: 'Dateien löschen, die passen auf',
  patternsField: 'Dateinamen-Muster (* und ?, getrennt durch ;)',
  listLabel: 'Ordner',
  colFolder: 'Ordner',
  colVerdict: 'Urteil',
  colRemoves: 'Löscht',
  colKeeps: 'Bleibt',
  verdict: {
    residue: 'Rückstand',
    partial: 'teilweise',
    keep: 'bleibt',
  },
  counts: (d, f, size) => `${dirs(d)} · ${files(f)} · ${size}`,
  filesSize: (n, size) => `${files(n)} · ${size}`,
  sampleTooLarge: (n, limit) =>
    n === 1 ? `Sample größer als ${limit}` : `${n} Samples größer als ${limit}`,
  tooLarge: (n, limit) =>
    n === 1 ? `1 Beiwerk-Datei größer als ${limit}` : `${n} Beiwerk-Dateien größer als ${limit}`,
  hiddenFiles: (n) => (n === 1 ? '1 versteckte Datei' : `${n} versteckte Dateien`),
  links: (n) => (n === 1 ? '1 Link' : `${n} Links`),
  blocked: (n) => (n === 1 ? '1 Eintrag nicht prüfbar' : `${n} Einträge nicht prüfbar`),
  junkKept: (n) =>
    n === 1 ? '1 Beiwerk-Datei bleibt neben Inhalt' : `${n} Beiwerk-Dateien bleiben neben Inhalt`,
  onlyExtras: (n) => (n === 1 ? 'nur 1 Beiwerk-Datei' : `nur ${n} Beiwerk-Dateien`),
  danger: {
    root: 'ein Laufwerk wird nie gelöscht',
    home: 'der Home-Ordner wird nie gelöscht',
    system: 'ein Systemordner wird nie gelöscht',
  },
  linkedRoot: 'über einen Link erreicht – wird nie als Ganzes gelöscht',
  ownFolder: 'der Ordner des Panels selbst bleibt',
  incomplete: 'nicht vollständig durchsucht',
  empty: 'leer',
  details: (name) => `Details – ${name}`,
  detailsNone: 'Details',
  colWhat: 'Was',
  colEntry: 'Eintrag',
  colInfo: 'Grund',
  goes: 'geht',
  stays: 'bleibt',
  wholeFolder: '(der Ordner selbst)',
  kindDir: 'Ordner',
  kindFile: 'Datei',
  emptyDir: 'leerer Ordner',
  matchesPattern: 'passt auf das Lösch-Muster',
  junkInside: (n, size) =>
    n === 1 ? `mit 1 Beiwerk-Datei (${size})` : `mit ${n} Beiwerk-Dateien (${size})`,
  keepReason: {
    content: 'Inhalt',
    tooLarge: (limit) => `Beiwerk größer als ${limit}`,
    sampleTooLarge: (limit) => `Sample größer als ${limit}`,
    hidden: 'versteckte Datei',
    link: 'Link – wird nie verfolgt',
    unreadable: 'nicht lesbar',
    otherFs: 'anderes Dateisystem',
    special: 'Sonderdatei',
  },
  moreKept: (n) => `… und ${entries(n)} mehr`,
  keysHelp: 'Leertaste wählt den Ordner an oder ab · ↑ ↓ bewegen · Enter räumt auf',
  activeRow: (name, verdict, selected) => `${name}: ${verdict}${selected ? ', angewählt' : ''}`,
  scanning: 'Suche läuft…',
  sum: (roots, d, f, size) =>
    `${roots === 1 ? '1 Ordner wird aufgeräumt' : `${roots} Ordner werden aufgeräumt`} · ${dirs(d)}, ${files(f)} · ${size}`,
  ignoredFiles: (n) =>
    n === 1 ? '1 markierte Datei wird ignoriert' : `${n} markierte Dateien werden ignoriert`,
  unreadable: (n) => (n === 1 ? '1 Ordner nicht lesbar' : `${n} Ordner nicht lesbar`),
  truncated: 'Die Suche hat ihr Limit erreicht – für den Rest einen kleineren Ordner wählen',
  nothing: 'Nichts zu löschen',
  noneSelected: 'Kein Ordner angewählt',
  tryRelease:
    'Die Ordner sind nicht leer. Liegen nur noch Reste wie .nfo-Dateien oder Samples darin, hilft das Profil „Release-Reste“.',
  tryReleaseButton: 'Release-Reste',
  mode: 'Löschen',
  trash: 'in den Papierkorb',
  permanent: 'endgültig',
  cancel: 'Abbrechen',
  delete: 'Aufräumen',
  deletePermanent: 'Endgültig löschen',
  noFolder: 'Diese Seite zeigt keinen Ordner',
  failed: (msg) => `Aufräumen fehlgeschlagen: ${msg}`,
  withErrors: (n) => `Aufräumen beendet – ${entries(n)} nicht entfernt`,
  doneTrash: (n, size) => `${entries(n)} aufgeräumt – ${size} in den Papierkorb gelegt`,
  donePermanent: (n, size) => `${entries(n)} aufgeräumt – ${size} freigegeben`,
};
