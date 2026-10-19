import type { Translation } from '../../core/i18n/i18n';
import type { MENU_EN } from './menu-texts';

/** Deutsche Texte der Menüs (design 015). */
export const MENU_DE: Translation<typeof MENU_EN> = {
  appName: 'Files and Folders',
  file: 'Datei',
  edit: 'Bearbeiten',
  view: 'Ansicht',
  go: 'Gehe zu',
  tools: 'Werkzeuge',
  window: 'Fenster',
  help: 'Hilfe',
  duplicates: 'Duplikate',
  menuBar: 'Menüleiste',

  copyAs: 'In die Zwischenablage',
  openWithTool: 'Mit Tool öffnen',
  contextMenu: 'Kontextmenü',
  marked: (n) => `${n} ${n === 1 ? 'markierter Eintrag' : 'markierte Einträge'}`,
  comingIn: (prompt) => `Kommt mit Prompt ${prompt}`,
};
