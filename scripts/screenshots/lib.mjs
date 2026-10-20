// Pure helpers of the screenshot run (tested in scripts/screenshots.test.mjs).

/** Key names of the keymap notation → Playwright key names (US layout). */
const KEY_NAMES = new Map([
  [',', 'Comma'],
  ['.', 'Period'],
  ['/', 'Slash'],
  [';', 'Semicolon'],
  ['=', 'Equal'],
  ['-', 'Minus'],
  ['[', 'BracketLeft'],
  [']', 'BracketRight'],
  ['\\', 'Backslash'],
  ["'", 'Quote'],
  ['`', 'Backquote'],
  ['Esc', 'Escape'],
  ['Del', 'Delete'],
  ['Return', 'Enter'],
  ['Up', 'ArrowUp'],
  ['Down', 'ArrowDown'],
  ['Left', 'ArrowLeft'],
  ['Right', 'ArrowRight'],
]);

/**
 * One binding of a keymap (`Mod+Shift+K`, chords separated by a space: `Mod+K F6`)
 * → Playwright `keyboard.press` strings, one per stroke. `Mod` is ⌘ on macOS and
 * Ctrl elsewhere (same rule as src/app/core/actions/shortcut.ts).
 */
export function toPlaywrightStrokes(binding, platform) {
  return binding
    .trim()
    .split(/\s+/)
    .map((stroke) => {
      // `Mod++` would mean the plus key – the keymaps use `NumpadAdd`/`Equal` instead
      const parts = stroke.split('+');
      const key = parts.pop();
      const mods = parts.map((m) => {
        switch (m.toLowerCase()) {
          case 'mod':
            return platform === 'macos' ? 'Meta' : 'Control';
          case 'ctrl':
          case 'control':
            return 'Control';
          case 'cmd':
          case 'meta':
            return 'Meta';
          case 'alt':
          case 'option':
            return 'Alt';
          case 'shift':
            return 'Shift';
          default:
            throw new Error(`unknown modifier "${m}" in "${binding}"`);
        }
      });
      return [...mods, keyName(key)].join('+');
    });
}

function keyName(key) {
  if (KEY_NAMES.has(key)) return KEY_NAMES.get(key);
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key; // F1…F24, Enter, Space, ArrowUp, NumpadAdd, …
}

/** First binding of `actionId` in a keymap JSON (`{ ID: ["Mod+A", …] }`), or null. */
export function firstBinding(keymap, actionId) {
  const list = keymap[actionId];
  return Array.isArray(list) && list.length > 0 ? list[0] : null;
}

/**
 * English label of an action from the source of action-catalog.ts
 * (`ID: m('Label…', …)`), without a trailing ellipsis – what the command palette
 * finds. Null if the id is not in the catalog.
 */
export function actionLabel(catalogSource, actionId) {
  const re = new RegExp(`^\\s*${actionId}:\\s*m\\(\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'm');
  const match = re.exec(catalogSource);
  return match ? match[1].replace(/\\'/g, "'").replace(/…$/, '') : null;
}

/** `--theme a,b` / `--scene x` style list options; empty or missing = all. */
export function pick(all, wanted, what) {
  if (!wanted || wanted.length === 0) return all;
  const unknown = wanted.filter((w) => !all.includes(w));
  if (unknown.length > 0) {
    throw new Error(`unknown ${what}: ${unknown.join(', ')} (known: ${all.join(', ')})`);
  }
  return all.filter((a) => wanted.includes(a));
}

/** Minimal argv parser: `--key value`, `--key=value`, `--flag`. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument "${arg}"`);
    const eq = arg.indexOf('=');
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out[arg.slice(2)] = argv[++i];
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}

/** Comma separated option → list (trimmed, without empties). */
export function list(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
