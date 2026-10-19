import { blend, contrastRatio, luminance, parseColor, Rgba, WHITE } from './color';
import { Theme } from './theme.models';
import { themeLabel, TOKEN_NAMES, tokenDef, TokenKind } from './tokens';

/**
 * Pure theme logic (design 013): resolving `var()` chains, checking values,
 * normalising imported files (own and old `{name, colors}` format), ids and
 * the WCAG contrast pairs. Same value rules as Rust `themes::token_ok`.
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

/** A harmless CSS value: short, no `; { } < > \ @`, no control characters (C0, C1), nothing that loads resources. */
export function isSafeValue(value: string): boolean {
  const v = value.trim();
  if (!v || [...v].length > MAX_VALUE_LEN) {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  if (/[;{}<>\\@\u0000-\u001f\u007f-\u009f]/.test(v)) {
    return false;
  }
  const lower = v.toLowerCase();
  return !BAD_FUNCS.some((f) => lower.includes(f));
}

// ---- values per token kind (review 013 #1; same rules as Rust `themes::token_ok`) ----

/** `--fnf-*` of old scheme files: kept for prompt 019, never applied. */
export type StoredKind = TokenKind | 'legacy';

/** Layout variables of `styles.css` that share a theme prefix – never theme tokens. */
const LAYOUT_TOKENS: ReadonlySet<string> = new Set([
  '--font-sans',
  '--font-mono',
  '--font-size-xs',
  '--font-size-sm',
  '--font-size-md',
  '--font-size-lg',
]);

/** The kind of a token the app may store (catalog first, then by prefix); `null` = never a theme token. */
export function tokenKind(name: string): StoredKind | null {
  if (!isTokenName(name) || LAYOUT_TOKENS.has(name)) {
    return null;
  }
  const def = tokenDef(name);
  if (def) {
    return def.kind;
  }
  if (name.startsWith('--fnf-')) {
    return 'legacy';
  }
  if (name.startsWith('--color-')) {
    return 'color';
  }
  if (name.startsWith('--shadow-')) {
    return 'shadow';
  }
  if (name.startsWith('--font-size-')) {
    return 'length';
  }
  return name.startsWith('--font-') ? 'font' : null;
}

/** A theme token name with a value of its kind (what may be stored). */
export function tokenValueOk(name: string, value: string): boolean {
  const v = value.trim();
  if (!isSafeValue(v)) {
    return false;
  }
  switch (tokenKind(name)) {
    case 'color':
      return colorOk(v);
    case 'length':
      return lengthOk(v);
    case 'font':
      return fontOk(v);
    case 'shadow':
      return shadowOk(v);
    case 'legacy':
      return true;
    default:
      return false;
  }
}

/** What is put on `<html>`: catalog tokens only, values checked. */
export function applicableToken(name: string, value: string): boolean {
  return TOKEN_NAMES.has(name) && tokenValueOk(name, value);
}

function varRef(v: string): { name: string; fallback: string | null } | null {
  if (!v.startsWith('var(') || !v.endsWith(')')) {
    return null;
  }
  const inner = v.slice(4, -1);
  const comma = inner.indexOf(',');
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
  const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
  if (fallback === '' || !isTokenName(name)) {
    return null;
  }
  return { name, fallback };
}

function colorOk(v: string): boolean {
  if (parseColor(v)) {
    return true;
  }
  const ref = varRef(v);
  return (
    !!ref &&
    ref.name.startsWith('--color-') &&
    (ref.fallback === null || !!parseColor(ref.fallback))
  );
}

/** A font size: px 6–48, pt 5–36, rem/em 0.375–3, % 50–300. */
const LENGTH = /^(\d+\.?\d*|\.\d+)(px|pt|rem|em|%)$/;
const LENGTH_RANGE: Readonly<Record<string, readonly [number, number]>> = {
  px: [6, 48],
  pt: [5, 36],
  rem: [0.375, 3],
  em: [0.375, 3],
  '%': [50, 300],
};

function lengthLiteral(v: string): boolean {
  const m = LENGTH.exec(v);
  if (!m) {
    return false;
  }
  const [lo, hi] = LENGTH_RANGE[m[2]];
  const x = Number(m[1]);
  return x >= lo && x <= hi;
}

function lengthOk(v: string): boolean {
  if (lengthLiteral(v)) {
    return true;
  }
  const ref = varRef(v);
  return (
    !!ref &&
    ref.name.startsWith('--font-size-') &&
    (ref.fallback === null || lengthLiteral(ref.fallback))
  );
}

function fontFamily(raw: string): boolean {
  const f = raw.trim();
  const quoted = f.length >= 2 && /^(['"]).*\1$/su.test(f);
  const name = quoted ? f.slice(1, -1) : f;
  const first = quoted ? /^[\p{L}\p{N}]/u : /^\p{L}/u;
  return first.test(name) && [...name].length <= 60 && /^[\p{L}\p{N} _-]*$/u.test(name);
}

/** A list of font family names (at most 12) or `var(--font-…)`. */
function fontOk(v: string): boolean {
  const ref = varRef(v);
  if (ref) {
    return (
      ref.name.startsWith('--font-') &&
      !ref.name.startsWith('--font-size-') &&
      (ref.fallback === null || fontOk(ref.fallback))
    );
  }
  const families = v.split(',');
  return families.length <= 12 && families.every(fontFamily);
}

/** Splits at `sep` outside of parentheses. */
function splitTop(v: string, sep: (c: string) => boolean): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    } else if (depth === 0 && sep(c)) {
      out.push(v.slice(start, i));
      start = i + 1;
    }
  }
  out.push(v.slice(start));
  return out;
}

const SHADOW_LENGTH = /^([-+]?(?:\d+\.?\d*|\.\d+))(px|rem|em)$/;

/** `0` or a number with px (|x| ≤ 100) or rem/em (|x| ≤ 6). */
function shadowLength(p: string): boolean {
  if (p === '0') {
    return true;
  }
  const m = SHADOW_LENGTH.exec(p);
  return !!m && Math.abs(Number(m[1])) <= (m[2] === 'px' ? 100 : 6);
}

/** `none`, `var(--shadow-…)` or up to 4 shadows of `[inset] x y [blur [spread]] [colour]`. */
function shadowOk(v: string): boolean {
  if (v === 'none') {
    return true;
  }
  const ref = varRef(v);
  if (ref) {
    return ref.name.startsWith('--shadow-') && ref.fallback === null;
  }
  const shadows = splitTop(v, (c) => c === ',');
  return (
    shadows.length <= 4 &&
    shadows.every((sh) => {
      let lengths = 0;
      let colors = 0;
      let inset = 0;
      for (const part of splitTop(sh.trim(), (c) => /\s/.test(c))) {
        if (!part) {
          continue;
        }
        if (part === 'inset') {
          inset++;
        } else if (shadowLength(part)) {
          lengths++;
        } else if (colorOk(part)) {
          colors++;
        } else {
          return false;
        }
      }
      return lengths >= 2 && lengths <= 4 && colors <= 1 && inset <= 1;
    })
  );
}

/** For colour tokens: a colour we can read or a `var(--color-…)` reference (checked when resolved). */
export function isColorValue(value: string): boolean {
  const v = value.trim();
  return isSafeValue(v) && colorOk(v);
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
    if (typeof v === 'string' && tokenValueOk(k, v) && Object.keys(tokens).length < MAX_TOKENS) {
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
  /** Names that are no theme token or whose value was rejected (unsafe, wrong kind, no string). */
  readonly dropped: readonly string[];
  /** Kept names the app does not know (old `--fnf-*` variables until prompt 019). */
  readonly unknown: readonly string[];
  readonly legacy: boolean;
}

/** Normalises an imported file: `{name, dark, tokens}` or the old `{name, colors}`. */
export function normalizeImport(raw: unknown): ImportedTheme | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return themeLabel('The file is not a colour scheme.');
  }
  const o = raw as Record<string, unknown>;
  const legacy = o['tokens'] === undefined && o['colors'] !== undefined;
  const source = legacy ? o['colors'] : o['tokens'];
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return 'The file is not a colour scheme (neither "tokens" nor "colors").';
  }
  const { tokens, dropped } = sanitizeTokens(source);
  if (Object.keys(tokens).length === 0) {
    return themeLabel('The colour scheme has no usable values.');
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
/** Translucent row backgrounds are painted on the list, not on the window (review 013 #5). */
const LIST = '--color-list-bg';
const ACTIVE_LIST = '--color-active-list-bg';
const p = (fg: string, bg: string, label: string, min = TEXT, over?: string): ContrastPair => ({
  fg,
  bg,
  get label() {
    return themeLabel(label);
  },
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
  p('--color-list-text', '--color-row-hover', 'List, row under the mouse', TEXT, LIST),
  p('--color-list-text', '--color-group-alt-bg', 'List, every other duplicate group', TEXT, LIST),
  p(
    '--color-active-list-text',
    '--color-group-alt-bg',
    'Active panel list, every other duplicate group',
    TEXT,
    ACTIVE_LIST,
  ),
  p('--color-list-header-text', '--color-list-header-bg', 'Column header', TEXT, LIST),
  p('--color-marked', '--color-marked-bg', 'Marked', TEXT, LIST),
  p('--color-hidden-text', '--color-list-bg', 'Hidden entries'),
  p('--color-symlink-text', '--color-list-bg', 'Symbolic links'),
  p('--color-error-text', '--color-list-bg', 'Unreadable entries'),
  p('--color-cursor-text', '--color-cursor-bg', 'Cursor', TEXT, ACTIVE_LIST),
  p(
    '--color-cursor-marked-text',
    '--color-cursor-bg',
    'Marked under the cursor',
    TEXT,
    ACTIVE_LIST,
  ),
  p(
    '--color-cursor-inactive-text',
    '--color-cursor-inactive-bg',
    'Cursor, inactive panel',
    TEXT,
    LIST,
  ),
  p('--color-marked', '--color-cursor-inactive-bg', 'Marked under the inactive cursor', TEXT, LIST),

  p('--color-active-list-text', '--color-active-list-bg', 'Active panel list'),
  p(
    '--color-active-list-text',
    '--color-row-hover',
    'Active panel list, row under the mouse',
    TEXT,
    ACTIVE_LIST,
  ),
  p(
    '--color-list-header-text',
    '--color-active-list-header-bg',
    'Column header, active panel',
    TEXT,
    ACTIVE_LIST,
  ),
  p('--color-hidden-text', '--color-active-list-bg', 'Hidden entries, active panel'),
  p('--color-symlink-text', '--color-active-list-bg', 'Symbolic links, active panel'),
  p('--color-error-text', '--color-active-list-bg', 'Unreadable entries, active panel'),
  p('--color-active-marked', '--color-active-marked-bg', 'Marked, active panel', TEXT, ACTIVE_LIST),
  p('--color-active-panel-tab-text', '--color-active-panel-tab-bg', 'Selected tab, active panel'),
  p('--color-active-panel-accent', '--color-active-list-bg', 'Active panel line', UI),

  p('--color-header-text', '--color-header-bg', 'Panel header'),
  p('--color-header-text', '--color-active-header-bg', 'Panel header, active panel'),
  p('--color-tab-text', '--color-header-bg', 'Tabs'),
  p('--color-tab-text', '--color-active-header-bg', 'Tabs, active panel'),
  p('--color-tab-selected-text', '--color-tab-selected-bg', 'Selected tab'),
  p('--color-header-input-text', '--color-header-input-bg', 'Header inputs'),
  p('--color-favorite', '--color-header-bg', 'Favourite star', UI),

  p('--color-footer-text', '--color-footer-bg', 'Status line'),
  p('--color-status-marked', '--color-footer-bg', 'Marked values in the status line'),
  p('--color-footer-error-text', '--color-footer-bg', 'Status line warning'),
  p('--color-footer-button-text', '--color-footer-button-bg', 'Function buttons'),
  p('--color-shortcut-text', '--color-shortcut-bg', 'Shortcut badges'),

  p('--color-dialog-text', '--color-dialog-bg', 'Dialogs'),
  p('--color-muted', '--color-dialog-bg', 'Muted text in dialogs'),
  p('--color-input-text', '--color-input-bg', 'Inputs'),
  p('--color-button-text', '--color-button-bg', 'Buttons'),
  p('--color-button-primary-text', '--color-button-primary-bg', 'Primary buttons'),

  p('--color-header-focus', '--color-header-bg', 'Focus ring on the panel header', UI),
  p(
    '--color-header-focus',
    '--color-active-header-bg',
    'Focus ring on the panel header, active panel',
    UI,
  ),
  p('--color-focus', '--color-list-bg', 'Focus ring on the list', UI),
  p('--color-dialog-focus', '--color-dialog-bg', 'Focus ring in dialogs', UI),
  p('--color-footer-focus', '--color-footer-bg', 'Focus ring on the status line', UI),

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
  return CONTRAST_PAIRS.map((pair) => {
    const ratio = pairRatio(pair, tokens);
    return { pair, ratio, ok: ratio !== null && ratio >= pair.min };
  });
}

/** Contrast of one pair (translucent colours painted on `over`, else the window); `null` = not resolvable. */
export function pairRatio(
  pair: ContrastPair,
  tokens: Readonly<Record<string, string>>,
): number | null {
  const win = resolveColor('--color-bg', tokens) ?? WHITE;
  const base = win.a < 1 ? blend(win, WHITE) : win;
  const fg = resolveColor(pair.fg, tokens);
  const bg = resolveColor(pair.bg, tokens);
  const under = pair.over ? resolveColor(pair.over, tokens) : null;
  const over = under ? (under.a < 1 ? blend(under, base) : under) : base;
  return fg && bg ? contrastRatio(fg, bg, over) : null;
}
