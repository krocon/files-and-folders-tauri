import type { Translation } from '../../core/i18n/i18n';
import { formatCount } from '../../shared/format';
import type { IMAGE_OVERVIEW_EN } from './image-overview-texts';

const images = (n: number) => (n === 1 ? '1 Bild' : `${formatCount(n)} Bilder`);

/** Deutsche Texte der Bilder-Übersicht (design 074). */
export const IMAGE_OVERVIEW_DE: Translation<typeof IMAGE_OVERVIEW_EN> = {
  region: 'Bilder-Übersicht',
  gridLabel: (folder) => `Bilder in ${folder}`,
  back: 'Schließen',
  backTitle: 'Zurück zu den Panels (Mod+Umschalt+I oder Esc)',
  tree: 'Ordnerbaum',
  treeTitle: 'Ordnerbaum ein- oder ausblenden',
  treeLabel: 'Ordner',
  treeResize: 'Breite des Ordnerbaums',
  up: 'Übergeordneter Ordner',
  subfolders: 'Unterordner einbeziehen',
  sortLabel: 'Reihenfolge',
  sorts: { name: 'Name', date: 'Datum', size: 'Größe', type: 'Typ' },
  filter: 'Filter',
  filterPlaceholder: 'Name enthält…',
  clearFilter: 'Filter leeren',
  sizeLabel: 'Kachelgröße',
  smaller: 'Kleinere Kacheln (Mod+-)',
  larger: 'Größere Kacheln (Mod+=)',
  count: (shown, total, size) =>
    shown === total ? `${images(total)} (${size})` : `${formatCount(shown)} von ${images(total)}`,
  marked: (n, size) => `${formatCount(n)} markiert (${size})`,
  focused: (name, i, n, marked) =>
    `${name}, ${formatCount(i)} von ${formatCount(n)}${marked ? ', markiert' : ''}`,
  loading: 'Bilder werden gesucht…',
  empty: 'Keine Bilder in diesem Ordner.',
  emptyRecursive: 'Keine Bilder in diesem Ordner oder darunter.',
  emptyFilter: 'Kein Bild passt zum Filter.',
  truncated: (n) => `nur die ersten ${images(n)} – Obergrenze`,
  unreadable: (n) => (n === 1 ? '1 Ordner nicht lesbar' : `${formatCount(n)} Ordner nicht lesbar`),
  failed: (why) => `Der Ordner kann nicht gezeigt werden: ${why}`,
  notLocal: 'Die Bilder-Übersicht gibt es nur für lokale Ordner.',
  notHere: 'In der Bilder-Übersicht nicht verfügbar',
  noPreview: 'keine Vorschau',
  largeLabel: (name) => `Bild ${name}`,
  close: 'Schließen (Esc)',
  modeWindow: 'Im Fenster',
  modeScreen: 'Ganzer Bildschirm',
  toggleMode: 'Fenster oder ganzer Bildschirm (F)',
  fit: 'Einpassen (Z)',
  actual: '100 % (Z)',
  previous: 'Voriges Bild (←)',
  next: 'Nächstes Bild (→)',
  position: (i, n) => `${formatCount(i)} / ${formatCount(n)}`,
  cannotShow: 'Dieses Bild kann nicht angezeigt werden.',
  dimensions: (w, h) => `${formatCount(w)} × ${formatCount(h)}`,
};
