/** Texts of the menus (design 014; translated in prompt 015). */
export const MENU_TEXTS = {
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
  duplicates: 'Duplicates',
  contextMenu: 'Context menu',
  marked: (n: number) => `${n} marked ${n === 1 ? 'entry' : 'entries'}`,
  comingIn: (prompt: string) => `Coming in prompt ${prompt}`,
} as const;
