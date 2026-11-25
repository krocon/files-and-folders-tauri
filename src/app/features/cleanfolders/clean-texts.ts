import { translatable } from '../../core/i18n/i18n';
import { CL_DE } from './clean-texts.de';

const dirs = (n: number) => (n === 1 ? '1 folder' : `${n} folders`);
const files = (n: number) => (n === 1 ? '1 file' : `${n} files`);
const entries = (n: number) => (n === 1 ? '1 entry' : `${n} entries`);

/** Texts of the clean-folders dialog (design 008, 077; central for prompt 015). */
export const CL_EN = {
  title: (where: string) => `Clean folders – ${where}`,
  folders: (n: number) => dirs(n),
  foldersIn: (n: number, where: string) => `${dirs(n)} in ${where}`,
  profile: 'Profile',
  profiles: {
    empty: 'Only empty folders',
    release: 'Release leftovers',
    custom: 'Custom',
  },
  profileHelp: {
    empty: 'Folders that hold nothing – or only .DS_Store, Thumbs.db, desktop.ini.',
    release:
      'A folder that holds nothing but leftovers of a release (.nfo, .sfv, samples …) goes as a whole. Everything else is content and stays.',
    custom: 'Your own names and patterns.',
  },
  rules: 'Rules',
  extras: (names: string) => `Extras: ${names}`,
  samples: (names: string) => `Samples: ${names}`,
  junkMax: 'Extras by pattern up to (MiB)',
  sampleMax: 'Samples up to (MiB)',
  junkDirs: 'Also folders that hold only extras next to content (Sample/ beside the film)',
  emptyDirs: 'Delete empty folders',
  junk: 'Treat folders as empty that only contain',
  junkField: 'Junk file names or patterns such as *.nfo (separated by ;)',
  patterns: 'Delete files matching',
  patternsField: 'File name patterns (* and ?, separated by ;)',
  listLabel: 'Folders',
  colFolder: 'Folder',
  colVerdict: 'Verdict',
  colRemoves: 'Deletes',
  colKeeps: 'Stays',
  verdict: {
    residue: 'leftover',
    partial: 'partly',
    keep: 'stays',
  },
  counts: (d: number, f: number, size: string) => `${dirs(d)} · ${files(f)} · ${size}`,
  filesSize: (n: number, size: string) => `${files(n)} · ${size}`,
  sampleTooLarge: (n: number, limit: string) =>
    n === 1 ? `sample larger than ${limit}` : `${n} samples larger than ${limit}`,
  tooLarge: (n: number, limit: string) =>
    n === 1 ? `1 extra larger than ${limit}` : `${n} extras larger than ${limit}`,
  hiddenFiles: (n: number) => (n === 1 ? '1 hidden file' : `${n} hidden files`),
  links: (n: number) => (n === 1 ? '1 link' : `${n} links`),
  blocked: (n: number) =>
    n === 1 ? '1 entry that cannot be checked' : `${n} entries that cannot be checked`,
  junkKept: (n: number) =>
    n === 1 ? '1 extra stays next to content' : `${n} extras stay next to content`,
  onlyExtras: (n: number) => (n === 1 ? 'only 1 extra' : `only ${n} extras`),
  danger: {
    root: 'a drive or volume root is never deleted',
    home: 'your home folder is never deleted',
    system: 'a system folder is never deleted',
  },
  linkedRoot: 'reached through a link – never deleted as a whole',
  ownFolder: 'the folder of the panel itself stays',
  incomplete: 'not searched completely',
  empty: 'empty',
  details: (name: string) => `Details – ${name}`,
  detailsNone: 'Details',
  colWhat: 'What',
  colEntry: 'Entry',
  colInfo: 'Why',
  goes: 'goes',
  stays: 'stays',
  wholeFolder: '(the folder itself)',
  kindDir: 'folder',
  kindFile: 'file',
  emptyDir: 'empty folder',
  matchesPattern: 'matches the delete pattern',
  junkInside: (n: number, size: string) =>
    n === 1 ? `with 1 extra (${size})` : `with ${n} extras (${size})`,
  keepReason: {
    content: 'content',
    tooLarge: (limit: string) => `extra larger than ${limit}`,
    sampleTooLarge: (limit: string) => `sample larger than ${limit}`,
    hidden: 'hidden file',
    link: 'link – never followed',
    unreadable: 'not readable',
    otherFs: 'another file system',
    special: 'special file',
  },
  moreKept: (n: number) => `… and ${entries(n)} more`,
  keysHelp: 'Space selects or deselects the folder · ↑ ↓ move · Enter cleans up',
  activeRow: (name: string, verdict: string, selected: boolean) =>
    `${name}: ${verdict}${selected ? ', selected' : ''}`,
  scanning: 'Searching…',
  sum: (roots: number, d: number, f: number, size: string) =>
    `${roots === 1 ? '1 folder is cleaned' : `${roots} folders are cleaned`} · ${dirs(d)}, ${files(f)} · ${size}`,
  ignoredFiles: (n: number) =>
    n === 1 ? '1 marked file is ignored' : `${n} marked files are ignored`,
  unreadable: (n: number) => (n === 1 ? '1 folder unreadable' : `${n} folders unreadable`),
  truncated: 'The search stopped at its limit – choose a smaller folder for the rest',
  nothing: 'Nothing to delete',
  noneSelected: 'No folder selected',
  tryRelease:
    'The folders are not empty. If only leftovers such as .nfo files or samples are inside, try the profile “Release leftovers”.',
  tryReleaseButton: 'Release leftovers',
  mode: 'Delete',
  trash: 'to the trash',
  permanent: 'permanently',
  cancel: 'Cancel',
  delete: 'Clean up',
  deletePermanent: 'Delete permanently',
  noFolder: 'This side shows no folder',
  failed: (msg: string) => `Cleaning failed: ${msg}`,
  withErrors: (n: number) => `Cleaning finished – ${entries(n)} left in place`,
  doneTrash: (n: number, size: string) => `Cleaned up ${entries(n)} – ${size} moved to the trash`,
  donePermanent: (n: number, size: string) => `Cleaned up ${entries(n)} – ${size} freed`,
};

export const CL_TEXTS = translatable('cleanfolders', CL_EN, { de: CL_DE });
