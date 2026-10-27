// Tests of the screenshot helpers (scripts/screenshots/) – node --test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildDemoFs, demoPhotoSvg, treeFromPaths } from './screenshots/demo-fs.mjs';
import { actionLabel, firstBinding, list, parseArgs, pick, toPlaywrightStrokes } from './screenshots/lib.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const keymap = (os) =>
  JSON.parse(readFileSync(new URL(`../src/app/core/actions/keymaps/${os}.json`, import.meta.url), 'utf8'));

test('keymap notation → Playwright strokes', () => {
  assert.deepEqual(toPlaywrightStrokes('Mod+F12', 'linux'), ['Control+F12']);
  assert.deepEqual(toPlaywrightStrokes('Mod+F12', 'macos'), ['Meta+F12']);
  assert.deepEqual(toPlaywrightStrokes('Mod+Shift+K', 'windows'), ['Control+Shift+KeyK']);
  assert.deepEqual(toPlaywrightStrokes('Alt+1', 'linux'), ['Alt+Digit1']);
  assert.deepEqual(toPlaywrightStrokes('Mod+,', 'linux'), ['Control+Comma']);
  assert.deepEqual(toPlaywrightStrokes('Ctrl+K F6', 'macos'), ['Control+KeyK', 'F6']);
  assert.deepEqual(toPlaywrightStrokes('Space', 'linux'), ['Space']);
  assert.throws(() => toPlaywrightStrokes('Hyper+A', 'linux'), /unknown modifier/);
});

test('every binding of every keymap converts', () => {
  for (const os of ['linux', 'windows', 'macos']) {
    for (const [id, bindings] of Object.entries(keymap(os))) {
      for (const b of bindings) {
        assert.doesNotThrow(() => toPlaywrightStrokes(b, os), `${os} ${id} ${b}`);
      }
    }
  }
});

test('every action of scenes.json exists (shortcut or catalog label)', () => {
  const scenes = JSON.parse(readFileSync(new URL('./screenshots/scenes.json', import.meta.url), 'utf8'));
  const catalog = readFileSync(new URL('../src/app/core/actions/action-catalog.ts', import.meta.url), 'utf8');
  const steps = [...scenes.prelude, ...scenes.scenes.flatMap((s) => s.steps)];
  for (const step of steps.filter((s) => s.action)) {
    for (const os of ['linux', 'windows', 'macos']) {
      const ok = firstBinding(keymap(os), step.action) || actionLabel(catalog, step.action);
      assert.ok(ok, `${os}: ${step.action}`);
    }
  }
  assert.equal(new Set(scenes.scenes.map((s) => s.name)).size, scenes.scenes.length);
});

test('docs pictures refer to known scenes and schemes, with unique file names', () => {
  const cfg = JSON.parse(readFileSync(new URL('./screenshots/scenes.json', import.meta.url), 'utf8'));
  const names = new Set(cfg.scenes.map((s) => s.name));
  for (const img of cfg.docs.images) {
    assert.ok(names.has(img.scene), img.scene);
    assert.ok(cfg.themes.includes(img.theme), img.theme);
    assert.match(img.file, /^[a-z0-9-]+\.png$/);
  }
  assert.ok(names.has(cfg.docs.overview.scene));
  const files = [...cfg.docs.images.map((i) => i.file), cfg.docs.overview.file];
  assert.equal(new Set(files).size, files.length);
  assert.deepEqual(Object.keys(cfg.themeNames).sort(), [...cfg.themes].sort());
});

test('README pictures (044): known scenes in Norton, one file per feature, every new scene used', () => {
  const cfg = JSON.parse(readFileSync(new URL('./screenshots/scenes.json', import.meta.url), 'utf8'));
  const byName = new Map(cfg.scenes.map((s) => [s.name, s]));
  assert.equal(cfg.readme.theme, 'classic-norton');
  assert.equal(cfg.readme.out, 'docs/screenshots/readme');
  for (const img of cfg.readme.images) {
    assert.ok(byName.has(img.scene), img.scene);
    assert.match(img.file, /^[a-z0-9-]+\.png$/);
  }
  const files = cfg.readme.images.map((i) => i.file);
  assert.equal(new Set(files).size, files.length);
  assert.ok(files.length >= 12 && files.length <= 20, `${files.length} pictures`);
  for (const name of ['conflict-dialog', 'flat-view', 'archive-folder', 'remote-panel', 'shell-output', 'similar-images']) {
    assert.ok(cfg.readme.images.some((i) => i.scene === name), `${name} is not used`);
  }
  // options of a scene: only those the runner and the mock know
  const known = new Set(['name', 'steps', 'prelude', 'mock', 'ready']);
  const mocks = new Set(['jobs', 'bigFiles', 'duplicates', 'conflict', 'photoFolders', 'archive', 'remote', 'shellHeight', 'sync']);
  for (const s of cfg.scenes) {
    for (const k of Object.keys(s)) assert.ok(known.has(k), `${s.name}: ${k}`);
    for (const k of Object.keys(s.mock ?? {})) assert.ok(mocks.has(k), `${s.name}: mock.${k}`);
  }
});

test('mock backend: the scene options exist in mock-backend.js', () => {
  const mock = readFileSync(new URL('./screenshots/mock-backend.js', import.meta.url), 'utf8');
  for (const k of ['conflict', 'photoFolders', 'archive', 'remote', 'shellHeight', 'sync']) {
    assert.ok(mock.includes(`cfg.mock?.${k}`), k);
  }
  for (const cmd of ['run_shell', 'duplicate_thumbnails', 'load_starter']) assert.ok(mock.includes(`${cmd}:`), cmd);
});

test('action labels come from the catalog without the ellipsis', () => {
  const src = "  OPEN_THEMES_DLG: m('Colour schemes…', 'config', '013'),\n  X: m('It\\'s', 'a'),";
  assert.equal(actionLabel(src, 'OPEN_THEMES_DLG'), 'Colour schemes');
  assert.equal(actionLabel(src, 'X'), "It's");
  assert.equal(actionLabel(src, 'MISSING'), null);
});

test('options', () => {
  assert.deepEqual(parseArgs(['--theme', 'a,b', '--flat', '--out=x']), { theme: 'a,b', flat: true, out: 'x' });
  assert.deepEqual(list(' a, ,b '), ['a', 'b']);
  assert.deepEqual(pick(['a', 'b', 'c'], ['c', 'a'], 'scene'), ['a', 'c']);
  assert.deepEqual(pick(['a'], [], 'scene'), ['a']);
  assert.throws(() => pick(['a'], ['z'], 'scene'), /unknown scene: z/);
});

test('demo tree: folders from paths, deterministic', () => {
  const dirs = treeFromPaths('/p', ['a/b.txt', 'a/c/d.md', 'e.json'], () => 7);
  assert.deepEqual(dirs['/p'].map((e) => [e.name, e.kind]), [
    ['a', 'directory'],
    ['e.json', 'file'],
  ]);
  assert.deepEqual(dirs['/p/a'].map((e) => e.name), ['b.txt', 'c']);
  assert.equal(dirs['/p/a/c'][0].size, 7);
  assert.deepEqual(treeFromPaths('/p', ['x/y'], () => 1), treeFromPaths('/p', ['x/y'], () => 1));
  const fs = buildDemoFs(ROOT);
  for (const [dir, entries] of Object.entries(fs.dirs)) {
    for (const e of entries.filter((x) => x.kind === 'directory')) {
      const child = dir === '/' ? `/${e.name}` : `${dir}/${e.name}`;
      assert.ok(child in fs.dirs, `missing listing for ${child}`);
    }
  }
  assert.match(demoPhotoSvg('IMG_1.jpg'), /^<svg /);
  assert.equal(demoPhotoSvg('IMG_1.jpg'), demoPhotoSvg('IMG_1.jpg'));
  // an edited variant: the same picture with a tint (similar images, 044)
  assert.notEqual(demoPhotoSvg('IMG_1.jpg#v'), demoPhotoSvg('IMG_1.jpg'));
  assert.ok(demoPhotoSvg('IMG_1.jpg#v').startsWith(demoPhotoSvg('IMG_1.jpg').split('\n</svg>')[0].slice(0, 400)));
});
