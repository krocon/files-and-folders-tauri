import { Platform } from './platform';
import { parseShortcut, Stroke } from './shortcut';

/**
 * Shortcut badges like the old version (mr §1.10, design 020 E2): one badge per
 * stroke of a chord, tokens `^` (Control), `⌘` (Command), `alt` (literally, as in
 * mr), `⇧` (Shift) and the key in lower case (`f5`, `down`, `space`, `+`).
 * Order: ^ ⌘ alt ⇧ key. `Mod` is ⌘ on macOS and ^ elsewhere.
 */
const KEY_TOKENS: Readonly<Record<string, string>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Escape: 'esc',
  Delete: 'del',
  Insert: 'ins',
  PageUp: 'pgup',
  PageDown: 'pgdn',
  ContextMenu: 'menu',
  NumpadAdd: '+',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/',
  NumpadDecimal: '.',
  NumpadEnter: 'enter',
};

function keyToken(key: string): string {
  if (KEY_TOKENS[key]) {
    return KEY_TOKENS[key];
  }
  if (key.startsWith('Numpad')) {
    return key.slice(6);
  }
  return key.toLowerCase();
}

/** Tokens of one stroke (`["^", "⌘", "g"]`). */
export function strokeTokens(s: Stroke, platform: Platform): string[] {
  const mac = platform === 'macos';
  const out: string[] = [];
  if (s.ctrl || (s.mod && !mac)) {
    out.push('^');
  }
  if (s.mod && mac) {
    out.push('⌘');
  }
  if (s.alt) {
    out.push('alt');
  }
  if (s.shift) {
    out.push('⇧');
  }
  out.push(keyToken(s.key));
  return out;
}

/** Badges of a shortcut: one token list per stroke; `[]` if empty or invalid. */
export function badgeStrokes(text: string | null | undefined, platform: Platform): string[][] {
  if (!text?.trim()) {
    return [];
  }
  const strokes = parseShortcut(text, platform);
  return strokes ? strokes.map((s) => strokeTokens(s, platform)) : [];
}
