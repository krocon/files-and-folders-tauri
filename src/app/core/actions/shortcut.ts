import { Platform } from './platform';

/**
 * Keyboard shortcuts in one canonical notation (design 002, D2):
 * `[Mod+][Ctrl+][Alt+][Shift+]<Key>`, chords separated by a space (`Ctrl+K F6`).
 * `Mod` = ⌘ on macOS, Ctrl elsewhere; `Ctrl` is the real Control key on macOS and
 * the same as `Mod` elsewhere (normalised to `Mod`). Keymap strings and keyboard
 * events go through the same functions, so they always compare equal.
 */
export interface Stroke {
  readonly mod: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  /** Canonical key name, e.g. `S`, `5`, `F6`, `Enter`, `NumpadAdd`, `.`. */
  readonly key: string;
}

const NAMED_KEYS = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ContextMenu',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'NumpadDecimal',
  'NumpadEnter',
  'Numpad0',
  'Numpad1',
  'Numpad2',
  'Numpad3',
  'Numpad4',
  'Numpad5',
  'Numpad6',
  'Numpad7',
  'Numpad8',
  'Numpad9',
];
const NAMED = new Map<string, string>(NAMED_KEYS.map((k) => [k.toLowerCase(), k]));
/** Aliases accepted when reading (old notations, legacy §2 / mr §2). */
const ALIASES: Readonly<Record<string, string>> = {
  esc: 'Escape',
  del: 'Delete',
  return: 'Enter',
  ins: 'Insert',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  ' ': 'Space',
  num_add: 'NumpadAdd',
  num_subtract: 'NumpadSubtract',
  num_multiply: 'NumpadMultiply',
  plus: '+',
  minus: '-',
};
/** Punctuation by physical key (US layout names) – used when Shift/Alt change `key`. */
const CODE_PUNCTUATION: Readonly<Record<string, string>> = {
  Period: '.',
  Comma: ',',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};
const MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'Fn',
  'OS',
]);

/** Canonical key name for a token from a keymap string, `null` if unknown. */
export function canonicalKey(token: string): string | null {
  if (token.length === 1) {
    return /[a-z]/i.test(token) ? token.toUpperCase() : token;
  }
  const lower = token.toLowerCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) {
    return lower.toUpperCase();
  }
  return NAMED.get(lower) ?? ALIASES[lower] ?? null;
}

/** Parses one stroke (`Mod+Shift+S`); `null` if it is not a valid shortcut. */
export function parseStroke(text: string, platform: Platform): Stroke | null {
  const raw = text.trim();
  if (!raw) {
    return null;
  }
  // a trailing "+" key is written as "Mod++"
  const parts = raw.endsWith('++') ? [...raw.slice(0, -2).split('+'), '+'] : raw.split('+');
  const keyToken = parts.pop();
  if (keyToken === undefined || keyToken === '') {
    return null;
  }
  let mod = false;
  let ctrl = false;
  let alt = false;
  let shift = false;
  for (const p of parts) {
    switch (p.trim().toLowerCase()) {
      case 'mod':
      case 'cmd':
      case 'meta':
        mod = true;
        break;
      case 'ctrl':
      case 'control':
        if (platform === 'macos') {
          ctrl = true;
        } else {
          mod = true;
        }
        break;
      case 'alt':
      case 'option':
        alt = true;
        break;
      case 'shift':
        shift = true;
        break;
      default:
        return null;
    }
  }
  const key = canonicalKey(keyToken.trim() || keyToken);
  return key ? { mod, ctrl, alt, shift, key } : null;
}

/** Parses a shortcut with optional chord (`Ctrl+K F6`); `null` if invalid. Max. two strokes. */
export function parseShortcut(text: string, platform: Platform): Stroke[] | null {
  const strokes = text
    .trim()
    .split(/\s+/)
    .map((s) => parseStroke(s, platform));
  if (strokes.length === 0 || strokes.length > 2 || strokes.some((s) => s === null)) {
    return null;
  }
  return strokes as Stroke[];
}

export function strokeToString(s: Stroke): string {
  return `${s.mod ? 'Mod+' : ''}${s.ctrl ? 'Ctrl+' : ''}${s.alt ? 'Alt+' : ''}${s.shift ? 'Shift+' : ''}${s.key}`;
}

/** Canonical form of a shortcut string, `null` if invalid. */
export function canonicalShortcut(text: string, platform: Platform): string | null {
  const strokes = parseShortcut(text, platform);
  return strokes ? strokes.map(strokeToString).join(' ') : null;
}

/** The fields of a KeyboardEvent the stroke depends on (testable without DOM). */
export type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

/**
 * Modifier state after a key event. WebKitGTK reports a released modifier as
 * still held in its own `keyup` (the X11 state before the event) – the key
 * that goes up is up (design 012, found in the drag & drop E2E).
 */
export function modifiersAfter(
  evt: KeyEventLike,
  type: string,
): Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> {
  const up = type === 'keyup' ? evt.key : '';
  return {
    ctrlKey: evt.ctrlKey && up !== 'Control',
    metaKey: evt.metaKey && up !== 'Meta' && up !== 'OS',
    altKey: evt.altKey && up !== 'Alt' && up !== 'AltGraph',
    shiftKey: evt.shiftKey && up !== 'Shift',
  };
}

/** Key name of an event (rules of D2), `null` for a lone modifier. */
export function eventKey(evt: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  const { key, code } = evt;
  if (MODIFIER_KEYS.has(key) || (key === 'Dead' && !code)) {
    return null;
  }
  if (code.startsWith('Numpad')) {
    return code === 'NumpadEnter' ? 'Enter' : (NAMED.get(code.toLowerCase()) ?? code);
  }
  if (code.startsWith('Digit')) {
    return code.slice(5);
  }
  if (key.length === 1 && /[a-z]/i.test(key)) {
    return key.toUpperCase();
  }
  if (code.startsWith('Key') && code.length === 4) {
    return code.slice(3); // macOS ⌥ / dead keys change `key`
  }
  if (CODE_PUNCTUATION[code]) {
    return CODE_PUNCTUATION[code];
  }
  if (key === ' ') {
    return 'Space';
  }
  return canonicalKey(key) ?? (key.length === 1 ? key : null);
}

export function strokeFromEvent(evt: KeyEventLike, platform: Platform): Stroke | null {
  const key = eventKey(evt);
  if (key === null) {
    return null;
  }
  const mac = platform === 'macos';
  return {
    mod: mac ? evt.metaKey : evt.ctrlKey || evt.metaKey,
    ctrl: mac ? evt.ctrlKey : false,
    alt: evt.altKey,
    shift: evt.shiftKey,
    key,
  };
}

export function hasCommandModifier(s: Stroke): boolean {
  return s.mod || s.ctrl || s.alt;
}

export function isFunctionKey(key: string): boolean {
  return /^F\d{1,2}$/.test(key);
}

// ---- display ----

const MAC_KEY_SYMBOLS: Readonly<Record<string, string>> = {
  Enter: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: 'Esc',
  Tab: '⇥',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Space: 'Space',
};
const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Delete: 'Del',
  Insert: 'Ins',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  NumpadAdd: 'Num+',
  NumpadSubtract: 'Num−',
  NumpadMultiply: 'Num*',
  NumpadDivide: 'Num/',
  NumpadDecimal: 'Num.',
};

function keyLabel(key: string, platform: Platform): string {
  if (platform === 'macos' && MAC_KEY_SYMBOLS[key]) {
    return MAC_KEY_SYMBOLS[key];
  }
  if (KEY_LABELS[key]) {
    return KEY_LABELS[key];
  }
  return key.startsWith('Numpad') ? `Num${key.slice(6)}` : key;
}

/** Display text: `⌃⌥⇧⌘S` on macOS (Apple order), `Ctrl+Alt+Shift+S` elsewhere. */
export function formatStroke(s: Stroke, platform: Platform): string {
  const key = keyLabel(s.key, platform);
  if (platform === 'macos') {
    return `${s.ctrl ? '⌃' : ''}${s.alt ? '⌥' : ''}${s.shift ? '⇧' : ''}${s.mod ? '⌘' : ''}${key}`;
  }
  return `${s.mod ? 'Ctrl+' : ''}${s.alt ? 'Alt+' : ''}${s.shift ? 'Shift+' : ''}${key}`;
}

export function formatShortcut(text: string, platform: Platform): string {
  const strokes = parseShortcut(text, platform);
  return strokes ? strokes.map((s) => formatStroke(s, platform)).join(' ') : text;
}

export interface HeldModifiers {
  readonly mod: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export const NO_MODIFIERS: HeldModifiers = { mod: false, ctrl: false, alt: false, shift: false };

/**
 * Badge of a button while modifiers are held (mr `getSimplestShortcutsByAction`): the
 * first single-stroke shortcut that contains all held modifiers, shown without them –
 * Shift held → Rename shows `F6` for `Shift+F6`. `''` if none fits.
 */
export function badgeFor(
  shortcuts: readonly string[],
  held: HeldModifiers,
  platform: Platform,
): string {
  const candidates = shortcuts
    .map((s) => parseShortcut(s, platform))
    .filter((s): s is Stroke[] => s !== null && s.length === 1)
    .map((s) => s[0])
    .filter(
      (s) =>
        (!held.mod || s.mod) &&
        (!held.ctrl || s.ctrl) &&
        (!held.alt || s.alt) &&
        (!held.shift || s.shift),
    )
    .map((s) => ({
      ...s,
      mod: s.mod && !held.mod,
      ctrl: s.ctrl && !held.ctrl,
      alt: s.alt && !held.alt,
      shift: s.shift && !held.shift,
    }));
  const plain = candidates.find((s) => !s.mod && !s.ctrl && !s.alt && !s.shift);
  const best = plain ?? candidates[0];
  return best ? formatStroke(best, platform) : '';
}
