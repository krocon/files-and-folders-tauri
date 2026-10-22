import { formatCount } from '../../shared/format';
import { localeFor, translatable } from '../../core/i18n/i18n';
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
    history: 'History',
  },
  /** Dragging tabs (design 031 E2–E4). */
  tabDrag: {
    label: (copy: boolean, title: string, side: 'left' | 'right', position: number) =>
      `${copy ? 'Copy' : 'Move'} tab ${title} → ${side === 'left' ? 'left' : 'right'}, position ${position}`,
    noTarget: (title: string) => `Tab ${title} – no target here`,
    lastTab: (isMac: boolean) => `The last tab of a side stays – ${isMac ? '⌥' : 'Ctrl'}: copy it`,
    full: 'That side has the most tabs already',
    hint: (isMac: boolean) => `${isMac ? '⌥' : 'Ctrl'}: copy · Esc: cancel`,
  },
  splitter: 'Panel divider (double-click: 50 / 50)',
  dismiss: 'Dismiss',
  sessionLoadFailed: 'The saved session could not be loaded.',
  sessionSaveFailed: 'The session could not be saved:',
  /** Design 027: `folder-memory.json`. */
  folderMemoryBroken: (bad: string | null) =>
    bad
      ? `The folder memory (folder-memory.json) was invalid and was kept as ${bad}; it starts empty.`
      : 'The folder memory (folder-memory.json) was invalid; it starts empty and is not saved in this session.',
  folderMemoryUnreadable:
    'The folder memory (folder-memory.json) could not be read; it is not saved in this session.',
  folderMemorySaveFailed: 'The folder memory could not be saved:',
  folderReplaced: (from: string, to: string) =>
    `Folder no longer exists: ${from} – showing ${to} instead.`,
  comingIn: (prompt: string) => `Coming in prompt ${prompt}`,
  loading: 'Loading…',
  /** Design 029 E4/E5: a folder that is slow to open. */
  slowFolder: 'The folder is slow to respond…',
  cancelLoading: 'Cancel',
  cancelHint: 'Esc',
  openCancelled: 'Opening the folder was cancelled.',
  retry: 'Try again',
  refreshing: 'refreshing…',
  /** Design 030 E3/E4: a listing from the cache, not checked yet. */
  cachedAt: (at: Date) =>
    `as of ${at.toLocaleTimeString(localeFor('en'), { hour: '2-digit', minute: '2-digit' })} · checking…`,
  cachedTitle: (at: Date) =>
    `Shown from memory (${at.toLocaleString(localeFor('en'))}) – the folder is being read again. Deleting, moving and renaming wait until then.`,
  cachedAnnounce: 'Shown from memory, checking the folder.',
  unchecked: 'the folder is still being checked – try again in a moment',
  unreadable: (n: number) => `${n} unreadable`,
  /** Folder watching (design 012 E2). */
  notWatched: (reason: string | null) =>
    reason === 'network' ? 'not auto-refreshed (network drive)' : 'not auto-refreshed',
  slowWatched: 'auto-refresh by polling',
  watchHint: 'Reload with the Reload action (Ctrl+R / ⌘R)',
  calculating: (n: number) =>
    n === 1 ? 'Calculating folder size…' : `Calculating ${n} folder sizes…`,
  hiddenMarked: (n: number) => `+${n} marked but filtered out`,
  removing: 'Being removed…',
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
  columns: {
    name: 'Name',
    ext: 'Ext',
    size: 'Size',
    modified: 'Modified',
    folder: 'Folder',
    path: 'Path',
    group: 'Group',
  },
  bytesTitle: (marked: number, total: number) =>
    `${formatCount(marked)} / ${formatCount(total)} bytes`,
  status: {
    in: 'in',
    files: (n: number) => (n === 1 ? '1 File' : `${n} Files`),
    folders: (n: number) => (n === 1 ? '1 Folder' : `${n} Folders`),
  },
} as const;

export const TEXTS = translatable('workspace', TEXTS_EN, { de: TEXTS_DE });
