/**
 * Marc's wishes for the old designs (2026-10-19), applied on top of the unchanged files of
 * `docs/legacy-themes/` – for the built-in designs and for imports of a file with the same
 * name. `--fnf-*` entries replace old variables before the conversion, `--color-*` entries
 * set app tokens afterwards (both still pass the contrast correction).
 */
/** File icons in the list text colour, as before the icon colours (2026-10-20). */
const PLAIN_ICONS: Readonly<Record<string, string>> = Object.fromEntries(
  ['folder', 'document', 'image', 'video', 'audio', 'archive', 'code', 'executable'].map((g) => [
    `--color-icon-${g}`,
    'var(--color-active-list-text)',
  ]),
);

export const LEGACY_TWEAKS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // marked files red in the active panel only (the red of the design), plain in the other one;
  // the marked values of the status line (before the `/`) in the colour of the marked files
  paper: {
    '--color-status-marked': 'var(--color-active-marked)',
    '--fnf-activepanel-table-selected-row-fg-color': 'red',
    '--fnf-table-selected-row-fg-color': 'var(--fnf-table-fg-color)',
  },
  bitbucket: {
    '--color-status-marked': 'var(--color-active-marked)',
    '--fnf-activepanel-table-selected-row-fg-color': '#e00034',
    '--fnf-table-selected-row-fg-color': 'var(--fnf-table-fg-color)',
  },
  combat: {
    ...PLAIN_ICONS,
    '--color-status-marked': 'var(--color-active-marked)',
    '--fnf-activepanel-table-selected-row-fg-color': '#f00032',
    '--fnf-table-selected-row-fg-color': 'var(--fnf-table-fg-color)',
  },
  // Norton: marked yellow in the active panel only; Actions menu and folder menu in teal (2026-10-21)
  norton: {
    '--color-status-marked': 'var(--color-active-marked)',
    '--color-menu-bg': '#028383',
    '--color-menu-text': '#ffffff',
    // Marc 21.10.2026: black splitter between the panels
    '--color-splitter': '#000',
    '--fnf-activepanel-table-selected-row-fg-color': '#fcfc54',
    '--fnf-table-selected-row-fg-color': 'var(--fnf-table-fg-color)',
  },
  // Coffee: marks are orange already – the status line values follow them
  coffee: {
    ...PLAIN_ICONS,
    '--color-status-marked': 'var(--color-active-marked)',
  },
  // Blackboard: plain icons only
  blackboard: PLAIN_ICONS,
};

/** The old variables of a design with its tweaks (`name` = file name, case-insensitive). */
export function tweakedColors(
  name: string | undefined,
  colors: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const tweaks = LEGACY_TWEAKS[(name ?? '').toLowerCase()] ?? {};
  const fnf = Object.fromEntries(Object.entries(tweaks).filter(([k]) => k.startsWith('--fnf-')));
  return { ...colors, ...fnf };
}

/** Token tweaks of a design (`--color-*`). */
export function tweakedTokens(name: string | undefined): Readonly<Record<string, string>> {
  const tweaks = LEGACY_TWEAKS[(name ?? '').toLowerCase()] ?? {};
  return Object.fromEntries(Object.entries(tweaks).filter(([k]) => k.startsWith('--color-')));
}
