import type { Translation } from '../../core/i18n/i18n';
import type { CS_EN } from './checksum-texts';

const files = (n: number) => (n === 1 ? '1 Datei' : `${n} Dateien`);

/** Deutsche Texte der Prüfsummen (design 039). */
export const CS_DE: Translation<typeof CS_EN> = {
  title: (n) => `Prüfsummen erzeugen – ${n === 1 ? '1 Eintrag' : `${n} Einträge`}`,
  algo: 'Verfahren',
  output: 'Schreiben',
  outputList: 'Eine Prüfsummendatei für alle',
  outputPerFile: 'Eine Prüfsummendatei neben jeder Datei',
  name: 'Dateiname',
  inFolder: 'In',
  exists: 'Die Datei existiert – ersetzen',
  perFileHelp: 'Vorhandene Prüfsummendateien bleiben erhalten.',
  foldersHelp: 'Ordner werden mit allen Dateien darin erfasst; Verknüpfungen werden übersprungen.',
  cancel: 'Abbrechen',
  create: 'Erzeugen',
  close: 'Schließen',
  noFolder: 'Diese Seite zeigt keinen Ordner',
  nothingSelected: 'Nichts ausgewählt',
  noFile: 'Der Cursor steht nicht auf einer Datei',
  noChecksumFile:
    'Der Cursor steht nicht auf einer Prüfsummendatei (.md5, .sha1, .sha256, .sha512, *SUMS)',
  written: (n, file) => `Prüfsummen von ${files(n)} geschrieben in ${file}`,
  writtenPerFile: (n, skipped) =>
    `${n === 1 ? '1 Prüfsummendatei' : `${n} Prüfsummendateien`} geschrieben` +
    (skipped > 0 ? `, ${skipped} behalten` : ''),
  copied: (algo, name) => `${algo} von ${name} kopiert`,
  failed: (reason) => `Prüfsummen fehlgeschlagen: ${reason}`,
  resultTitle: (name) => `Prüfsummen von ${name}`,
  resultOk: (n) => `${files(n)} OK`,
  resultAllOk: (n) => (n === 1 ? 'Die Datei ist OK.' : `Alle ${n} Dateien sind OK.`),
  resultProblems: (n) => (n === 1 ? '1 Problem' : `${n} Probleme`),
  moreProblems: (n) => `… und ${n} weitere (nicht aufgeführt)`,
  colName: 'Name',
  colStatus: 'Ergebnis',
  status: {
    mismatch: 'geändert',
    missing: 'fehlt',
    unreadable: 'nicht lesbar',
    invalid: 'keine Prüfsummenzeile',
    refused: 'außerhalb des Ordners – nicht gelesen',
  },
  markChanged: 'Geänderte Dateien markieren',
  marked: (n) => `${files(n)} markiert`,
  cancelled: 'Prüfen der Prüfsummen abgebrochen',
};
