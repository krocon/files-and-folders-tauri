/**
 * Marc's wishes for the old designs (2026-10-19), applied on top of the unchanged files of
 * `docs/legacy-themes/` – for the built-in designs and for imports of a file with the same
 * name. `--fnf-*` entries replace old variables before the conversion, `--color-*` entries
 * set app tokens afterwards (both still pass the contrast correction).
 */
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
    '--color-status-marked': 'var(--color-active-marked)',
    '--fnf-activepanel-table-selected-row-fg-color': '#f00032',
    '--fnf-table-selected-row-fg-color': 'var(--fnf-table-fg-color)',
  },
  // Norton: marked yellow in the active panel only
  norton: {
    '--color-status-marked': 'var(--color-active-marked)',
    '--fnf-activepanel-table-selected-row-fg-color': '#fcfc54',
    '--fnf-table-selected-row-fg-color': 'var(--fnf-table-fg-color)',
  },
  // Coffee: marks are orange already – the status line values follow them
  coffee: {
    '--color-status-marked': 'var(--color-active-marked)',
  },
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
