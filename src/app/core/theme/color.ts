/**
 * Small colour helpers for the theme editor and the WCAG contrast check
 * (design 013 E7). Pure functions, no DOM.
 */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0–1 */
  readonly a: number;
}

const NAMED: Readonly<Record<string, string>> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  navy: '#000080',
  teal: '#008080',
  purple: '#800080',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  cyan: '#00ffff',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  transparent: '#00000000',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)%?$/;

/** Parses `#rgb[a]`, `#rrggbb[aa]`, `rgb()/rgba()` (comma or space syntax) and basic names; else `null`. */
export function parseColor(input: string): Rgba | null {
  const v = input.trim().toLowerCase();
  if (NAMED[v]) {
    return parseColor(NAMED[v]);
  }
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) {
      h = [...h].map((c) => c + c).join('');
    }
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\((.*)\)$/.exec(v);
  if (!fn) {
    return null;
  }
  const [channels, alphaPart] = fn[1].includes('/') ? fn[1].split('/') : [fn[1], undefined];
  let parts = channels
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  let alpha = alphaPart?.trim();
  if (alpha === undefined && parts.length === 4) {
    alpha = parts[3];
    parts = parts.slice(0, 3);
  }
  if (parts.length !== 3) {
    return null;
  }
  // strict numbers (as Rust `css_number`): `12abc` is no channel
  if (!parts.every((p) => NUMBER.test(p)) || (alpha !== undefined && !NUMBER.test(alpha))) {
    return null;
  }
  const ch = parts.map((p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p)));
  let a = 1;
  if (alpha !== undefined) {
    a = alpha.endsWith('%') ? parseFloat(alpha) / 100 : parseFloat(alpha);
  }
  return {
    r: clamp(Math.round(ch[0]), 0, 255),
    g: clamp(Math.round(ch[1]), 0, 255),
    b: clamp(Math.round(ch[2]), 0, 255),
    a: clamp(a, 0, 1),
  };
}

/** `fg` painted over an opaque `bg`. */
export function blend(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  const mix = (f: number, b: number) => Math.round(f * a + b * (1 - a));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

/** WCAG 2.x relative luminance of an opaque colour. */
export function luminance(c: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/**
 * Contrast ratio (1–21) of `fg` on `bg`; translucent colours are painted on
 * `base` first (bg on base, then fg on the result).
 */
export function contrastRatio(fg: Rgba, bg: Rgba, base: Rgba = WHITE): number {
  const back = bg.a < 1 ? blend(bg, base.a < 1 ? blend(base, WHITE) : base) : bg;
  const front = fg.a < 1 ? blend(fg, back) : fg;
  const l1 = luminance(front);
  const l2 = luminance(back);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** `#rrggbb` (alpha dropped) – for `<input type="color">`. */
export function toHex(c: Rgba): string {
  const h = (v: number) => v.toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/**
 * The value for a colour chosen in `<input type="color">` (`#rrggbb`): keeps the
 * alpha of the previous colour (`rgb(r g b / a)`), review 013 #7.
 */
export function pickedColor(hex: string, previous: Rgba | null): string {
  const c = parseColor(hex);
  if (!c || !previous || previous.a >= 1) {
    return hex;
  }
  const a = Math.round(previous.a * 1000) / 1000;
  return `rgb(${c.r} ${c.g} ${c.b} / ${a})`;
}
