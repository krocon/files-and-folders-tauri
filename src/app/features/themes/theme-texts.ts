/** Texts of the colour scheme dialog and menu (design 013; i18n with prompt 015). */
export const THEME_TEXTS = {
  heading: 'Colour schemes',
  followSystem: 'Follow the system',
  lightScheme: 'Light system',
  darkScheme: 'Dark system',
  schemes: 'Schemes',
  builtIn: 'built-in',
  name: 'Name',
  dark: 'Dark scheme',
  more: 'More (unknown to this version)',
  pickColor: (label: string) => `${label}: pick a colour`,
  valueOf: (label: string) => `${label}: value`,
  invalidValue: 'Not a valid value – it is not applied.',
  contrastOk: 'All contrast checks pass (WCAG AA).',
  contrastProblems: (n: number) =>
    n === 1 ? '1 contrast problem (WCAG AA):' : `${n} contrast problems (WCAG AA):`,
  ratio: (label: string, ratio: number | null, min: number) =>
    ratio === null
      ? `${label}: colour not resolvable`
      : `${label}: ${ratio.toFixed(1)}:1 (min. ${min}:1)`,
  lowContrast: 'Low contrast – see the list at the top',
  save: 'Save',
  saveAs: 'Save as new',
  delete: 'Delete',
  reset: 'Reset',
  import: 'Import',
  export: 'Export',
  close: 'Close',
  importHelp:
    'Import reads the file under the cursor; export writes into the active panel’s folder.',
  unsavedFirst: 'Save or reset your changes first.',
  builtInReadOnly: 'Built-in schemes are read-only – use “Save as new”.',
  saved: (name: string) => `Saved “${name}”.`,
  deleted: (name: string) => `Deleted “${name}”.`,
  noFile: 'Put the cursor on a scheme file (*.json) to import it.',
  noFolder: 'The active panel shows no folder to export into.',
  imported: (name: string, unknown: number, dropped: number) =>
    `Imported “${name}”.` +
    (unknown ? ` ${unknown} variable(s) are unknown to this version and kept.` : '') +
    (dropped ? ` ${dropped} value(s) were rejected.` : ''),
  exported: (path: string) => `Exported to ${path}`,
  menuLabel: 'Colour scheme',
  menuEdit: 'Edit colour schemes…',
  menuFollow: 'Follow the system',
  paletteEntry: (name: string) => `Colour scheme: ${name}`,
} as const;
