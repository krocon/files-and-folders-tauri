import { luminance, Rgba, toHex } from './color';
import { CONTRAST_PAIRS, ContrastPair, pairRatio, resolveColor } from './theme-logic';

/**
 * Minimal contrast corrections (design 019 E4): a colour that misses its WCAG
 * pair is darkened or lightened (mixed towards black or white in sRGB) just
 * enough to pass. Used for the old designs (built-in and imported), so an old
 * file always yields the same scheme. Pure; expects literal colour values for
 * the tokens it touches (a `var()` there is replaced by the corrected colour).
 */
export interface ContrastAdjustment {
  readonly token: string;
  readonly from: string;
  readonly to: string;
  /** Labels of the pairs that needed it. */
  readonly pairs: readonly string[];
}

/**
 * Backgrounds that move instead of the text: a highlight behind text that has
 * to work on the plain list too (row under the mouse, search hits).
 */
export const ADJUST_BACKGROUND: ReadonlySet<string> = new Set([
  '--color-row-hover',
  '--color-search-hit',
  '--color-cursor-inactive-bg',
]);

/**
 * Texts and lines that serve a background (text on accent, marked under the
 * cursor, focus rings …): they move, the background only when they cannot pass.
 */
export const ADJUST_FOREGROUND: ReadonlySet<string> = new Set([
  '--color-accent-text',
  '--color-button-primary-text',
  '--color-on-danger',
  '--color-cursor-marked-text',
  '--color-cursor-inactive-text',
  '--color-favorite',
  '--color-focus',
  '--color-header-focus',
  '--color-footer-focus',
  '--color-dialog-focus',
  '--color-active-panel-accent',
]);

/** Window and list backgrounds never move – everything else is painted on them. */
export const PROTECTED: ReadonlySet<string> = new Set([
  '--color-bg',
  '--color-surface',
  '--color-list-bg',
  '--color-active-list-bg',
]);

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
/** Head room above the minimum, so rounded channels still pass. */
const MARGIN = 0.05;
const MAX_ROUNDS = 12;

function mix(c: Rgba, to: Rgba, t: number): Rgba {
  const m = (a: number, b: number) => Math.round(a + (b - a) * t);
  return { r: m(c.r, to.r), g: m(c.g, to.g), b: m(c.b, to.b), a: c.a };
}

/** `#rrggbb`, or `rgb(r g b / a)` for translucent colours. */
export function formatColor(c: Rgba): string {
  if (c.a >= 1) {
    return toHex(c);
  }
  return `rgb(${c.r} ${c.g} ${c.b} / ${Math.round(c.a * 1000) / 1000})`;
}

export function fixContrast(
  input: Readonly<Record<string, string>>,
  pairs: readonly ContrastPair[] = CONTRAST_PAIRS,
): { tokens: Record<string, string>; adjustments: ContrastAdjustment[] } {
  const tokens: Record<string, string> = { ...input };
  const from = new Map<string, string>();
  const why = new Map<string, Set<string>>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    for (const pair of pairs) {
      const ratio = pairRatio(pair, tokens);
      if (ratio === null || ratio >= pair.min) {
        continue;
      }
      const options = [pair.fg, pair.bg]
        .filter((n) => !PROTECTED.has(n))
        .map((name) => ({
          name,
          ...candidate(
            tokens,
            pair,
            name,
            ADJUST_BACKGROUND.has(name) ? towardsList(tokens) : null,
          ),
        }))
        .filter((o) => o.value !== null);
      const fg = options.find((o) => o.name === pair.fg);
      const bg = options.find((o) => o.name === pair.bg);
      let pick: (typeof options)[number] | undefined;
      if (ADJUST_BACKGROUND.has(pair.bg)) {
        pick = bg?.passes || !fg ? bg : fg;
      } else if (ADJUST_FOREGROUND.has(pair.fg)) {
        pick = fg?.passes || !bg ? fg : bg;
      } else {
        // the smallest change that passes; if none passes, push the text as far as it goes
        pick = options.filter((o) => o.passes).sort((a, b) => a.delta - b.delta)[0] ?? fg ?? bg;
      }
      if (!pick || pick.value === null) {
        continue;
      }
      if (!from.has(pick.name)) {
        from.set(pick.name, tokens[pick.name]);
      }
      tokens[pick.name] = pick.value;
      (why.get(pick.name) ?? why.set(pick.name, new Set()).get(pick.name)!).add(pair.label);
      changed = true;
    }
    if (!changed) {
      break;
    }
  }
  const adjustments = [...from.entries()]
    .filter(([name, before]) => tokens[name] !== before)
    .map(([token, before]) => ({
      token,
      from: before,
      to: tokens[token],
      pairs: [...(why.get(token) ?? [])],
    }));
  return { tokens, adjustments };
}

/** Highlights stay close to the list: on a dark list they get darker, on a light one lighter. */
function towardsList(tokens: Readonly<Record<string, string>>): Rgba {
  const list = resolveColor('--color-list-bg', tokens);
  return list && luminance(list) < 0.2 ? BLACK : WHITE;
}

/**
 * The colour for `name` (towards black or white) that just passes `pair`, or the
 * extreme when nothing passes; `value: null` = no change possible.
 */
function candidate(
  tokens: Record<string, string>,
  pair: ContrastPair,
  name: string,
  only: Rgba | null,
): { value: string | null; delta: number; passes: boolean } {
  const start = resolveColor(name, tokens);
  if (!start) {
    return { value: null, delta: 0, passes: false };
  }
  const original = tokens[name];
  const target = pair.min + MARGIN;
  const ratioWith = (c: Rgba) => {
    tokens[name] = formatColor(c);
    return pairRatio(pair, tokens) ?? 0;
  };
  try {
    // the nearest passing colour towards black or white; else the better extreme
    let best: Rgba | null = null;
    let bestDelta = Infinity;
    let fallback = mix(start, BLACK, 1);
    let fallbackRatio = -1;
    for (const extreme of only ? [only] : [BLACK, WHITE]) {
      const full = mix(start, extreme, 1);
      const r = ratioWith(full);
      if (r > fallbackRatio) {
        fallback = full;
        fallbackRatio = r;
      }
      if (r < target) {
        continue;
      }
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (ratioWith(mix(start, extreme, mid)) >= target) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      const c = mix(start, extreme, hi);
      const d = Math.hypot(c.r - start.r, c.g - start.g, c.b - start.b);
      if (d < bestDelta) {
        best = c;
        bestDelta = d;
      }
    }
    const passes = best !== null;
    const chosen = best ?? fallback;
    const value = formatColor(chosen);
    if (value === formatColor(start)) {
      return { value: null, delta: 0, passes: false };
    }
    const delta = Math.hypot(chosen.r - start.r, chosen.g - start.g, chosen.b - start.b);
    return { value, delta, passes };
  } finally {
    tokens[name] = original;
  }
}
