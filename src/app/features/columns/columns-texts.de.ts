import type { Translation } from '../../core/i18n/i18n';
import type { COLUMNS_EN } from './columns-texts';

/** Deutsche Texte der Spaltenauswahl und der Ansichtsmodi (Design 041). */
export const COLUMNS_DE: Translation<typeof COLUMNS_EN> = {
  title: 'Spalten',
  help: 'Leertaste blendet eine Spalte ein oder aus, Alt+↑ / Alt+↓ verschiebt sie. Die Auswahl gilt für beide Seiten und alle Tabs; die Breiten gehören zum Tab.',
  listLabel: 'Spalten der Dateiliste',
  always: 'immer sichtbar',
  moveUp: 'Nach oben',
  moveDown: 'Nach unten',
  defaults: 'Standard',
  cancel: 'Abbrechen',
  ok: 'OK',
  shown: (name) => `${name}: eingeblendet`,
  hidden: (name) => `${name}: ausgeblendet`,
  moved: (name, position, count) => `${name}: Position ${position} von ${count}`,
  names: {
    name: 'Name',
    ext: 'Endung',
    size: 'Größe',
    modifiedMs: 'Geändert',
    createdMs: 'Erstellt',
    accessedMs: 'Letzter Zugriff',
    attrs: 'Rechte / Attribute',
    type: 'Typ',
  },
};
