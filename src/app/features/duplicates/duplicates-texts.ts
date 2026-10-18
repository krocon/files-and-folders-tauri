/** Texts of the duplicate search (design 016 E6), in one place for prompt 015 (i18n). */
export const DUP_TEXTS = {
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
  tooLarge: (max: number) => `At most ${max.toLocaleString()}.`,
  noFolder: 'There is no folder to search in.',
  // result tab
  header: 'Duplicates',
  summary: (groups: number, files: number, redundant: string) =>
    `${groups.toLocaleString()} ${groups === 1 ? 'group' : 'groups'}, ${files.toLocaleString()} files, ${redundant} redundant`,
  scanning: (files: number) => `scanning… ${files.toLocaleString()} files`,
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
};
