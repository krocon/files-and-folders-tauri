import type { Translation } from '../../core/i18n/i18n';
import { formatCount } from '../../shared/format';
import type { FLAT_EN } from './flat-texts';

const entries = (n: number) => (n === 1 ? '1 Eintrag' : `${formatCount(n)} Einträge`);

/** Deutsche Texte der flachen Ansicht (design 038). */
export const FLAT_DE: Translation<typeof FLAT_EN> = {
  header: (root) => `Flache Ansicht: ${root}`,
  headerTitle: 'Alle Dateien unterhalb dieses Ordners – Mod+B: zurück zur normalen Ansicht',
  tabTitle: (path) => `Flache Ansicht: ${path}`,
  entries,
  listing: 'Wird aufgelistet…',
  refreshing: 'Wird aktualisiert…',
  truncated: (n) => `Obergrenze von ${formatCount(n)} erreicht – Liste unvollständig`,
  cancelled: 'angehalten – Liste unvollständig',
  showDirs: 'Ordner zeigen',
  normalView: 'Normale Ansicht',
  finished: (n) => `Flache Ansicht: ${entries(n)}`,
  finishedTruncated: (n) => `Flache Ansicht: ${entries(n)} – Liste unvollständig (Obergrenze)`,
  pathColumn: 'Pfad',
  notHere: 'Die flache Ansicht braucht einen lokalen Ordner',
};
