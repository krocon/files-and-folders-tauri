import type { Translation } from '../../core/i18n/i18n';
import { formatCount } from '../../shared/format';
import type { USAGE_EN } from './disk-usage-texts';

/** Deutsche Texte der Speicherbelegung (design 033). */
export const USAGE_DE: Translation<typeof USAGE_EN> = {
  header: 'Speicherbelegung',
  tabLabel: (name) => `Belegung: ${name}`,
  selection: 'Auswahl',
  headerTitle: 'Speicherbelegung – Enter öffnet einen Ordner, Backspace geht zurück, F8 entfernt',
  objects: (n) => (n === 1 ? '1 Objekt' : `${formatCount(n)} Objekte`),
  scanning: (entries, size) => `scanne… ${formatCount(entries)} Einträge, ${size}`,
  scanned: (entries, seconds) => `${formatCount(entries)} Einträge in ${seconds} s`,
  asOf: (time) => `Stand ${time}`,
  incomplete: 'unvollständig (angehalten)',
  unreadable: (n) => `${formatCount(n)} nicht lesbar`,
  simplified: 'vereinfacht (sehr viele Einträge)',
  stop: 'Stopp',
  rescan: 'Neu scannen',
  rescanTitle: 'Scannt den gezeigten Ordner neu (Strg/⌘+R)',
  everything: 'Alles',
  largest: 'Größte Dateien',
  smallFiles: (n) => (n === 1 ? '1 kleinere Datei' : `${formatCount(n)} kleinere Dateien`),
  rest: (n) => (n === 1 ? '1 kleinerer Eintrag' : `${formatCount(n)} kleinere Einträge`),
  shareColumn: 'Anteil',
  itemsColumn: 'Objekte',
  chartLabel: 'Diagramm',
  sunburst: 'Ringe',
  treemap: 'Kacheln',
  chartAria: (name, parts) => `Speicherbelegung von ${name}: ${parts}`,
  up: 'Eine Ebene hinauf',
  tipSize: (allocated, logical) => `${allocated} belegt · ${logical} Größe`,
  tipShare: (pct) => `${pct} des gezeigten Ordners`,
  tipObjects: (files, dirs) => `${formatCount(files)} Dateien, ${formatCount(dirs)} Ordner`,
  mountNote: 'anderes Laufwerk – nicht gescannt',
  unreadableNote: 'nicht lesbar',
  basketTitle: 'Zum Entfernen markiert',
  basketEmpty:
    'Einträge mit Leertaste oder Einfg markieren – über alle Ordner hinweg –, um sie hier zu sammeln.',
  basketSum: (n, size) => `${n === 1 ? '1 Eintrag' : `${formatCount(n)} Einträge`} · ${size}`,
  remove: 'Entfernen…',
  removeTitle:
    'Verschiebt die markierten Einträge in den Papierkorb (F8; Umschalt+F8 löscht endgültig)',
  clear: 'Alle abwählen',
  unmark: (name) => `${name} abwählen`,
  inMarkedFolder: 'in einem markierten Ordner',
  volumeUsed: 'gescannt',
  volumeUncounted: 'nicht erfasst',
  volumeFree: 'frei',
  volumeTitle: (scanned, uncounted, free, total) =>
    `${scanned} gescannt · ${uncounted} nicht erfasst (kein Zugriff, Snapshots, System) · ${free} frei von ${total}`,
  noFolder: 'Ordner markieren oder den Cursor auf einen Ordner setzen.',
  filesIgnored: 'Markierte Dateien bleiben außen vor – nur Ordner werden gescannt.',
  notInArchive: 'Die Speicherbelegung arbeitet mit echten Ordnern, nicht in einem Archiv.',
  notInResult: 'Nicht in einem Ergebnis-Tab – zuerst einen Ordner öffnen.',
  notHere: 'Nicht in der Speicherbelegung.',
  network: 'Netzlaufwerk – der Scan kann eine Weile dauern.',
  tooManyTabs: 'Zu viele Tabs – bitte zuerst einen schließen.',
  mountNotScanned:
    'Das ist ein anderes Laufwerk – es wurde nicht gescannt. Bitte für sich scannen.',
  unreadableFolder: 'Dieser Ordner konnte nicht gelesen werden.',
  scanAge: (minutes) =>
    minutes < 1
      ? 'Der Scan ist weniger als eine Minute alt.'
      : `Der Scan ist ${formatCount(minutes)} ${minutes === 1 ? 'Minute' : 'Minuten'} alt – Ordner können sich seitdem geändert haben.`,
  cancelled: 'Der Scan wurde vor dem Start angehalten.',
};
