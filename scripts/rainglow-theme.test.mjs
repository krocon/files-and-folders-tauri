import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  contrast,
  ensure,
  mix,
  onColour,
  rainglowPalette,
  rainglowScheme,
  rgb,
} from './rainglow-theme.mjs';

/** A minimal Rainglow theme with the building blocks of „bold“ (colour values only). */
const BOLD = {
  name: 'bold',
  type: 'dark',
  colors: {
    'titleBar.activeBackground': '#1f1c1c',
    'input.background': '#1d1a1a',
    'dropdown.background': '#252121',
    'editor.background': '#2a2626',
    'activityBar.background': '#2f2b2b',
    'list.hoverBackground': '#322d2d',
    'tab.inactiveBackground': '#353030',
    'sideBar.background': '#373232',
    'sideBarSectionHeader.background': '#3f3939',
    'panel.background': '#453e3e',
    'editorLineNumber.foreground': '#605656',
    'editor.foreground': '#ffffff',
    'statusBar.background': '#3d8e91',
    'list.activeSelectionBackground': '#f0624b',
    'list.activeSelectionForeground': '#2a2626',
    'button.background': '#f0624b',
    'terminal.ansiRed': '#ba0e2e',
  },
  tokenColors: [
    { scope: 'comment', settings: { foreground: '#534b4b' } },
    { scope: 'string', settings: { foreground: '#f7a21b' } },
    { scope: 'constant.numeric', settings: { foreground: '#f7a21b' } },
    { scope: 'keyword', settings: { foreground: '#f0624b' } },
    { scope: 'entity.name.function', settings: { foreground: '#b4b7ad' } },
    { scope: ['entity.name.tag', 'meta.tag'], settings: { foreground: '#3d8e91' } },
  ],
};

test('colour helpers', () => {
  assert.deepEqual(rgb('#fff'), [255, 255, 255]);
  assert.deepEqual(rgb('#605656aa'), [96, 86, 86]);
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(contrast('#ffffff', '#000000').toFixed(0), '21');
  assert.throws(() => rgb('red'));
});

test('ensure keeps a passing colour and nudges a weak one until it passes', () => {
  assert.equal(ensure('#ffffff', '#2a2626'), '#ffffff');
  const muted = ensure('#605656', ['#373232', '#453e3e']);
  assert.ok(contrast(muted, '#373232') >= 4.5 && contrast(muted, '#453e3e') >= 4.5);
  const onLight = ensure('#cccccc', '#ffffff', 3);
  assert.ok(contrast(onLight, '#ffffff') >= 3);
});

test('onColour picks white or the dark text and darkens the area when neither reads', () => {
  assert.deepEqual(onColour('#585480', '#121218'), { bg: '#585480', text: '#ffffff' });
  assert.equal(onColour('#95cc5e', '#2b2723').text, '#2b2723');
  const teal = onColour('#3d8e91', '#1f1c1c');
  assert.ok(contrast(teal.text, teal.bg) >= 4.5);
});

test('reads the building blocks of a Rainglow theme', () => {
  const p = rainglowPalette(BOLD);
  assert.equal(p.editor, '#2a2626');
  assert.equal(p.signature, '#3d8e91');
  assert.equal(p.string, '#f7a21b');
  assert.equal(p.tag, '#3d8e91');
  assert.throws(() => rainglowPalette({ colors: {} }), /titleBar/);
});

test('maps onto every token of dark.json in the same order, with the scheme character', () => {
  const dark = JSON.parse(readFileSync('src/app/core/theme/themes/dark.json', 'utf8'));
  const s = rainglowScheme(BOLD, { id: 'rainglow-bold', name: 'Bold (Rainglow)' });
  assert.equal(s.id, 'rainglow-bold');
  assert.equal(s.dark, true);
  assert.deepEqual(Object.keys(s.tokens), Object.keys(dark.tokens));
  assert.equal(s.tokens['--color-list-bg'], '#2a2626');
  assert.equal(s.tokens['--color-surface'], '#373232');
  assert.equal(s.tokens['--color-cursor-bg'], '#f0624b');
  assert.equal(s.tokens['--color-marked'], '#f7a21b');
  assert.ok(contrast(s.tokens['--color-footer-text'], s.tokens['--color-footer-bg']) >= 4.5);
  const marked = rainglowScheme(BOLD, { id: 'x', name: 'X', overrides: { marked: '#e6db74' } });
  assert.equal(marked.tokens['--color-marked'], '#e6db74');
});

test('the shipped Rainglow schemes are what the script produces', () => {
  const s = rainglowScheme(BOLD, { id: 'rainglow-bold', name: 'Bold (Rainglow)' });
  const shipped = JSON.parse(
    readFileSync('src/app/core/theme/themes/rainglow-bold.json', 'utf8'),
  );
  assert.deepEqual(s, shipped);
});
