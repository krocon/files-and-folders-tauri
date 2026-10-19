import type { Translation } from '../../core/i18n/i18n';
import { formatCount } from '../../shared/format';
import type { DUP_EN } from './duplicates-texts';

/** Deutsche Texte der Duplikatsuche (design 016 E6, 015). */
export const DUP_DE: Translation<typeof DUP_EN> = {
  title: 'Duplikate finden',
  searchIn: 'Suchen in',
  markedFolders: (n) => (n === 1 ? '1 markierter Ordner' : `${n} markierte Ordner`),
  folders: (n) => `${n} Ordner`,
  compare: 'Gleich heißt',
  compareContent: 'gleicher Inhalt (Größe, dann SHA-256)',
  compareSize: 'nur gleiche Größe (schnell, nur ein Hinweis)',
  sameName: 'und gleicher Name',
  minSize: 'Dateien ignorieren, die kleiner sind als',
  hidden: 'Versteckte Einträge',
  excludes: 'Ausschließen',
  maxFiles: 'Max. zu vergleichende Dateien',
  find: 'Suchen',
  cancel: 'Abbrechen',
  invalidNumber: 'Bitte eine Zahl eingeben.',
  tooLarge: (max) => `Höchstens ${formatCount(max)}.`,
  noFolder: 'Es gibt keinen Ordner zum Durchsuchen.',
  header: 'Duplikate',
  summary: (groups, files, redundant) =>
    `${formatCount(groups)} ${groups === 1 ? 'Gruppe' : 'Gruppen'}, ${formatCount(files)} Dateien, ${redundant} überzählig`,
  scanning: (files) => `durchsuche… ${formatCount(files)} Dateien`,
  hashing: (done, total) => `vergleiche Inhalte… ${done} von ${total}`,
  keep: 'Behalten:',
  keepNewest: 'neueste',
  keepOldest: 'älteste',
  keepFirst: 'erste',
  keepTitle:
    'Markiert jede Datei jeder Gruppe außer einer – die markierten mit F8 löschen (Papierkorb)',
  groupColumn: 'Gruppe',
  sizeOnlyHeader: 'nur gleiche Größe – Inhalte nicht verglichen, keine Behalten-Hilfen',
  sizeOnlyDelete:
    'Diese Dateien haben nur dieselbe Größe – ihre Inhalte wurden nicht verglichen, sie können sich durchaus unterscheiden.',
  wholeGroups: (n) =>
    n === 1
      ? 'Jede Datei einer Duplikat-Gruppe ist markiert – keine Kopie davon bliebe übrig.'
      : `Jede Datei von ${n} Duplikat-Gruppen ist markiert – keine Kopie davon bliebe übrig.`,
};
