// @ts-expect-error -- node types are not part of the app's tsconfig; vitest runs in node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, DARK, LIGHT } from './builtin-themes';
import { checkContrast, isSafeValue, resolveColor, tokenValueOk } from './theme-logic';
import { TOKENS } from './tokens';

/** `--name: value;` declarations of a block. */
function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/^\s*(--[a-z0-9-]+):\s*(.+?);\s*$/gm)) {
    out[m[1]] = m[2];
  }
  return out;
}

describe('built-in themes', () => {
  it('define every catalog token with a safe, resolvable value', () => {
    for (const theme of BUILT_IN_THEMES) {
      // the old designs also keep their `--fnf-*` variables without a token (old-format export)
      const own = Object.keys(theme.tokens).filter((k) => !k.startsWith('--fnf-'));
      expect(own.sort(), theme.id).toEqual(TOKENS.map((t) => t.name).sort());
      for (const [name, value] of Object.entries(theme.tokens)) {
        expect(isSafeValue(value), `${theme.id} ${name}`).toBe(true);
        expect(tokenValueOk(name, value), `${theme.id} ${name}: ${value}`).toBe(true);
      }
      for (const t of TOKENS.filter((d) => d.kind === 'color')) {
        expect(resolveColor(t.name, theme.tokens), `${theme.id} ${t.name}`).not.toBeNull();
      }
    }
    expect(LIGHT.dark).toBe(false);
    expect(DARK.dark).toBe(true);
    expect(BUILT_IN_THEMES.map((t) => t.id)).toEqual([
      'classic-light',
      'classic-paper',
      'classic-bitbucket',
      'classic-cypress',
      'classic-blackboard',
      'classic-coffee',
      'classic-combat',
      'classic-norton',
      'light',
      'dark',
    ]);
    expect(new Set(BUILT_IN_THEMES.map((t) => t.name)).size).toBe(BUILT_IN_THEMES.length);
  });

  it('pass the WCAG AA contrast check (list, cursor, marked, header, footer, dialogs)', () => {
    for (const theme of BUILT_IN_THEMES) {
      const failed = checkContrast(theme.tokens)
        .filter((r) => !r.ok)
        .map((r) => `${theme.id}: ${r.pair.label} ${r.ratio?.toFixed(2)} < ${r.pair.min}`);
      expect(failed).toEqual([]);
    }
  });

  it('match the tokens in src/styles.css (light = :root, dark = :root + dark block)', () => {
    const scss = readFileSync('src/styles.css', 'utf8');
    const media = scss.indexOf('@media (prefers-color-scheme: dark)');
    const root = declarations(scss.slice(scss.indexOf(':root {'), media));
    const darkBlock = scss.slice(media, scss.indexOf('\n}\n', media));
    const dark = { ...root, ...declarations(darkBlock) };
    for (const t of TOKENS) {
      expect(LIGHT.tokens[t.name], `light ${t.name}`).toBe(root[t.name]);
      expect(DARK.tokens[t.name], `dark ${t.name}`).toBe(dark[t.name]);
    }
  });
});
