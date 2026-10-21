import { blend, contrastRatio, parseColor, Rgba, toHex, WHITE } from '../../core/theme/color';
import { Shape } from './chart-layout';

/**
 * Colours of the disk-usage chart (design 033, tokens `--color-usage-*`): one hue
 * per top-level child (8, cyclic), deeper levels lighter towards the surface;
 * fixed colours for aggregates, folded rests, unreadable folders and other drives.
 */
export interface UsagePalette {
  readonly branches: readonly Rgba[];
  readonly files: Rgba;
  readonly rest: Rgba;
  readonly unreadable: Rgba;
  readonly surface: Rgba;
}

export const BRANCH_TOKENS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `--color-usage-${i}`);

const GREY: Rgba = { r: 160, g: 160, b: 160, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/** Reads the palette from the resolved CSS variables (`read(name)` → value). */
export function readPalette(read: (name: string) => string): UsagePalette {
  const c = (name: string, fallback: Rgba) => parseColor(read(name).trim()) ?? fallback;
  const surface = c('--color-list-bg', c('--color-surface', WHITE));
  return {
    branches: BRANCH_TOKENS.map((t) => c(t, GREY)),
    files: c('--color-usage-files', GREY),
    rest: c('--color-usage-rest', GREY),
    unreadable: c('--color-usage-unreadable', GREY),
    surface: surface.a < 1 ? blend(surface, WHITE) : surface,
  };
}

/** Lighter with each level below the first (towards the surface, at most 60 %). */
const FADE_PER_LEVEL = 0.16;

export function fillOf(shape: Shape, p: UsagePalette): Rgba {
  const n = shape.node;
  let base: Rgba;
  if (n.kind === 'files') {
    base = p.files;
  } else if (n.kind === 'rest' || shape.branch < 0) {
    base = p.rest;
  } else if (n.unreadable > 0 && n.kind === 'dir' && n.files === 0 && n.dirs === 0) {
    base = p.unreadable;
  } else if (n.kind === 'mount') {
    base = p.rest;
  } else {
    base = p.branches[shape.branch % p.branches.length];
  }
  const fade = Math.min(0.6, FADE_PER_LEVEL * (shape.depth - 1));
  return fade > 0 ? blend({ ...base, a: 1 - fade }, p.surface) : { ...base, a: 1 };
}

/** Black or white – whichever reads better on `fill`. */
export function labelOn(fill: Rgba): string {
  return contrastRatio(BLACK, fill) >= contrastRatio(WHITE, fill) ? '#000000' : '#ffffff';
}

export function hex(c: Rgba): string {
  return toHex(c);
}
