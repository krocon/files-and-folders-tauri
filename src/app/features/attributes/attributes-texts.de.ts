import type { Translation } from '../../core/i18n/i18n';
import type { AT_EN } from './attributes-texts';

const entries = (n: number) => (n === 1 ? '1 Eintrag' : `${n} Einträge`);
const entriesDat = (n: number) => (n === 1 ? '1 Eintrag' : `${n} Einträgen`);

/** Deutsche Texte des Dialogs „Attribute ändern“ (Design 024). */
export const AT_DE: Translation<typeof AT_EN> = {
  title: (n, first) =>
    n === 1 ? `Attribute ändern – ${first}` : `Attribute ändern – ${entries(n)}`,
  permissions: 'Rechte',
  who: { owner: 'Eigentümer', group: 'Gruppe', others: 'Andere' },
  what: { read: 'Lesen', write: 'Schreiben', exec: 'Ausführen' },
  bitLabel: (who, what) => `${who}: ${what}`,
  special: { setuid: 'Set-User-ID', setgid: 'Set-Group-ID', sticky: 'Sticky-Bit' },
  specialWarning:
    'Set-User/Group-ID lässt ein Programm mit den Rechten seines Eigentümers bzw. seiner Gruppe laufen – nur setzen, wenn du weißt, wozu.',
  octal: 'Oktal',
  octalHint: '3 Ziffern (rwx) oder 4 (mit Set-ID/Sticky); leer, solange Werte abweichen',
  octalInvalid: '3 oder 4 Ziffern von 0 bis 7 eingeben',
  attributes: 'Attribute',
  flags: { readonly: 'Schreibgeschützt', hidden: 'Versteckt', system: 'System', archive: 'Archiv' },
  times: 'Zeiten',
  time: { modified: 'Geändert', accessed: 'Zugriff', created: 'Erstellt' },
  change: (what) => `Zeit „${what}“ ändern`,
  now: 'Jetzt',
  at: 'Datum und Uhrzeit',
  timeInvalid: 'Gültiges Datum und Uhrzeit eingeben',
  recursive: 'Auch den Inhalt markierter Ordner ändern',
  applyTo: 'Gilt für',
  applyToOptions: { all: 'Dateien und Ordner', files: 'Nur Dateien', dirs: 'Nur Ordner' },
  mixedHint: 'Ein Strich heißt: die Einträge unterscheiden sich – das bleibt, wie es ist.',
  loading: 'Aktuelle Werte werden gelesen …',
  summary: (n, changes, recursive) =>
    `${entries(n)}${recursive ? ' samt Inhalt' : ''} · ${
      changes === 1 ? '1 Änderung' : `${changes} Änderungen`
    }`,
  links: (n) => (n === 1 ? '1 Link bleibt unverändert' : `${n} Links bleiben unverändert`),
  nothing: 'Noch nichts geändert',
  cancel: 'Abbrechen',
  run: 'Ändern',
  failed: (msg) => `Attribute ändern fehlgeschlagen: ${msg}`,
  withErrors: (n) => `Attribute geändert – bei ${entriesDat(n)} ging es nicht (siehe Tasks)`,
  done: (n, skipped) =>
    `Attribute von ${entriesDat(n)} geändert${skipped ? ` (${skipped} Links übersprungen)` : ''}`,
};
