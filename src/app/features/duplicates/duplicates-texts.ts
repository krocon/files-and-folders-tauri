import { translatable } from '../../core/i18n/i18n';
import { formatCount } from '../../shared/format';
import { DUP_DE } from './duplicates-texts.de';

/** Texts of the duplicate search (design 016 E6); German in `duplicates-texts.de.ts` (015). */
export const DUP_EN = {
  title: 'Find duplicates',
  searchIn: 'Search in',
  markedFolders: (n: number) => (n === 1 ? '1 marked folder' : `${n} marked folders`),
  folders: (n: number) => `${n} folders`,
  compare: 'Equal means',
  compareContent: 'same content (size, then SHA-256)',
  compareSize: 'same size only (fast, only a hint)',
  sameName: 'and the same name',
  minSize: 'Ignore files smaller than',
  hidden: 'Hidden entries',
  excludes: 'Exclude',
  maxFiles: 'Max. files to compare',
  find: 'Find',
  cancel: 'Cancel',
  invalidNumber: 'Please enter a number.',
  tooLarge: (max: number) => `At most ${formatCount(max)}.`,
  noFolder: 'There is no folder to search in.',
  // result tab
  header: 'Duplicates',
  summary: (groups: number, files: number, redundant: string) =>
    `${formatCount(groups)} ${groups === 1 ? 'group' : 'groups'}, ${formatCount(files)} files, ${redundant} redundant`,
  scanning: (files: number) => `scanning… ${formatCount(files)} files`,
  hashing: (done: string, total: string) => `comparing contents… ${done} of ${total}`,
  keep: 'Keep:',
  keepNewest: 'newest',
  keepOldest: 'oldest',
  keepFirst: 'first',
  keepTitle: 'Marks every file of each group except one – delete the marked ones with F8 (trash)',
  groupColumn: 'Group',
  sizeOnlyHeader: 'same size only – contents not compared, no keep helpers',
  sizeOnlyDelete:
    'These files only have the same size – their contents were not compared, they may well differ.',
  wholeGroups: (n: number) =>
    n === 1
      ? 'Every file of 1 group of duplicates is marked – no copy of it would remain.'
      : `Every file of ${n} groups of duplicates is marked – no copy of them would remain.`,
  // design 042: modes, filter, rules
  mode: 'Find',
  modeExact: 'exact duplicates (same content)',
  modeImages: 'similar images',
  modeComics: 'similar comics (.cbz, .cbr, .cb7)',
  names: 'Files',
  namesHint: 'e.g. *.jpg;*.png – empty = all',
  paranoid: 'compare byte by byte as well (slower)',
  similarity: 'Similarity',
  strict: 'strict',
  loose: 'loose',
  thresholdValue: (n: number) => `${n} of 64 bits may differ`,
  formats: 'JPEG, PNG, GIF, WebP, BMP, TIFF – HEIC and AVIF are not supported',
  ruleSet: 'Then mark with',
  ruleSetHint: 'only marks – nothing is deleted before you confirm',
  noRules: 'no rules (mark nothing)',
  builtIn: {
    copyNamesThenOldest: 'Copy names go, else keep the oldest',
    oldest: 'Keep the oldest',
    newest: 'Keep the newest',
    shortestPath: 'Keep the shortest path',
    resolution: 'Keep the highest resolution, then the largest file',
  } as Record<string, string>,
  // result tab
  modeLabel: (mode: string) =>
    mode === 'similarImages' ? 'similar images' : mode === 'comics' ? 'similar comics' : 'exact',
  toDelete: (files: number, bytes: string) =>
    files === 0
      ? 'nothing marked'
      : `delete ${formatCount(files)} ${files === 1 ? 'file' : 'files'}, ${bytes} free`,
  undecided: (n: number) => (n === 1 ? '1 group undecided' : `${formatCount(n)} groups undecided`),
  withoutKeep: (n: number) =>
    n === 1 ? '1 group without a file to keep' : `${formatCount(n)} groups without a file to keep`,
  imaging: (done: number, total: number) =>
    `reading images… ${formatCount(done)} of ${formatCount(total)}`,
  unsupported: (n: number) => `${formatCount(n)} HEIC/AVIF skipped`,
  apply: 'Apply',
  applyTitle: 'Mark the copies by the chosen rules (replaces the marks)',
  rulesButton: 'Rules…',
  deleteButton: 'Delete…',
  deleteTitle: 'Delete the marked copies – you confirm first (F8)',
  ruleSetLabel: 'Rule set',
  replaceManual: 'Apply the rules and replace your own marks?',
  // decisions (column and group view)
  decisionColumn: 'Decision',
  decision: {
    keep: 'keep',
    delete: 'delete',
    same: 'same file',
    spare: 'hard link',
    undecided: 'undecided',
  } as Record<string, string>,
  decisionTitle: {
    same: 'Another name (hard link) of a file in this group – the same file, never deleted',
    spare: 'This file has other names (hard links) – deleting this one would free nothing',
    undecided: 'No rule told these files apart – nothing is marked',
  } as Record<string, string>,
  reasonManual: 'by you',
  reasonLinks: 'has hard links',
  sameFileNoMark:
    'The same file as another one in the group (hard link) – deleting it frees nothing.',
  resolutionColumn: 'Pixels',
  pages: (n: number) => (n === 1 ? '1 page' : `${formatCount(n)} pages`),
  distance: (n: number) => (n === 0 ? 'identical look' : `${n} bits differ`),
  // group view (other side)
  groupOf: (g: number, n: number) => `Group ${formatCount(g)} of ${formatCount(n)}`,
  groupRegion: 'Files of the duplicate group under the cursor',
  keepThis: 'Keep this one (Enter)',
  noGroup: 'Put the cursor on a duplicate to see its group here.',
  // rules
  rule: {
    oldest: 'oldest file (modified)',
    newest: 'newest file (modified)',
    shortestName: 'shortest name',
    longestName: 'longest name',
    shortestPath: 'shortest path',
    longestPath: 'longest path',
    pathPattern: 'path matches a pattern',
    inFolder: 'lies in a folder',
    noCopySuffix: 'name without "copy" (Kopie, copy, (1) …)',
    largerResolution: 'higher resolution',
    largerFile: 'larger file',
    firstFound: 'found first',
  } as Record<string, string>,
  ruleShort: {
    oldest: 'oldest',
    newest: 'newest',
    shortestName: 'shortest name',
    longestName: 'longest name',
    shortestPath: 'shortest path',
    longestPath: 'longest path',
    pathPattern: 'pattern',
    inFolder: 'folder',
    noCopySuffix: 'no copy name',
    largerResolution: 'resolution',
    largerFile: 'larger file',
    firstFound: 'found first',
  } as Record<string, string>,
  preferKeep: 'keep these',
  preferDelete: 'delete these',
  glob: 'Glob',
  regex: 'Regular expression',
  caseSensitive: 'Match case',
  pattern: 'Pattern',
  folder: 'Folder',
  folderFromOther: 'Folder of the other side',
  ruleErrors: {
    emptyPattern: 'Rule {n}: enter a pattern.',
    badRegex: 'Rule {n}: the regular expression is invalid.',
    noFolder: 'Rule {n}: choose a folder.',
  } as Record<string, string>,
  ruleError: (reason: string, n: number) =>
    (DUP_EN.ruleErrors[reason] ?? 'Rule {n} is invalid.').replace('{n}', String(n)),
  // rules dialog
  rulesTitle: 'Which file stays?',
  rulesIntro:
    'The rules run in order; the first one that tells the files of a group apart decides, the next ones break ties. If none does, the group stays unmarked.',
  addRule: 'Add rule',
  removeRule: 'Remove',
  moveUp: 'Up',
  moveDown: 'Down',
  rulesPreview: (decided: number, undecided: number) =>
    `${formatCount(decided)} ${decided === 1 ? 'group' : 'groups'} decided, ${formatCount(undecided)} undecided`,
  presetName: 'Save as',
  save: 'Save',
  deletePreset: 'Delete set',
  applyAndClose: 'Apply',
  close: 'Close',
  rulesList: 'Rules',
  // delete confirmation
  dedupeTitle: 'Delete duplicates',
  dedupeSummary: (files: number, groups: number, bytes: string) =>
    `${formatCount(files)} ${files === 1 ? 'copy' : 'copies'} from ${formatCount(groups)} ${groups === 1 ? 'group' : 'groups'} · ${bytes} become free`,
  dedupeSkipped: (undecided: number, withoutKeep: number) =>
    [
      undecided > 0 ? DUP_EN.undecided(undecided) : '',
      withoutKeep > 0 ? `${DUP_EN.withoutKeep(withoutKeep)} – nothing of them is deleted` : '',
    ]
      .filter((s) => s !== '')
      .join(' · '),
  action: 'What happens to the copies',
  actionTrash: 'To the trash',
  actionPermanent: 'Delete permanently',
  actionMove: 'Move into a folder',
  moveTarget: (path: string) => `Into: ${path}`,
  noMoveTarget: 'The other side shows no folder.',
  verifyContent: 'Right before, every copy is compared byte by byte with the file that stays.',
  verifyUnchanged:
    'Right before, every file is checked to be unchanged since the search. Similar files are not the same – look at the pictures.',
  groupsTitle: 'Groups',
  groupPage: (from: number, to: number, n: number) => `${from}–${to} of ${n}`,
  previous: 'Previous',
  next: 'Next',
  stays: 'stays',
  goes: 'goes',
  confirm: (n: number) => (n === 1 ? 'Delete 1 copy' : `Delete ${formatCount(n)} copies`),
  confirmMove: (n: number) => (n === 1 ? 'Move 1 copy' : `Move ${formatCount(n)} copies`),
  confirmPermanent: 'Really delete permanently?',
  nothingMarked: 'No copies are marked – apply rules or mark copies first.',
  dedupeFinished: (title: string, n: number) =>
    `${title}: ${formatCount(n)} ${n === 1 ? 'file was' : 'files were'} left alone – see Tasks.`,
};

export const DUP_TEXTS = translatable('duplicates', DUP_EN, { de: DUP_DE });
