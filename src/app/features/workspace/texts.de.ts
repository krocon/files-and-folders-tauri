import { localeFor, type Translation } from '../../core/i18n/i18n';
import { formatCount } from '../../shared/format';
import type { TEXTS_EN } from './texts';

/** Deutsche Texte des Fenstergerüsts (design 015). */
export const TEXTS_DE: Translation<typeof TEXTS_EN> = {
  sideName: (side) => (side === 'left' ? 'Linke Seite' : 'Rechte Seite'),
  pathLabel: (side) => (side === 'left' ? 'Pfad, linke Seite' : 'Pfad, rechte Seite'),
  tabsLabel: (side) => (side === 'left' ? 'Tabs, linke Seite' : 'Tabs, rechte Seite'),
  homeFolder: 'Home-Ordner',
  homeTitle: 'Home',
  favoriteAdd: 'Zu Favoriten hinzufügen',
  favoriteRemove: 'Aus Favoriten entfernen',
  newTab: 'Tab klonen',
  closeTab: 'Tab schließen',
  tabMenu: {
    reload: 'Neu laden',
    close: 'Tab schließen',
    moveToOther: (side) =>
      side === 'left'
        ? 'Tab auf die rechte Seite verschieben'
        : 'Tab auf die linke Seite verschieben',
    cloneToOther: (side) =>
      side === 'left' ? 'Tab für die rechte Seite klonen' : 'Tab für die linke Seite klonen',
    moveLeft: 'Tab nach links verschieben',
    history: 'Verlauf',
    moveRight: 'Tab nach rechts verschieben',
  },
  tabDrag: {
    label: (copy, title, side, position) =>
      `Tab ${title} ${copy ? 'kopieren' : 'verschieben'} → ${side === 'left' ? 'links' : 'rechts'}, Position ${position}`,
    noTarget: (title) => `Tab ${title} – hier kein Ziel`,
    lastTab: (isMac) => `Der letzte Tab einer Seite bleibt – ${isMac ? '⌥' : 'Strg'}: kopieren`,
    full: 'Diese Seite hat schon die meisten Tabs',
    hint: (isMac) => `${isMac ? '⌥' : 'Strg'}: kopieren · Esc: abbrechen`,
  },
  splitter: 'Trenner der Seiten (Doppelklick: 50 / 50)',
  dismiss: 'Schließen',
  sessionLoadFailed: 'Die gespeicherte Sitzung konnte nicht geladen werden.',
  sessionSaveFailed: 'Die Sitzung konnte nicht gespeichert werden:',
  folderReplaced: (from, to) => `Ordner existiert nicht mehr: ${from} – stattdessen ${to}.`,
  comingIn: (prompt) => `Kommt mit Prompt ${prompt}`,
  loading: 'Lade…',
  slowFolder: 'Der Ordner antwortet langsam …',
  cancelLoading: 'Abbrechen',
  cancelHint: 'Esc',
  openCancelled: 'Öffnen des Ordners abgebrochen.',
  retry: 'Erneut versuchen',
  refreshing: 'wird aktualisiert …',
  cachedAt: (at) =>
    `Stand ${at.toLocaleTimeString(localeFor('de'), { hour: '2-digit', minute: '2-digit' })} · wird geprüft …`,
  cachedTitle: (at) =>
    `Aus dem Speicher angezeigt (${at.toLocaleString(localeFor('de'))}) – der Ordner wird neu gelesen. Löschen, Verschieben und Umbenennen warten so lange.`,
  cachedAnnounce: 'Aus dem Speicher angezeigt, der Ordner wird geprüft.',
  unchecked: 'der Ordner wird noch geprüft – gleich noch einmal versuchen',
  unreadable: (n) => `${n} nicht lesbar`,
  notWatched: (reason) =>
    reason === 'network'
      ? 'keine automatische Aktualisierung (Netzlaufwerk)'
      : 'keine automatische Aktualisierung',
  slowWatched: 'automatische Aktualisierung per Polling',
  watchHint: 'Mit der Aktion „Neu laden“ aktualisieren (Strg+R / ⌘R)',
  calculating: (n) => (n === 1 ? 'Berechne Ordnergröße…' : `Berechne ${n} Ordnergrößen…`),
  hiddenMarked: (n) => `+${n} markiert, aber ausgefiltert`,
  runProgramTitle: 'Programm ausführen?',
  runProgramMessage: 'Diese Datei ist ein Programm. Nur ausführen, wenn Sie ihm vertrauen.',
  runProgramConfirm: 'Ausführen',
  pathInput: 'Gehe zu Pfad',
  folderMenu: 'Ordner: Home, Laufwerke, Favoriten, zuletzt',
  showHidden: 'Versteckte Dateien zeigen',
  filter: 'Filter',
  filterPlaceholder: '*.txt -entwurf',
  menuHome: 'Home',
  menuFavorites: 'Favoriten',
  menuRecent: 'Zuletzt',
  menuEmpty: '(keine)',
  emptyFolder: 'Dieser Ordner ist leer.',
  noHits: 'Keine Treffer (bisher).',
  marked: 'markiert, ',
  lossyName: 'Name enthält ungültige Zeichen – Navigation noch nicht unterstützt',
  columns: {
    name: 'Name',
    ext: 'Endung',
    size: 'Größe',
    modified: 'Geändert',
    folder: 'Ordner',
    group: 'Gruppe',
  },
  bytesTitle: (marked, total) => `${formatCount(marked)} / ${formatCount(total)} Bytes`,
  status: {
    in: 'in',
    files: (n) => (n === 1 ? '1 Datei' : `${n} Dateien`),
    folders: (n) => (n === 1 ? '1 Ordner' : `${n} Ordnern`),
  },
};
