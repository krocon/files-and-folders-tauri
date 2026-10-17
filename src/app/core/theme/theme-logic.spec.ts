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
    const r = sanitizeTokens({ '--ok': ' #fff ', '--bad': 'url(x)', nope: '#000', '--n': 3 });
    expect(r.tokens).toEqual({ '--ok': '#fff' });
    expect(r.dropped.sort()).toEqual(['--bad', '--n', 'nope']);
    expect(sanitizeTokens([1]).tokens).toEqual({});
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
    const broken = checkContrast({ ...LIGHT.tokens, '--color-text': 'inherit' });
    expect(broken.find((r) => r.pair.label === 'Text on the window')).toMatchObject({
      ratio: null,
      ok: false,
    });
  });
});
