import { contrastRatio, luminance, parseColor, Rgba, WHITE } from './color';
import { Theme } from './theme.models';
import { TOKEN_NAMES } from './tokens';

/**
 * Pure theme logic (design 013): resolving `var()` chains, checking values,
 * normalising imported files (own and old `{name, colors}` format), ids and
 * the WCAG contrast pairs. Same value rules as Rust `themes::value_ok`.
 */

export const MAX_VALUE_LEN = 200;
export const MAX_NAME_LEN = 100;
export const MAX_TOKENS = 300;

const TOKEN_NAME = /^--[a-z0-9-]{1,78}$/;
const VAR_REF = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/;
const BAD_FUNCS = ['url(', 'expression(', 'image(', 'image-set(', 'element('];

export function isTokenName(name: string): boolean {
  return TOKEN_NAME.test(name);
}

/** A harmless CSS value: short, no `; { } < > \ @`, no control characters, nothing that loads resources. */
export function isSafeValue(value: string): boolean {
  const v = value.trim();
  if (!v || [...v].length > MAX_VALUE_LEN) {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  if (/[;{}<>\\@\u0000-\u001f\u007f]/.test(v)) {
    return false;
  }
  const lower = v.toLowerCase();
  return !BAD_FUNCS.some((f) => lower.includes(f));
}

/** The value of a token after following `var(--x[, fallback])` chains; `null` on cycles/missing. */
export function resolveValue(
  name: string,
  tokens: Readonly<Record<string, string>>,
  seen: ReadonlySet<string> = new Set(),
): string | null {
  if (seen.has(name)) {
    return null;
  }
  const raw = tokens[name];
  if (raw === undefined) {
    return null;
  }
  const ref = VAR_REF.exec(raw.trim());
  if (!ref) {
    return raw.trim();
  }
  const next = new Set(seen).add(name);
  return resolveValue(ref[1], tokens, next) ?? (ref[2]?.trim() || null);
}

export function resolveColor(name: string, tokens: Readonly<Record<string, string>>): Rgba | null {
  const v = resolveValue(name, tokens);
  return v === null ? null : parseColor(v);
}

/** Built-in tokens of the scheme with the same `dark` flag, overlaid with the theme's own. */
export function completeTokens(
  theme: Pick<Theme, 'tokens' | 'dark'>,
  light: Theme,
  dark: Theme,
): Record<string, string> {
  return { ...(theme.dark ? dark : light).tokens, ...theme.tokens };
}

/** Only the tokens that differ from the base scheme (what we store). */
export function diffTokens(
  tokens: Readonly<Record<string, string>>,
  base: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens)) {
    if (base[k] !== v) {
      out[k] = v;
    }
  }
  return out;
}

/** Keeps valid name/value pairs; returns the names it dropped. */
export function sanitizeTokens(raw: unknown): {
  tokens: Record<string, string>;
  dropped: string[];
} {
  const tokens: Record<string, string> = {};
  const dropped: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { tokens, dropped };
  }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (
      isTokenName(k) &&
      typeof v === 'string' &&
      isSafeValue(v) &&
      Object.keys(tokens).length < MAX_TOKENS
    ) {
      tokens[k] = v.trim();
    } else {
      dropped.push(k);
    }
  }
  return { tokens, dropped };
}

export interface ImportedTheme {
  readonly name: string;
  readonly dark: boolean;
  readonly tokens: Record<string, string>;
  /** Names whose value was rejected (unsafe, too long, no string). */
  readonly dropped: readonly string[];
  /** Kept names the app does not know (old `--fnf-*` variables until prompt 019). */
  readonly unknown: readonly string[];
  readonly legacy: boolean;
}

/** Normalises an imported file: `{name, dark, tokens}` or the old `{name, colors}`. */
export function normalizeImport(raw: unknown): ImportedTheme | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'The file is not a colour scheme.';
  }
  const o = raw as Record<string, unknown>;
  const legacy = o['tokens'] === undefined && o['colors'] !== undefined;
  const source = legacy ? o['colors'] : o['tokens'];
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return 'The file is not a colour scheme (neither "tokens" nor "colors").';
  }
  const { tokens, dropped } = sanitizeTokens(source);
  if (Object.keys(tokens).length === 0) {
    return 'The colour scheme has no usable values.';
  }
  const name =
    typeof o['name'] === 'string' && o['name'].trim()
      ? o['name'].trim().slice(0, MAX_NAME_LEN)
      : 'Imported';
  const dark = typeof o['dark'] === 'boolean' ? o['dark'] : guessDark(tokens);
  return {
    name,
    dark,
    tokens,
    dropped,
    unknown: Object.keys(tokens).filter((k) => !TOKEN_NAMES.has(k)),
    legacy,
  };
}

/** Dark if the list (or old table) background is dark; light when unknown. */
export function guessDark(tokens: Readonly<Record<string, string>>): boolean {
  for (const name of ['--color-list-bg', '--color-bg', '--fnf-table-bg-color']) {
    const c = resolveColor(name, tokens);
    if (c && c.a > 0) {
      return luminance(c) < 0.2;
    }
  }
  return false;
}

/** `user-<slug>` that is not taken yet. */
export function newThemeId(name: string, taken: ReadonlySet<string>): string {
  const slug =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'theme';
  let id = `user-${slug}`;
  for (let n = 2; taken.has(id); n++) {
    id = `user-${slug}-${n}`;
  }
  return id;
}

/** A name that no other scheme uses (`Name (2)` …). */
export function uniqueName(name: string, taken: readonly string[]): string {
  const base = name.trim().slice(0, MAX_NAME_LEN - 5) || 'Theme';
  let out = base;
  for (let n = 2; taken.includes(out); n++) {
    out = `${base} (${n})`;
  }
  return out;
}

// ---- contrast (design 013 E7) ----

export interface ContrastPair {
  readonly fg: string;
  readonly bg: string;
  /** Opaque background under a translucent `bg` (e.g. marked-bg on the list). */
  readonly over?: string;
  readonly min: number;
  readonly label: string;
}

const TEXT = 4.5;
const UI = 3;
const p = (fg: string, bg: string, label: string, min = TEXT, over?: string): ContrastPair => ({
  fg,
  bg,
  label,
  min,
  over,
});

/** Text/background pairs every scheme must pass (text 4.5:1, focus/UI 3:1). */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  p('--color-text', '--color-bg', 'Text on the window'),
  p('--color-text', '--color-surface', 'Text on surfaces'),
  p('--color-muted', '--color-surface', 'Muted text'),
  p('--color-muted', '--color-bg', 'Muted text on the window'),
  p('--color-accent', '--color-surface', 'Accent as text'),
  p('--color-accent-text', '--color-accent', 'Text on accent'),
  p('--color-selection-text', '--color-selection', 'Selection'),
  p('--color-on-danger', '--color-danger', 'Danger button'),
  p('--color-danger-text', '--color-danger-bg', 'Error panel'),
  p('--color-text', '--color-search-hit', 'Search hit'),
  p('--color-focus', '--color-surface', 'Focus ring', UI),
  p('--color-focus', '--color-bg', 'Focus ring on the window', UI),

  p('--color-list-text', '--color-list-bg', 'List'),
  p('--color-list-text', '--color-row-hover', 'List, row under the mouse'),
  p('--color-list-header-text', '--color-list-header-bg', 'Column header'),
  p('--color-marked', '--color-marked-bg', 'Marked', TEXT, '--color-list-bg'),
  p('--color-hidden-text', '--color-list-bg', 'Hidden entries'),
  p('--color-symlink-text', '--color-list-bg', 'Symbolic links'),
  p('--color-error-text', '--color-list-bg', 'Unreadable entries'),
  p('--color-cursor-text', '--color-cursor-bg', 'Cursor'),
  p('--color-cursor-marked-text', '--color-cursor-bg', 'Marked under the cursor'),
  p('--color-cursor-inactive-text', '--color-cursor-inactive-bg', 'Cursor, inactive panel'),
  p('--color-marked', '--color-cursor-inactive-bg', 'Marked under the inactive cursor'),

  p('--color-active-list-text', '--color-active-list-bg', 'Active panel list'),
  p(
    '--color-active-marked',
    '--color-active-marked-bg',
    'Marked, active panel',
    TEXT,
    '--color-active-list-bg',
  ),
  p('--color-active-panel-tab-text', '--color-active-panel-tab-bg', 'Selected tab, active panel'),
  p('--color-active-panel-accent', '--color-active-list-bg', 'Active panel line', UI),

  p('--color-header-text', '--color-header-bg', 'Panel header'),
  p('--color-header-text', '--color-active-header-bg', 'Panel header, active panel'),
  p('--color-tab-text', '--color-header-bg', 'Tabs'),
  p('--color-tab-selected-text', '--color-tab-selected-bg', 'Selected tab'),
  p('--color-header-input-text', '--color-header-input-bg', 'Header inputs'),
  p('--color-favorite', '--color-header-bg', 'Favourite star', UI),

  p('--color-footer-text', '--color-footer-bg', 'Status line'),
  p('--color-footer-error-text', '--color-footer-bg', 'Status line warning'),
  p('--color-footer-button-text', '--color-footer-button-bg', 'Function buttons'),
  p('--color-shortcut-text', '--color-shortcut-bg', 'Shortcut badges'),

  p('--color-dialog-text', '--color-dialog-bg', 'Dialogs'),
  p('--color-input-text', '--color-input-bg', 'Inputs'),
  p('--color-button-text', '--color-button-bg', 'Buttons'),
  p('--color-button-primary-text', '--color-button-primary-bg', 'Primary buttons'),

  p('--color-tooltip-text', '--color-tooltip-bg', 'Tooltip'),
  p('--color-tooltip-input-text', '--color-tooltip-input-bg', 'Tooltip input'),
];

export interface ContrastResult {
  readonly pair: ContrastPair;
  /** `null` = a colour could not be resolved (no check possible). */
  readonly ratio: number | null;
  readonly ok: boolean;
}

/** Checks all pairs on the (complete) tokens of a scheme. */
export function checkContrast(tokens: Readonly<Record<string, string>>): ContrastResult[] {
  const base = resolveColor('--color-bg', tokens) ?? WHITE;
  return CONTRAST_PAIRS.map((pair) => {
    const fg = resolveColor(pair.fg, tokens);
    const bg = resolveColor(pair.bg, tokens);
    const over = pair.over ? (resolveColor(pair.over, tokens) ?? base) : base;
    if (!fg || !bg) {
      return { pair, ratio: null, ok: false };
    }
    const ratio = contrastRatio(fg, bg, over);
    return { pair, ratio, ok: ratio >= pair.min };
  });
}
