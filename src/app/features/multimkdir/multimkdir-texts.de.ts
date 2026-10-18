import type { Translation } from '../../core/i18n/i18n';
import type { MM_EN } from './multimkdir-texts';

const folders = (n: number) => (n === 1 ? '1 Ordner' : `${n} Ordner`);

/** Deutsche Texte des Dialogs „Mehrere Ordner anlegen“ (design 015). */
export const MM_DE: Translation<typeof MM_EN> = {
  title: (n) => `Mehrere Ordner anlegen – ${folders(n)}`,
  template: 'Ordnername',
  templateHelp: '[C] Zähler · [L] Buchstabe (a, b, …) · [P] [Q] [R] übergeordnete Ordner',
  start: 'Von',
  end: 'Bis',
  step: 'Schritt',
  digits: 'Stellen',
  letterCase: 'Schreibweise',
  cases: { none: 'unverändert', upper: 'GROSSBUCHSTABEN', lower: 'kleinbuchstaben' },
  preview: 'Vorschau',
  colNr: 'Nr.',
  colName: 'Name',
  colInfo: 'Info',
  ok: 'OK',
  inFolder: 'In',
  cancel: 'Abbrechen',
  create: 'Anlegen',
  noFolder: 'Diese Seite zeigt keinen Ordner',
  notCreated: (list) => `Nicht angelegt: ${list}`,
  created: (n) => `${folders(n)} angelegt`,
  errWhole: 'Start, Ende, Schritt und Stellen müssen ganze Zahlen sein, Schritt > 0',
  errEnd: 'Das Ende ist kleiner als der Start',
  errMax: (max) => `Höchstens ${max} Ordner auf einmal`,
  errToken: 'Die Vorlage braucht [C] oder [L] für mehr als einen Ordner',
  errEmpty: 'leerer Name',
  errTwice: 'doppelt in der Liste',
};
