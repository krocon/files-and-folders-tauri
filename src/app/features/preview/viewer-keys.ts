/** Where a key went: the focused element's tag and whether it is in the toolbar. */
export interface KeyTarget {
  readonly tagName: string;
  readonly inToolbar: boolean;
}

/**
 * File step of a key in the viewer (1 next, -1 previous, `null` none). Space
 * on a focused button presses the button, ←/→ in the toolbar move between its
 * controls – neither steps through the files (review 5).
 */
export function viewerStepFor(key: string, target: KeyTarget): 1 | -1 | null {
  switch (key) {
    case 'Space':
      return target.tagName === 'BUTTON' ? null : 1;
    case 'ArrowRight':
      return target.inToolbar ? null : 1;
    case 'ArrowLeft':
      return target.inToolbar ? null : -1;
    case 'Backspace':
      return -1;
    default:
      return null;
  }
}
