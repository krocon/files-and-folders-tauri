import type { Translation } from '../../core/i18n/i18n';
import type { DIFF_EN } from './diff-texts';

/** Deutsche Texte von „Dateien vergleichen“ (design 037). */
export const DIFF_DE: Translation<typeof DIFF_EN> = {
  title: (left, right) => `Vergleich: ${left} ↔ ${right}`,
  loading: 'Vergleiche …',
  ignoreWhitespace: 'Leerraum ignorieren',
  ignoreCase: 'Groß/klein ignorieren',
  wholeFile: 'Ganze Datei',
  previous: 'Vorheriger',
  next: 'Nächster',
  external: (tool) => `In ${tool} öffnen`,
  close: 'Schließen',
  colLine: 'Nr.',
  identical: 'Die Inhalte sind gleich.',
  identicalWith: 'Die Inhalte sind gleich (mit den gewählten Optionen).',
  changes: (n) => (n === 1 ? '1 Unterschied' : `${n} Unterschiede`),
  position: (i, n) => `Unterschied ${i} von ${n}`,
  skipped: (n) => (n === 1 ? '… 1 gleiche Zeile …' : `… ${n} gleiche Zeilen …`),
  truncated: 'Die Ansicht ist gekürzt – für den Rest das externe Werkzeug nehmen.',
  side: (size, encoding, eol) =>
    [size, encoding, eol ? eol.toUpperCase() : null].filter(Boolean).join(' · '),
  binaryIdentical: 'Die Dateien sind gleich (Byte für Byte).',
  binaryDiffer: (bytes, ranges) =>
    `${bytes === 1 ? '1 Byte unterscheidet sich' : `${bytes} Bytes unterscheiden sich`} in ${ranges === 1 ? '1 Bereich' : `${ranges} Bereichen`}`,
  binarySizes: 'Die Größen unterscheiden sich.',
  firstAt: (offset) => `Erster Unterschied bei Offset ${offset}`,
  needTwo: 'Genau zwei Dateien markieren oder auf jeder Seite den Cursor auf eine Datei setzen',
  noOtherFile: 'Auf der anderen Seite steht der Cursor auf keiner Datei',
  notFiles: 'Nur Dateien lassen sich vergleichen',
  same: 'Das ist dieselbe Datei',
};
