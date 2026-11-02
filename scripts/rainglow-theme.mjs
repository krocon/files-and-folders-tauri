// Rainglow VS Code theme → colour scheme of Files and Folders (prompt 067).
//
//   node scripts/rainglow-theme.mjs <rainglow.json> --id rainglow-<name> --name <Name> [--out <file>]
//
// Rainglow themes (Dayle Rees, MIT) derive every colour from one base in five brightness steps plus three or
// four accents. This script reads those building blocks and maps them onto all our tokens (rest = `dark.json`);
// where a pair misses WCAG AA, the foreground is moved towards white or black in small steps until it passes
// (same formula as `core/theme/color.ts`). The result is a starting point: check it with
// `pnpm screenshots --theme <id>` and correct by hand (see docs/themes.md). Only colour values are taken over.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DARK_JSON = join(ROOT, 'src/app/core/theme/themes/dark.json');

// ---- colours ----

/** `#rgb`, `#rrggbb`, `#rrggbbaa` → [r, g, b] (alpha dropped). */
export function rgb(hex) {
  let h = String(hex).trim().replace(/^#/, '').toLowerCase();
  if (h.length === 3 || h.length === 4) {
    h = [...h.slice(0, 3)].map((c) => c + c).join('');
  }
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) {
    throw new Error(`not a colour: ${hex}`);
  }
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function hex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** `a` mixed with `b`, share `t` of `b` (0 … 1). */
export function mix(a, b, t) {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x.map((v, i) => v + (y[i] - v) * t));
}

function luminance(c) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(c);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `fg` itself when it reaches `min` on every background, else the nearest step towards white or black. */
export function ensure(fg, bgs, min = 4.5) {
  const all = [].concat(bgs);
  const ok = (c) => all.every((bg) => contrast(c, bg) >= min);
  if (ok(fg)) {
    return hex(rgb(fg));
  }
  for (let step = 1; step <= 40; step++) {
    const t = step / 40;
    const lighter = mix(fg, '#ffffff', t);
    const darker = mix(fg, '#000000', t);
    const l = ok(lighter);
    const d = ok(darker);
    if (l && d) {
      return contrast(lighter, all[0]) >= contrast(darker, all[0]) ? lighter : darker;
    }
    if (l || d) {
      return l ? lighter : darker;
    }
  }
  throw new Error(`no colour near ${fg} reaches ${min}:1 on ${all.join(', ')}`);
}

/** White or `dark` – whichever reads better on `bg`; `bg` is darkened until one of them reaches `min`. */
export function onColour(bg, dark, min = 4.5) {
  let back = hex(rgb(bg));
  for (let step = 0; step <= 20; step++) {
    const best = contrast('#ffffff', back) >= contrast(dark, back) ? '#ffffff' : dark;
    if (contrast(best, back) >= min) {
      return { bg: back, text: best };
    }
    back = mix(bg, '#000000', (step + 1) / 40);
  }
  throw new Error(`no readable text on ${bg}`);
}

// ---- reading a Rainglow theme ----

function scopeColour(theme, scope) {
  for (const t of theme.tokenColors ?? []) {
    const scopes = [].concat(t.scope ?? []).flatMap((s) => s.split(','));
    if (scopes.map((s) => s.trim()).includes(scope) && t.settings?.foreground) {
      return t.settings.foreground;
    }
  }
  return undefined;
}

/** The building blocks of a Rainglow theme (prompt 067, table „Aufbau“). */
export function rainglowPalette(theme) {
  const c = theme.colors ?? {};
  const need = (key, value) => {
    if (!value) {
      throw new Error(`Rainglow theme without ${key}`);
    }
    return hex(rgb(value));
  };
  return {
    title: need('titleBar.activeBackground', c['titleBar.activeBackground']),
    input: need('input.background', c['input.background']),
    dropdown: need('dropdown.background', c['dropdown.background']),
    editor: need('editor.background', c['editor.background']),
    activity: need('activityBar.background', c['activityBar.background']),
    hover: need('list.hoverBackground', c['list.hoverBackground']),
    inactiveTab: need('tab.inactiveBackground', c['tab.inactiveBackground']),
    sidebar: need('sideBar.background', c['sideBar.background']),
    section: need('sideBarSectionHeader.background', c['sideBarSectionHeader.background']),
    panel: need('panel.background', c['panel.background']),
    lineNumber: need('editorLineNumber.foreground', c['editorLineNumber.foreground']),
    text: need('editor.foreground', c['editor.foreground']),
    signature: need('statusBar.background', c['statusBar.background']),
    selection: need('list.activeSelectionBackground', c['list.activeSelectionBackground']),
    selectionText: need('list.activeSelectionForeground', c['list.activeSelectionForeground']),
    button: need('button.background', c['button.background']),
    keyword: need('keyword', scopeColour(theme, 'keyword')),
    string: need('string', scopeColour(theme, 'string')),
    number: need('constant.numeric', scopeColour(theme, 'constant.numeric')),
    func: need('entity.name.function', scopeColour(theme, 'entity.name.function')),
    tag: need('entity.name.tag', scopeColour(theme, 'entity.name.tag')),
    red: need('terminal.ansiRed', c['terminal.ansiRed']),
  };
}

// ---- mapping onto our tokens ----

/** All tokens of a scheme from a palette; `overrides` replace single building blocks (e.g. `marked`). */
export function rainglowTokens(p, base, overrides = {}) {
  const o = { marked: p.string, symlink: p.tag, hidden: p.lineNumber, ...overrides };
  const list = p.editor;
  const muted = ensure(p.lineNumber, [p.sidebar, p.panel, p.editor, p.activity]);
  const red = ensure(mix(p.red, '#ffffff', 0.45), [list, p.panel, p.editor]);
  const status = onColour(p.signature, p.title);
  const cursor = onColour(p.selection, p.title);
  const cursorText = contrast(p.selectionText, cursor.bg) >= 4.5 ? p.selectionText : cursor.text;
  const primary = onColour(p.button, p.title);
  const activeTab = onColour(p.signature, p.title);
  const marked = ensure(o.marked, [list, p.section, p.hover]);
  const accent = ensure(p.signature, [p.sidebar, list], 4.5);
  const line = ensure(p.signature, [list, p.sidebar], 3);
  const dangerBg = mix(p.red, list, 0.55);
  const t = {
    '--color-bg': p.sidebar,
    '--color-surface': p.sidebar,
    '--color-surface-raised': p.section,
    '--color-text': ensure(p.text, [p.sidebar, p.panel, p.dropdown, p.input]),
    '--color-muted': muted,
    '--color-border': p.section,
    '--color-accent': accent,
    '--color-accent-text': onColour(accent, p.title).text,
    '--color-focus': line,
    '--color-selection': cursor.bg,
    '--color-selection-text': cursorText,
    '--color-danger': red,
    '--color-on-danger': p.title,
    '--color-danger-bg': dangerBg,
    '--color-danger-text': ensure(mix(p.red, '#ffffff', 0.7), dangerBg),
    '--color-favorite': ensure(p.number, [p.hover], 3),
    '--color-search-hit': mix(p.string, list, 0.8),
    '--color-splitter': p.title,
    '--color-splitter-active': line,
    '--color-menu-bg': p.dropdown,
    '--color-menu-text': 'var(--color-text)',
    '--color-list-bg': list,
    '--color-list-text': ensure(p.text, [list, p.hover, p.inactiveTab, p.activity]),
    '--color-list-border': p.title,
    '--color-list-header-bg': p.activity,
    '--color-list-header-text': muted,
    '--color-row-hover': p.hover,
    '--color-group-alt-bg': p.inactiveTab,
    '--color-diff-added': mix('#3fa34d', list, 0.75),
    '--color-diff-removed': mix(p.red, list, 0.7),
    '--color-diff-changed': mix('#c9a227', list, 0.75),
    '--color-cursor-bg': cursor.bg,
    '--color-cursor-text': cursorText,
    '--color-cursor-inactive-bg': p.section,
    '--color-cursor-inactive-text': 'var(--color-list-text)',
    '--color-marked': marked,
    '--color-marked-bg': 'transparent',
    '--color-cursor-marked-text': ensure(mix(o.marked, p.title, 0.55), cursor.bg),
    '--color-hidden-text': ensure(o.hidden, [list]),
    '--color-symlink-text': ensure(o.symlink, [list]),
    '--color-error-text': red,
    '--color-icon-folder': ensure(p.signature, [list], 3),
    '--color-icon-document': ensure(p.text, [list], 3),
    '--color-icon-image': ensure(p.keyword, [list], 3),
    '--color-icon-video': ensure(mix(p.red, '#ffffff', 0.3), [list], 3),
    '--color-icon-audio': ensure(p.tag, [list], 3),
    '--color-icon-archive': ensure(p.string, [list], 3),
    '--color-icon-code': ensure(p.func, [list], 3),
    '--color-icon-executable': ensure(p.number, [list], 3),
    '--color-active-panel-accent': line,
    '--color-active-panel-tab-bg': activeTab.bg,
    '--color-active-panel-tab-text': activeTab.text,
    '--color-header-bg': p.hover,
    '--color-header-text': 'var(--color-text)',
    '--color-header-border': p.title,
    '--color-header-input-bg': p.input,
    '--color-header-input-text': 'var(--color-text)',
    '--color-header-input-border': p.section,
    '--color-tab-text': ensure(p.lineNumber, [p.hover]),
    '--color-tab-selected-bg': list,
    '--color-tab-selected-text': 'var(--color-list-text)',
    '--color-header-focus': ensure(p.signature, [p.hover], 3),
    '--color-footer-bg': status.bg,
    '--color-footer-text': status.text,
    '--color-status-marked': ensure(o.marked, [status.bg]),
    '--color-footer-border': p.title,
    '--color-footer-button-bg': p.activity,
    '--color-footer-button-text': ensure(p.text, [p.activity]),
    '--color-footer-button-border': p.section,
    '--color-shortcut-bg': p.title,
    '--color-shortcut-text': ensure(o.marked, [p.title]),
    '--color-footer-error-text': ensure(red, [status.bg]),
    '--color-footer-focus': status.text,
    '--color-footer-accent': status.text,
    '--color-badge-bg': p.red,
    '--color-badge-text': onColour(p.red, p.title).text,
    '--color-shell-bg': list,
    '--color-shell-text': 'var(--color-list-text)',
    '--color-shell-prompt': ensure(p.signature, [list]),
    '--color-shell-error-text': red,
    '--color-shell-info-text': ensure(p.func, [list]),
    '--color-shell-border': p.section,
    '--color-dialog-bg': p.panel,
    '--color-dialog-text': ensure(p.text, [p.panel]),
    '--color-dialog-border': p.section,
    '--color-input-bg': p.input,
    '--color-input-text': 'var(--color-text)',
    '--color-input-border': p.section,
    '--color-button-bg': p.activity,
    '--color-button-text': ensure(p.text, [p.activity]),
    '--color-button-border': p.lineNumber,
    '--color-button-primary-bg': primary.bg,
    '--color-button-primary-text': primary.text,
    '--color-dialog-focus': ensure(p.signature, [p.panel], 3),
    '--color-dialog-danger-text': ensure(red, [p.panel]),
    '--color-scrollbar-track': list,
    '--color-scrollbar-thumb': p.lineNumber,
    '--color-scrollbar-thumb-border': list,
    '--color-scrollbar-thumb-active': p.signature,
    '--color-tooltip-bg': p.panel,
    '--color-tooltip-text': ensure(p.text, [p.panel]),
    '--color-tooltip-input-bg': p.input,
    '--color-tooltip-input-text': 'var(--color-text)',
    '--color-usage-1': p.signature,
    '--color-usage-2': p.string,
    '--color-usage-3': p.keyword,
    '--color-usage-4': p.func,
    '--color-usage-5': p.tag,
    '--color-usage-6': p.number,
    '--color-usage-7': p.button,
    '--color-usage-8': p.lineNumber,
    '--color-usage-files': p.lineNumber,
    '--color-usage-rest': p.section,
    '--color-usage-unreadable': p.red,
    '--color-usage-free': p.section,
    '--color-usage-uncounted': p.panel,
    '--color-usage-bar': p.signature,
  };
  const tokens = {};
  for (const key of Object.keys(base)) {
    tokens[key] = t[key] ?? base[key];
  }
  return tokens;
}

/** Theme file (`themes/<id>.json`) of a Rainglow theme. */
export function rainglowScheme(theme, { id, name, overrides } = {}) {
  const base = JSON.parse(readFileSync(DARK_JSON, 'utf8'));
  return {
    id,
    name,
    dark: true,
    tokens: rainglowTokens(rainglowPalette(theme), base.tokens, overrides),
  };
}

function main(argv) {
  const [file, ...rest] = argv;
  const opt = {};
  for (let i = 0; i < rest.length; i += 2) {
    opt[rest[i].replace(/^--/, '')] = rest[i + 1];
  }
  if (!file || !opt.id || !opt.name) {
    console.error(
      'usage: node scripts/rainglow-theme.mjs <rainglow.json> --id <id> --name <name> [--out <file>]',
    );
    process.exit(2);
  }
  const scheme = rainglowScheme(JSON.parse(readFileSync(file, 'utf8')), opt);
  const text = `${JSON.stringify(scheme, null, 2)}\n`;
  if (opt.out) {
    writeFileSync(opt.out, text);
  } else {
    process.stdout.write(text);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
