import { formatCount } from '../../shared/format';
import { translatable } from '../../core/i18n/i18n';
import { TEXTS_DE } from './texts.de';
/**
 * User-facing texts of the window skeleton, kept in one place so that prompt
 * 015 (i18n) can translate them.
 */
export const TEXTS_EN = {
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
  /** Folder watching (design 012 E2). */
  notWatched: (reason: string | null) =>
    reason === 'network' ? 'not auto-refreshed (network drive)' : 'not auto-refreshed',
  slowWatched: 'auto-refresh by polling',
  watchHint: 'Reload with the Reload action (Ctrl+R / ⌘R)',
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
  emptyFolder: 'This folder is empty.',
  noHits: 'No hits (yet).',
  /** Screen-reader prefix of a marked row. */
  marked: 'marked, ',
  lossyName: 'Name contains invalid characters – navigation not supported yet',
  columns: { name: 'Name', ext: 'Ext', size: 'Size', modified: 'Modified', folder: 'Folder' },
  bytesTitle: (marked: number, total: number) =>
    `${formatCount(marked)} / ${formatCount(total)} bytes`,
  status: {
    in: 'in',
    files: (n: number) => `${n} Files`,
    folders: (n: number) => `${n} Folders`,
  },
} as const;

export const TEXTS = translatable('workspace', TEXTS_EN, { de: TEXTS_DE });
