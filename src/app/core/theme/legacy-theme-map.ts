/**
 * The old `--fnf-*` variables (76, `docs/legacy-themes/README.md`) and the app
 * tokens they set (design 019 §3). One place for the built-in old designs, the
 * import of old files and the export in the old format. `tokens: []` = left
 * out on purpose (`note` says why); a test checks that every variable of the
 * eight files is listed.
 */
export interface LegacyVar {
  readonly name: string;
  /** App tokens that get the value; the first one is used for the export. */
  readonly tokens: readonly string[];
  /** Why it is left out, or what the mapping means. */
  readonly note?: string;
  /** Applied only when this variable has an own value (not `inherit`/missing). */
  readonly requires?: string;
}

const v = (
  name: string,
  tokens: readonly string[],
  note?: string,
  requires?: string,
): LegacyVar => ({ name: `--fnf-${name}`, tokens, note, requires });

/** In order: later entries override earlier ones for the same token. */
export const LEGACY_VARS: readonly LegacyVar[] = [
  // accent colours (Angular Material) – first, the specific variables below win
  v(
    'material-primary-color',
    ['--color-accent', '--color-focus', '--color-splitter-active'],
    'Accent: links, focus ring, splitter',
  ),
  v('material-warn-color', ['--color-danger'], 'Warnings, delete button'),
  v('material-accent-color', ['--color-search-hit'], 'Accent colour for search hits (viewer)'),
  v('material-secondary-color', [], 'Material “secondary” buttons – we have none'),
  v(
    'material-unthemed-color',
    [],
    'Material default for unthemed buttons – see dialog-button-unthemed-*',
  ),

  // file list
  v('table-bg-color', ['--color-list-bg', '--color-surface', '--color-bg']),
  v('table-fg-color', ['--color-list-text', '--color-text']),
  v('table-border-color', ['--color-list-border']),
  v('table-header-bg-color', ['--color-list-header-bg']),
  v('table-header-fg-color', ['--color-list-header-text']),
  v('table-hover-row-bg-color', ['--color-row-hover']),
  v(
    'table-focused-row-bg-color',
    ['--color-cursor-bg', '--color-selection'],
    'Cursor (old “focused”)',
  ),
  v('table-focused-row-fg-color', ['--color-cursor-text', '--color-selection-text']),
  v('table-selected-row-bg-color', ['--color-marked-bg'], 'Marked (old “selected”)'),
  v('table-selected-row-fg-color', ['--color-marked']),
  v('table-font-size', ['--font-size-list']),

  // the panel with the focus
  v('activepanel-table-bg-color', ['--color-active-list-bg']),
  v('activepanel-table-fg-color', ['--color-active-list-text']),
  v('activepanel-table-border-color', ['--color-active-list-border']),
  v('activepanel-table-header-bg-color', ['--color-active-list-header-bg']),
  v('activepanel-table-selected-row-bg-color', ['--color-active-marked-bg']),
  v('activepanel-table-selected-row-fg-color', ['--color-active-marked']),
  v('activepanel-header-bg-color', ['--color-active-header-bg']),
  v(
    'activepanel-header-border-color',
    ['--color-active-panel-accent'],
    'The line of the active panel',
  ),
  v('activepanel-header-selected-tab-bg-color', ['--color-active-panel-tab-bg']),
  v('activepanel-header-selected-tab-fg-color', ['--color-active-panel-tab-text']),

  // panel header (path, tabs)
  v('header-bg-color', ['--color-header-bg']),
  v('header-fg-color', ['--color-header-text', '--color-tab-text']),
  v('header-border-color', ['--color-header-border']),
  v('header-input-background-color', ['--color-header-input-bg']),
  v('header-input-border', ['--color-header-input-border'], 'Colour of the border shorthand'),
  v('header-input-color', ['--color-header-input-text']),
  v('header-selected-tab-bg-color', ['--color-tab-selected-bg']),
  v('header-selected-tab-fg-color', ['--color-tab-selected-text']),

  // status line and button bar
  v('footer-bg-color', ['--color-footer-bg']),
  v('footer-fg-color', ['--color-footer-text']),
  v('footer-button-bg-color', ['--color-footer-button-bg']),
  v('footer-button-fg-color', ['--color-footer-button-text']),
  v('footer-button-border-color', ['--color-footer-button-border']),
  v('footer-shortcut-bg-color', ['--color-shortcut-bg']),
  v('footer-shortcut-fg-color', ['--color-shortcut-text']),
  v('footer-error-fg-color', ['--color-footer-error-text', '--color-error-text']),
  v('error-panel-bg-color', ['--color-danger-bg']),
  v('error-panel-fg-color', ['--color-danger-text']),

  // scrollbar, tooltip
  v('scrollbar-track-bg-color', ['--color-scrollbar-track']),
  v('scrollbar-thumb-bg-color', ['--color-scrollbar-thumb']),
  v('scrollbar-thumb-border-color', ['--color-scrollbar-thumb-border']),
  v('scrollbar-thumb-active-bg-color', ['--color-scrollbar-thumb-active']),
  v('tooltip-bg-color', ['--color-tooltip-bg']),
  v('tooltip-color', ['--color-tooltip-text']),
  v('tooltip-background-input-color', ['--color-tooltip-input-bg']),
  v('tooltip-input-color', ['--color-tooltip-input-text']),

  // dialogs (`inherit` = keep the list colours)
  v('dialog-primary-bg-color', ['--color-dialog-bg']),
  v('dialog-primary-fg-color', ['--color-dialog-text']),
  v('dialog-primary-border-color', ['--color-dialog-border']),
  v('dialog-secondary-bg-color', [], 'Second dialog area (Material header/footer) – we have none'),
  v('dialog-secondary-fg-color', [], 'see dialog-secondary-bg-color'),
  v('dialog-secondary-border-color', [], 'see dialog-secondary-bg-color'),
  v('dialog-input-bg-color', ['--color-input-bg']),
  v('dialog-input-fg-color', ['--color-input-text']),
  v('dialog-input-border-color', ['--color-input-border']),
  v('dialog-button-primary-bg-color', ['--color-button-primary-bg']),
  v('dialog-button-primary-fg-color', ['--color-button-primary-text']),
  v('dialog-button-primary-border-color', [], 'Our primary button has no own border colour'),
  v('dialog-button-secondary-bg-color', [], 'No secondary buttons'),
  v('dialog-button-secondary-fg-color', [], 'No secondary buttons'),
  v('dialog-button-secondary-border-color', [], 'No secondary buttons'),
  v('dialog-button-accent-bg-color', [], 'No accent buttons'),
  v('dialog-button-accent-fg-color', [], 'No accent buttons'),
  v('dialog-button-accent-border-color', [], 'No accent buttons'),
  v('dialog-button-warn-bg-color', ['--color-danger'], 'Delete button (overrides material-warn)'),
  v('dialog-button-warn-fg-color', ['--color-on-danger']),
  v('dialog-button-warn-border-color', [], 'The delete button uses its background as border'),
  v(
    'dialog-button-unthemed-bg-color',
    ['--color-button-bg'],
    'Normal buttons – only with an own text colour (else white on dark designs)',
    '--fnf-dialog-button-unthemed-fg-color',
  ),
  v('dialog-button-unthemed-fg-color', ['--color-button-text']),
  v(
    'dialog-button-unthemed-border-color',
    ['--color-button-border'],
    undefined,
    '--fnf-dialog-button-unthemed-fg-color',
  ),
];

export const LEGACY_VAR_NAMES: ReadonlySet<string> = new Set(LEGACY_VARS.map((l) => l.name));

/**
 * Gaps in the old files (`coffee`/`norton` without tooltip, `norton` without the
 * marked colour, a broken `#rgb(…)` in `cypress`): the first variable of the
 * chain with a usable value is taken.
 */
export const LEGACY_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  '--fnf-table-selected-row-fg-color': ['--fnf-activepanel-table-selected-row-fg-color'],
  '--fnf-tooltip-bg-color': ['--fnf-dialog-primary-bg-color', '--fnf-header-bg-color'],
  '--fnf-tooltip-color': ['--fnf-dialog-primary-fg-color', '--fnf-header-fg-color'],
  '--fnf-tooltip-background-input-color': [
    '--fnf-dialog-input-bg-color',
    '--fnf-header-input-background-color',
  ],
  '--fnf-tooltip-input-color': ['--fnf-dialog-input-fg-color', '--fnf-header-input-color'],
  '--fnf-scrollbar-track-bg-color': ['--fnf-table-bg-color'],
};
