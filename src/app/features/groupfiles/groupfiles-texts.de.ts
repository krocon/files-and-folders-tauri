import type { Translation } from '../../core/i18n/i18n';
import type { GF_EN } from './groupfiles-texts';

const entries = (n: number) => (n === 1 ? '1 Eintrag' : `${n} Einträge`);
const groupsOf = (n: number) => (n === 1 ? '1 Gruppe' : `${n} Gruppen`);

/** Deutsche Texte des Dialogs „Dateien gruppieren“ (design 015). */
export const GF_DE: Translation<typeof GF_EN> = {
  title: (n, groups) => `Dateien gruppieren – ${entries(n)} → ${groupsOf(groups)}`,
  mode: 'Modus',
  modes: {
    runningNumber: 'Laufende Nummer',
    newFolder: 'Neuer Ordner (manuell)',
    minusSeparator: 'Minus als Trenner',
    firstWord: 'Erstes Wort',
    firstLetter: 'Erster Buchstabe',
    firstLetterLower: 'Erster Buchstabe klein',
    firstLetterUpper: 'Erster Buchstabe groß',
    twoLetters: 'Zwei Buchstaben',
    twoLettersLower: 'Zwei Buchstaben klein',
    twoLettersUpper: 'Zwei Buchstaben groß',
  },
  newFolder: 'Neuer Ordner',
  minSize: 'Min. Gruppengröße',
  minSizeNone: 'keine',
  ignoreBrackets: '[ ] und ( ) ignorieren',
  useSourceDir: 'Quellordner als Wurzel',
  root: 'Wurzel',
  noOtherPanel: '(die andere Seite zeigt keinen Ordner)',
  preview: 'Vorschau',
  colNr: 'Nr.',
  colName: 'Quelle',
  colGroup: 'Gruppe',
  colInfo: 'Info',
  infoOk: 'OK',
  infoNone: 'keine Gruppe',
  infoSmall: (min) => `Gruppe kleiner als ${min}`,
  summary: (groups, ok, rest) => `${groupsOf(groups)} · ${ok} zu gruppieren · ${rest} ohne Gruppe`,
  cancel: 'Abbrechen',
  copy: 'Kopieren',
  move: 'Verschieben',
  noFolder: 'Diese Seite zeigt keinen Ordner',
  nothingSelected: 'In diesem Ordner gibt es nichts zu gruppieren',
  failed: (msg) => `Gruppieren fehlgeschlagen: ${msg}`,
  withErrors: (n) => `Gruppieren beendet – ${entries(n)} fehlgeschlagen`,
  done: (n) => `${entries(n)} gruppiert`,
  nameInvalid: 'kein gültiger Ordnername',
  nameChars: 'enthält / \\ : * ? " < > | oder Steuerzeichen',
  nameEnd: 'endet mit Punkt oder Leerzeichen',
  nameLong: 'zu lang',
};
