import type { Translation } from '../../core/i18n/i18n';
import type { THEME_EN } from './theme-texts';

/** Deutsche Texte des Farbschema-Dialogs (design 015). */
export const THEME_DE: Translation<typeof THEME_EN> = {
  heading: 'Farbschemata',
  followSystem: 'System folgen',
  lightScheme: 'System hell',
  darkScheme: 'System dunkel',
  schemes: 'Schemata',
  builtIn: 'eingebaut',
  name: 'Name',
  dark: 'Dunkles Schema',
  more: 'Weitere (dieser Version unbekannt)',
  pickColor: (label) => `${label}: Farbe wählen`,
  valueOf: (label) => `${label}: Wert`,
  invalidValue: 'Kein gültiger Wert – wird nicht angewendet.',
  contrastOk: 'Alle Kontrastprüfungen bestanden (WCAG AA).',
  contrastProblems: (n) =>
    n === 1 ? '1 Kontrastproblem (WCAG AA):' : `${n} Kontrastprobleme (WCAG AA):`,
  ratio: (label, ratio, min) =>
    ratio === null
      ? `${label}: Farbe nicht auflösbar`
      : `${label}: ${(Math.floor(ratio * 10) / 10).toFixed(1).replace('.', ',')}:1 (min. ${String(min).replace('.', ',')}:1)`,
  lowContrast: 'Geringer Kontrast – siehe Liste oben',
  save: 'Speichern',
  saveAs: 'Als neues speichern',
  delete: 'Löschen',
  reset: 'Zurücksetzen',
  import: 'Importieren',
  export: 'Exportieren',
  close: 'Schließen',
  importHelp:
    'Import liest die Datei unter dem Cursor; Export schreibt in den Ordner der aktiven Seite.',
  unsavedFirst: 'Erst die Änderungen speichern oder zurücksetzen.',
  builtInReadOnly: 'Eingebaute Schemata sind schreibgeschützt – „Als neues speichern“ verwenden.',
  saved: (name) => `„${name}“ gespeichert.`,
  deleted: (name) => `„${name}“ gelöscht.`,
  noFile: 'Den Cursor auf eine Schema-Datei (*.json) setzen, um sie zu importieren.',
  noFolder: 'Die aktive Seite zeigt keinen Ordner für den Export.',
  imported: (name, unknown, dropped) =>
    `„${name}“ importiert.` +
    (unknown ? ` ${unknown} Variable(n) kennt diese Version nicht – sie bleiben erhalten.` : '') +
    (dropped ? ` ${dropped} Wert(e) wurden abgelehnt.` : ''),
  notSelected: (n) =>
    `Es ist nicht ausgewählt: ${n === 1 ? '1 Kontrastproblem' : `${n} Kontrastprobleme`} – Werte korrigieren und speichern (Speichern wählt es auch aus).`,
  noPicker: 'Transparent – zum Ersetzen eine Farbe eintippen',
  exported: (path) => `Exportiert nach ${path}`,
  menuLabel: 'Farbschema',
  menuEdit: 'Farbschemata bearbeiten…',
  menuFollow: 'System folgen',
  paletteEntry: (name) => `Farbschema: ${name}`,
};
