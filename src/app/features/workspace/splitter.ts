import { SPLITTER_MAX, SPLITTER_MIN } from './workspace.store';

/** Step of the arrow keys on the splitter (share of the width). */
export const SPLITTER_STEP = 0.02;

/**
 * New splitter ratio for a key on the separator (APG window splitter):
 * ←/→ move by a step, Pos1/Ende to the limits, Enter = 50 / 50.
 * `null` = key not handled.
 */
export function splitterKey(ratio: number, key: string): number | null {
  switch (key) {
    case 'ArrowLeft':
      return Math.max(SPLITTER_MIN, round(ratio - SPLITTER_STEP));
    case 'ArrowRight':
      return Math.min(SPLITTER_MAX, round(ratio + SPLITTER_STEP));
    case 'Home':
      return SPLITTER_MIN;
    case 'End':
      return SPLITTER_MAX;
    case 'Enter':
      return 0.5;
    default:
      return null;
  }
}

/** Ratio for a pointer position inside the grid (`left`/`width` of the grid box). */
export function splitterFromPointer(clientX: number, left: number, width: number): number {
  if (width <= 0) {
    return 0.5;
  }
  return Math.min(SPLITTER_MAX, Math.max(SPLITTER_MIN, (clientX - left) / width));
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
