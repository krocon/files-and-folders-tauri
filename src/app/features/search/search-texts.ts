import { formatCount } from '../../shared/format';
import { translatable } from '../../core/i18n/i18n';
import { SEARCH_DE } from './search-texts.de';

/** Texts of the search (design 009), in one place for prompt 015 (i18n). */
export const SEARCH_EN = {
  header: (label: string) => `Search: "${label}"`,
  headerTitle: 'Double-click: change the search',
  inRoots: (roots: readonly string[]) =>
    roots.length === 1 ? `in ${roots[0]}` : `in ${roots.length} folders`,
  hits: (n: number) => (n === 1 ? '1 hit' : `${formatCount(n)} hits`),
  searching: 'Searching…',
  scanned: (dirs: number, ms: number) =>
    `${formatCount(dirs)} folders · ${(ms / 1000).toFixed(1)} s`,
  truncated: (n: number) => `stopped at ${formatCount(n)} hits`,
  unreadable: (n: number) => (n === 1 ? '1 folder unreadable' : `${n} folders unreadable`),
  cancelled: 'stopped',
  stop: 'Stop',
  again: 'Search again',
  gotoFile: 'Go to file',
  finished: (hits: number, unreadable: number) =>
    `Search finished: ${hits === 1 ? '1 hit' : `${hits} hits`}` +
    (unreadable > 0 ? `, ${unreadable} unreadable folders` : ''),
  failed: (msg: string) => `Search failed: ${msg}`,
  // find dialog
  title: 'Find files',
  searchIn: 'Search in',
  currentFolder: 'Current folder',
  markedFolders: (n: number) => (n === 1 ? '1 marked folder' : `${n} marked folders`),
  name: 'Name',
  namePlaceholder: '*.mp3;*.flac  (empty = all)',
  mode: 'Pattern',
  modes: { glob: 'Glob', regex: 'Regex', text: 'Text' } as Record<string, string>,
  template: 'Template',
  templateNone: '– template –',
  caseSensitive: 'Match case',
  wholeName: 'Whole name',
  kinds: 'Kinds',
  files: 'Files',
  folders: 'Folders',
  links: 'Links',
  size: 'Size',
  min: 'min',
  max: 'max',
  modified: 'Modified',
  anyTime: 'any time',
  lastDays: 'in the last',
  days: 'days',
  between: 'between',
  and: 'and',
  content: 'Containing text',
  contentPlaceholder: 'text in the file (optional)',
  maxFileSize: 'max. file size (MB)',
  hidden: 'Hidden entries',
  followLinks: 'Follow links',
  depth: 'Max. depth',
  depthPlaceholder: 'all',
  excludes: 'Exclude',
  maxHits: 'Max. hits',
  newTab: 'Open in a new tab',
  saveTemplate: 'Save as template…',
  templateName: 'Template name',
  recent: 'Recent searches',
  find: 'Find',
  cancel: 'Cancel',
  noFolder: 'There is no folder to search in.',
  invalidNumber: 'Please enter a number.',
  tooLarge: (max: number) => `At most ${formatCount(max)}.`,
  noKind: 'Choose at least one kind.',
  // folder finder
  finderTitle: (root: string) => `Find folder – ${root}`,
  filter: 'Filter',
  filterPlaceholder: 'type to filter (fuzzy)',
  folderColumn: 'Folder',
  open: 'Open',
  finderCount: (shown: number, all: number) =>
    shown === all
      ? `${formatCount(all)} folders`
      : `${formatCount(shown)} of ${formatCount(all)} folders`,
  depthAll: '∞',
  own: 'Own',
};

export const SEARCH_TEXTS = translatable('search', SEARCH_EN, { de: SEARCH_DE });
