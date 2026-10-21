import { translatable } from '../../core/i18n/i18n';
import { MENU_DE } from './menu-texts.de';
/** Texts of the menus (design 014; translated in prompt 015). */
export const MENU_EN = {
  appName: 'Files and Folders',
  file: 'File',
  edit: 'Edit',
  view: 'View',
  go: 'Go',
  tools: 'Tools',
  start: 'Start',
  window: 'Window',
  help: 'Help',
  menuBar: 'Menu bar',
  copyAs: 'Copy to clipboard',
  openWithTool: 'Open with tool',
  duplicates: 'Duplicates',
  contextMenu: 'Context menu',
  starterMenu: 'Starter menu',
  starterEmpty: 'No entries yet',
  marked: (n: number) => `${n} marked ${n === 1 ? 'entry' : 'entries'}`,
  comingIn: (prompt: string) => `Coming in prompt ${prompt}`,
} as const;

export const MENU_TEXTS = translatable('menus', MENU_EN, { de: MENU_DE });
