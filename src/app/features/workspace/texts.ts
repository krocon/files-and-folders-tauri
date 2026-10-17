/**
 * User-facing texts of the window skeleton, kept in one place so that prompt
 * 015 (i18n) can translate them.
 */
export const TEXTS = {
  sideName: (side: 'left' | 'right') => (side === 'left' ? 'Left panel' : 'Right panel'),
  pathLabel: (side: 'left' | 'right') =>
    side === 'left' ? 'Path, left panel' : 'Path, right panel',
  tabsLabel: (side: 'left' | 'right') =>
    side === 'left' ? 'Tabs, left panel' : 'Tabs, right panel',
  homeFolder: 'home folder',
  homeTitle: 'Home',
  favoriteAdd: 'Add to favourites',
  favoriteRemove: 'Remove from favourites',
  newTab: 'Clone tab',
  closeTab: 'Close tab',
  tabMenu: {
    reload: 'Reload',
    close: 'Close tab',
    moveToOther: (side: 'left' | 'right') =>
      side === 'left' ? 'Move tab to right panel' : 'Move tab to left panel',
    cloneToOther: (side: 'left' | 'right') =>
      side === 'left' ? 'Clone tab for right panel' : 'Clone tab for left panel',
    moveLeft: 'Move tab to the left',
    moveRight: 'Move tab to the right',
  },
  splitter: 'Panel divider (double-click: 50 / 50)',
  dismiss: 'Dismiss',
  sessionLoadFailed: 'The saved session could not be loaded.',
  sessionSaveFailed: 'The session could not be saved:',
  folderReplaced: (from: string, to: string) =>
    `Folder no longer exists: ${from} – showing ${to} instead.`,
  comingIn: (prompt: string) => `Coming in prompt ${prompt}`,
  loading: 'Loading…',
  unreadable: (n: number) => `${n} unreadable`,
  calculating: (n: number) =>
    n === 1 ? 'Calculating folder size…' : `Calculating ${n} folder sizes…`,
  hiddenMarked: (n: number) => `+${n} marked but filtered out`,
  runProgramTitle: 'Run program?',
  runProgramMessage: 'This file is a program. Run it only if you trust it.',
  runProgramConfirm: 'Run',
  pathInput: 'Go to path',
  folderMenu: 'Folders: home, drives, favourites, recent',
  showHidden: 'Show hidden files',
  filter: 'Filter',
  filterPlaceholder: '*.txt -draft',
  menuHome: 'Home',
  menuFavorites: 'Favourites',
  menuRecent: 'Recent',
  menuEmpty: '(none)',
} as const;
