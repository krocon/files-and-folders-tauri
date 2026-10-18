import { luminance, parseColor, Rgba, toHex } from './color';
import { ContrastAdjustment, fixContrast, formatColor } from './contrast-fix';
import { LEGACY_FALLBACKS, LEGACY_VAR_NAMES, LEGACY_VARS } from './legacy-theme-map';
import { resolveValue, tokenValueOk } from './theme-logic';
import { Theme } from './theme.models';
import { TOKENS } from './tokens';

/**
 * Old scheme files `{ name, colors: { "--fnf-…": … } }` → our tokens (design
 * 019): resolve the `var()` chains of the file, fill its gaps, map the 76
 * variables, derive the tokens the old version did not have, flatten to literal
 * colours and correct what misses WCAG AA (minimally, listed in `adjustments`).
 * Built-in old designs and imports of old files go through the same function,
 * so an imported file is the same scheme as the shipped one.
 */
export interface ConvertedLegacy {
  readonly dark: boolean;
  /** Every catalog token + the `--fnf-*` variables without a token (kept for the old-format export). */
  readonly tokens: Record<string, string>;
  /** `--fnf-*` names this version does not know (kept). */
  readonly unknown: readonly string[];
  /** Variables that were missing or unusable and came from a fallback. */
  readonly filled: readonly string[];
  readonly adjustments: readonly ContrastAdjustment[];
  /** Mapped values before the contrast correction (for the report). */
  readonly original: Readonly<Record<string, string>>;
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return { r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b), a: 1 };
}

/** White or black, whichever reads better on `bg`. */
function bestOn(bg: Rgba): Rgba {
  const l = luminance(bg);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? WHITE : BLACK;
}

/**
 * A colour from a value: plain colour or the colour part of a border shorthand
 * (`solid 1px #aaa`); tolerates the typo `#rgb(…)` of the old cypress file.
 */
export function legacyColor(value: string | null | undefined): Rgba | null {
  if (!value) {
    return null;
  }
  const direct = parseColor(value);
  if (direct) {
    return direct;
  }
  const parts = value.trim().match(/rgba?\([^)]*\)|#[0-9a-fA-F]+\b|[a-zA-Z]+/g) ?? [];
  for (const part of parts) {
    const c = parseColor(part);
    if (c) {
      return c;
    }
  }
  return null;
}

/** The usable value of one old variable (own, else the fallback chain); `null` = none. */
function legacyValue(
  name: string,
  colors: Readonly<Record<string, string>>,
  kind: 'color' | 'length',
): string | null {
  const raw = resolveValue(name, colors);
  if (kind === 'length') {
    return raw !== null && tokenValueOk('--font-size-list', raw) ? raw : null;
  }
  const c = legacyColor(raw);
  return c ? formatColor(c) : null;
}

export function convertLegacy(
  rawColors: Readonly<Record<string, unknown>>,
  light: Theme,
  dark: Theme,
): ConvertedLegacy {
  const colors: Record<string, string> = {};
  for (const [k, val] of Object.entries(rawColors)) {
    if (k.startsWith('--fnf-') && typeof val === 'string') {
      colors[k] = val.trim();
    }
  }
  const filled: string[] = [];
  const value = (name: string, kind: 'color' | 'length' = 'color'): string | null => {
    const own = legacyValue(name, colors, kind);
    if (own !== null) {
      return own;
    }
    for (const alt of LEGACY_FALLBACKS[name] ?? []) {
      const v = legacyValue(alt, colors, kind);
      if (v !== null) {
        filled.push(name);
        return v;
      }
    }
    return null;
  };
  const color = (name: string) => {
    const v = value(name);
    return v ? parseColor(v) : null;
  };

  const listBg = color('--fnf-table-bg-color') ?? WHITE;
  const isDark = luminance(listBg) < 0.2;
  const base = (isDark ? dark : light).tokens;
  const listFg = color('--fnf-table-fg-color') ?? bestOn(listBg);
  const cursorBg = color('--fnf-table-focused-row-bg-color') ?? listFg;

  // 1. base scheme (its var() chains follow the mapped values), 2. derived, 3. mapped
  const tokens: Record<string, string> = { ...base };
  const muted = formatColor(mix(listFg, listBg, 0.3));
  Object.assign(tokens, {
    '--color-surface-raised': formatColor(mix(listBg, listFg, 0.06)),
    '--color-border': formatColor(mix(listBg, listFg, 0.25)),
    '--color-muted': muted,
    '--color-hidden-text': muted,
    '--color-cursor-inactive-bg': formatColor(mix(listBg, cursorBg, 0.3)),
    // every other duplicate group (design 016 E6) – the old version had no such rows
    '--color-group-alt-bg': formatColor(mix(listBg, listFg, 0.05)),
    '--color-cursor-inactive-text': formatColor(listFg),
  });
  // marked under the cursor: between the marked colour and the cursor text (the old version showed only the cursor)
  const marked = color('--fnf-activepanel-table-selected-row-fg-color');
  const cursorFg = color('--fnf-table-focused-row-fg-color');
  if (marked && cursorFg) {
    tokens['--color-cursor-marked-text'] = formatColor(mix(marked, cursorFg, 0.5));
  }
  const accent = color('--fnf-material-primary-color');
  if (accent) {
    tokens['--color-accent-text'] = formatColor(bestOn(accent));
  }
  const danger = color('--fnf-dialog-button-warn-bg-color') ?? color('--fnf-material-warn-color');
  if (danger) {
    tokens['--color-on-danger'] = formatColor(bestOn(danger));
  }
  const primary = color('--fnf-dialog-button-primary-bg-color');
  if (primary) {
    tokens['--color-button-primary-text'] = formatColor(bestOn(primary));
  }

  const mapped = new Set<string>();
  for (const lv of LEGACY_VARS) {
    if (!lv.tokens.length || (lv.requires && legacyValue(lv.requires, colors, 'color') === null)) {
      continue;
    }
    const kind = lv.name === '--fnf-table-font-size' ? 'length' : 'color';
    const val = value(lv.name, kind);
    if (val === null) {
      continue;
    }
    for (const t of lv.tokens) {
      tokens[t] = val;
      mapped.add(t);
    }
  }

  // flatten the colour tokens to literals (the correction changes single tokens)
  const flat: Record<string, string> = {};
  for (const t of TOKENS) {
    const raw = tokens[t.name];
    if (t.kind === 'color') {
      const c = parseColor(resolveValue(t.name, tokens) ?? '');
      flat[t.name] = c ? formatColor(c) : raw;
    } else {
      flat[t.name] = raw;
    }
  }
  const { tokens: fixed, adjustments } = fixContrast(flat);

  // old variables without a token stay (export in the old format); unknown ones too
  const unknown = Object.keys(colors).filter((k) => !LEGACY_VAR_NAMES.has(k));
  const kept: Record<string, string> = {};
  for (const lv of LEGACY_VARS) {
    if (!lv.tokens.length && colors[lv.name] !== undefined) {
      kept[lv.name] = colors[lv.name];
    }
  }
  for (const k of unknown) {
    kept[k] = colors[k];
  }
  return {
    dark: isDark,
    tokens: { ...fixed, ...kept },
    unknown,
    filled,
    adjustments,
    original: flat,
  };
}

/** Is this an old `{ name, colors }` file? */
export function isLegacyFile(
  raw: unknown,
): raw is { name?: unknown; colors: Record<string, unknown> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }
  const o = raw as Record<string, unknown>;
  return (
    o['tokens'] === undefined &&
    !!o['colors'] &&
    typeof o['colors'] === 'object' &&
    !Array.isArray(o['colors'])
  );
}

/** A scheme in the old format (`{ name, colors }`), e.g. for the old version or other users. */
export function toLegacyFile(
  name: string,
  tokens: Readonly<Record<string, string>>,
): { name: string; colors: Record<string, string> } {
  const colors: Record<string, string> = {};
  for (const lv of LEGACY_VARS) {
    const token = lv.tokens[0];
    if (token) {
      const resolved = resolveValue(token, tokens);
      const c = resolved === null ? null : parseColor(resolved);
      const val = c ? (c.a >= 1 ? toHex(c) : formatColor(c)) : resolved;
      if (val !== null) {
        colors[lv.name] = lv.name === '--fnf-header-input-border' ? `solid 1px ${val}` : val;
      }
    } else if (tokens[lv.name] !== undefined) {
      colors[lv.name] = tokens[lv.name];
    }
  }
  for (const [k, val] of Object.entries(tokens)) {
    if (k.startsWith('--fnf-') && colors[k] === undefined) {
      colors[k] = val;
    }
  }
  return { name, colors };
}
