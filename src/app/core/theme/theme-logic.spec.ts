import { describe, expect, it } from 'vitest';
import { DARK, LIGHT } from './builtin-themes';
import {
  checkContrast,
  completeTokens,
  diffTokens,
  guessDark,
  isColorValue,
  isSafeValue,
  newThemeId,
  normalizeImport,
  resolveColor,
  resolveValue,
  sanitizeTokens,
  tokenKind,
  tokenValueOk,
  uniqueName,
} from './theme-logic';

describe('theme logic', () => {
  it('follows var() chains, with fallbacks, and stops at cycles', () => {
    const t = {
      '--a': 'var(--b)',
      '--b': ' var( --c ) ',
      '--c': '#123456',
      '--d': 'var(--missing, #fff)',
      '--x': 'var(--y)',
      '--y': 'var(--x)',
    };
    expect(resolveValue('--a', t)).toBe('#123456');
    expect(resolveValue('--d', t)).toBe('#fff');
    expect(resolveValue('--x', t)).toBeNull();
    expect(resolveValue('--nope', t)).toBeNull();
    expect(resolveColor('--a', t)).toEqual({ r: 18, g: 52, b: 86, a: 1 });
  });

  it('accepts harmless values only (same rule as Rust value_ok)', () => {
    for (const ok of ['#fff', 'rgb(0 0 0 / 25%)', 'var(--x)', "system-ui, 'Segoe UI'", '13px']) {
      expect(isSafeValue(ok), ok).toBe(true);
    }
    for (const bad of [
      '',
      'red; color: blue',
      'url(x)',
      'IMAGE-SET(x)',
      '}a{',
      '<b>',
      '\\66',
      '@import',
      'a\nb',
      'a\u0085b', // C1 control (NEL), as Rust char::is_control (review 013 #8)
      'a\u009fb',
      'x'.repeat(201),
    ]) {
      expect(isSafeValue(bad), bad).toBe(false);
    }
  });

  it('accepts colours and var() references as colour values', () => {
    expect(isColorValue('#2c5bb8')).toBe(true);
    expect(isColorValue('var(--color-bg)')).toBe(true);
    expect(isColorValue('rgb(0 0 0 / 50%)')).toBe(true);
    expect(isColorValue('#2c5bb80')).toBe(false);
    expect(isColorValue('inherit')).toBe(false);
  });

  it('sanitizes token maps and reports what it dropped', () => {
    const r = sanitizeTokens({
      '--color-bg': ' #fff ',
      '--color-text': 'url(x)',
      nope: '#000',
      '--color-n': 3,
      '--focus-ring-width': '0',
    });
    expect(r.tokens).toEqual({ '--color-bg': '#fff' });
    expect(r.dropped.sort()).toEqual(['--color-n', '--color-text', '--focus-ring-width', 'nope']);
    expect(sanitizeTokens([1]).tokens).toEqual({});
  });

  it('accepts only catalog tokens (+ --fnf-* of old files) with a value of their kind (review 013 #1)', () => {
    expect(tokenKind('--color-bg')).toBe('color');
    expect(tokenKind('--font-size-list')).toBe('length');
    expect(tokenKind('--font-list')).toBe('font');
    expect(tokenKind('--shadow-popup')).toBe('shadow');
    expect(tokenKind('--fnf-table-bg-color')).toBe('legacy');
    // layout variables are never theme tokens
    for (const [name, value] of [
      ['--focus-ring-width', '0'],
      ['--font-size-md', '0px'],
      ['--spacing-2', '0'],
      ['--radius-md', '99px'],
      ['--border-width', '0'],
    ]) {
      expect(tokenKind(name), name).toBeNull();
      expect(tokenValueOk(name, value), name).toBe(false);
    }
    const ok: [string, string][] = [
      ['--color-bg', '#fff'],
      ['--color-marked-bg', 'transparent'],
      ['--color-backdrop', 'rgb(0 0 0 / 25%)'],
      ['--color-list-bg', 'var(--color-surface)'],
      ['--color-list-bg', 'var(--color-x, #fff)'],
      ['--font-size-list', '13px'],
      ['--font-size-list', '0.8125rem'],
      ['--font-size-list', 'var(--font-size-sm)'],
      ['--font-list', "system-ui, 'Segoe UI', sans-serif"],
      ['--font-list', '"JetBrains Mono", Menlo, monospace'],
      ['--font-list', 'var(--font-sans)'],
      ['--shadow-popup', '0 4px 16px rgb(0 0 0 / 18%)'],
      ['--shadow-popup', 'none'],
      ['--shadow-popup', 'inset 0 1px 0 #fff, 0 0 2px var(--color-border)'],
      ['--fnf-table-bg-color', 'rgb(22, 35, 50)'],
    ];
    for (const [name, value] of ok) {
      expect(tokenValueOk(name, value), `${name}: ${value}`).toBe(true);
    }
    const bad: [string, string][] = [
      ['--color-bg', 'inherit'],
      ['--color-bg', '10px'],
      ['--color-bg', 'var(--font-size-md)'],
      ['--color-bg', 'var(--color-x, 10px)'],
      ['--font-size-list', '0px'],
      ['--font-size-list', '2px'],
      ['--font-size-list', '500px'],
      ['--font-size-list', '10vw'],
      ['--font-size-list', 'calc(1px + 1px)'],
      ['--font-size-list', 'var(--color-bg)'],
      ['--font-list', '10px'],
      ['--font-list', 'a, , b'],
      ['--font-list', "'a'b'"],
      ['--font-list', 'var(--color-bg)'],
      ['--shadow-popup', '4px #000'],
      ['--shadow-popup', '0 4px 999px #000'],
      ['--shadow-popup', '0 4px 16px red blue'],
      ['--shadow-popup', 'foo'],
      ['--fnf-x', 'url(x)'],
      ['--other', '#fff'],
    ];
    for (const [name, value] of bad) {
      expect(tokenValueOk(name, value), `${name}: ${value}`).toBe(false);
    }
  });

  it('normalizes own and old ({name, colors}) files', () => {
    const own = normalizeImport({
      name: ' Mein Schema ',
      dark: true,
      tokens: { '--color-bg': '#000', '--fnf-x': '#fff' },
    });
    expect(own).toMatchObject({
      name: 'Mein Schema',
      dark: true,
      legacy: false,
      unknown: ['--fnf-x'],
    });
    const old = normalizeImport({
      name: 'cypress',
      colors: { '--fnf-table-bg-color': 'rgb(22, 35, 50)', '--fnf-header-input-border': 'url(x)' },
    });
    expect(old).toMatchObject({ name: 'cypress', dark: true, legacy: true });
    expect(typeof old !== 'string' && old.dropped).toEqual(['--fnf-header-input-border']);
    expect(normalizeImport([1])).toContain('not a colour scheme');
    expect(normalizeImport({ name: 'x' })).toContain('neither');
    expect(normalizeImport({ tokens: { '--a': 'url(x)' } })).toContain('no usable');
    expect(normalizeImport({ tokens: { '--font-size-md': '0px' } })).toContain('no usable');
    expect(normalizeImport({ tokens: { '--color-bg': '#fff' } })).toMatchObject({
      name: 'Imported',
      dark: false,
    });
  });

  it('guesses dark from the background', () => {
    expect(guessDark({ '--color-list-bg': '#1a1a1a' })).toBe(true);
    expect(guessDark({ '--color-bg': '#f4f5f7' })).toBe(false);
    expect(guessDark({})).toBe(false);
  });

  it('completes and diffs tokens against the built-in scheme of the same brightness', () => {
    const t = completeTokens({ dark: true, tokens: { '--color-bg': '#000' } }, LIGHT, DARK);
    expect(t['--color-bg']).toBe('#000');
    expect(t['--color-text']).toBe(DARK.tokens['--color-text']);
    expect(diffTokens(t, DARK.tokens)).toEqual({ '--color-bg': '#000' });
  });

  it('makes unique ids and names', () => {
    expect(newThemeId('Mein Schöne Schema!', new Set())).toBe('user-mein-schone-schema');
    expect(newThemeId('x', new Set(['user-x', 'user-x-2']))).toBe('user-x-3');
    expect(newThemeId('☕', new Set())).toBe('user-theme');
    expect(uniqueName('Dark', ['Light', 'Dark', 'Dark (2)'])).toBe('Dark (3)');
    expect(uniqueName('  ', [])).toBe('Theme');
  });

  it('reports contrast problems with their ratio, translucent colours over their base', () => {
    const tokens = {
      ...LIGHT.tokens,
      '--color-cursor-bg': '#777777',
      '--color-marked-bg': 'rgb(255 0 0 / 0%)',
    };
    const failed = checkContrast(tokens).filter((r) => !r.ok);
    expect(failed.map((r) => r.pair.label)).toContain('Cursor');
    expect(failed.find((r) => r.pair.label === 'Cursor')?.ratio).toBeCloseTo(4.48, 1);
    expect(failed.map((r) => r.pair.label)).not.toContain('Marked');
    // translucent list backgrounds are mixed on the list, not on the window (review 013 #5)
    const dark = checkContrast({
      ...LIGHT.tokens,
      '--color-bg': '#ffffff',
      '--color-list-bg': '#000000',
      '--color-list-text': '#ffffff',
      '--color-row-hover': 'rgb(255 255 255 / 10%)',
    });
    expect(dark.find((r) => r.pair.label === 'List, row under the mouse')?.ok).toBe(true);
    const broken = checkContrast({ ...LIGHT.tokens, '--color-text': 'inherit' });
    expect(broken.find((r) => r.pair.label === 'Text on the window')).toMatchObject({
      ratio: null,
      ok: false,
    });
  });

  it('checks the active panel, the active header and the focus ring on every area (review 013 #5)', () => {
    const labels = checkContrast(LIGHT.tokens).map((r) => r.pair.label);
    for (const l of [
      'Hidden entries, active panel',
      'Symbolic links, active panel',
      'Unreadable entries, active panel',
      'Active panel list, row under the mouse',
      'Column header, active panel',
      'Tabs, active panel',
      'Focus ring on the panel header',
      'Focus ring on the list',
      'Focus ring in dialogs',
      'Focus ring on the status line',
    ]) {
      expect(labels, l).toContain(l);
    }
    const failed = checkContrast({
      ...LIGHT.tokens,
      '--color-active-list-bg': '#777777',
      '--color-focus': 'var(--color-list-bg)',
    })
      .filter((r) => !r.ok)
      .map((r) => r.pair.label);
    expect(failed).toContain('Hidden entries, active panel');
    expect(failed).toContain('Focus ring on the list');
  });
});
