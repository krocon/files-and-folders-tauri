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
  window: 'Window',
  help: 'Help',
  menuBar: 'Menu bar',
  copyAs: 'Copy to clipboard',
  openWithTool: 'Open with tool',
  contextMenu: 'Context menu',
  marked: (n: number) => `${n} marked ${n === 1 ? 'entry' : 'entries'}`,
  comingIn: (prompt: string) => `Coming in prompt ${prompt}`,
} as const;

export const MENU_TEXTS = translatable('menus', MENU_EN, { de: MENU_DE });
