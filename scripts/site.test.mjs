// README and landing page (prompt 044): every picture exists, anchors resolve, the page
// stays static (no script, nothing loaded from elsewhere) – node --test.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { IMG_BASE, anchorOf, imgSources, markdownImages, siteImages } from './site-lib.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const readme = read('README.md');
const html = read('site/index.html');
const scenes = JSON.parse(read('scripts/screenshots/scenes.json'));
const readmePictures = scenes.readme.images.map((i) => i.file);

test('helpers', () => {
  assert.deepEqual(imgSources('<img alt="x" src="img/a.png"> <img src="b.png" width="1">'), ['img/a.png', 'b.png']);
  assert.deepEqual(siteImages('<img src="img/a.png"><img src="img/a.png"><img src="favicon.png">'), ['a.png']);
  assert.deepEqual(markdownImages('![a b](docs/x.png)\n<img src="y.png">'), ['docs/x.png', 'y.png']);
  assert.deepEqual(markdownImages('![pattern [C].[E] here](m.png)'), ['m.png']);
  assert.equal(anchorOf('FTP, FTPS and SFTP servers'), 'ftp-ftps-and-sftp-servers');
  assert.equal(anchorOf('Two panels, tabs everywhere'), 'two-panels-tabs-everywhere');
});

test('README: every picture exists', () => {
  for (const src of markdownImages(readme).filter((s) => !s.startsWith('http'))) {
    assert.ok(existsSync(join(ROOT, src)), src);
  }
});

test('README: every README picture of scenes.json is shown', () => {
  const used = markdownImages(readme);
  for (const file of readmePictures) {
    assert.ok(used.includes(`docs/screenshots/readme/${file}`), file);
  }
});

test('README: the feature list links to headings that exist', () => {
  const anchors = new Set([...readme.matchAll(/^#{2,3} (.+)$/gm)].map((m) => anchorOf(m[1])));
  const list = readme.split('## Main features')[1].split('\n## ')[0];
  const links = [...list.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 12 && links.length <= 20, `${links.length} features`);
  for (const a of links) assert.ok(anchors.has(a), a);
});

test('site: every picture comes from img/ and exists in the repository', () => {
  for (const src of imgSources(html)) {
    assert.ok(src === 'favicon.png' || src.startsWith(IMG_BASE), src);
  }
  for (const name of siteImages(html)) {
    const file =
      name === 'colour-schemes-overview.png'
        ? join(ROOT, 'docs/screenshots', name)
        : join(ROOT, 'screenshots/classic-norton', name);
    assert.ok(existsSync(file), name);
  }
  assert.ok(existsSync(join(ROOT, 'site/favicon.png')), 'favicon.png in site');
  for (const name of siteImages(html)) {
    assert.ok(existsSync(join(ROOT, 'site/img', name)), `${name} in site/img`);
  }
});

test('site: static, nothing from elsewhere, every picture with alt and size', () => {
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /<link\b[^>]*rel="stylesheet"/i);
  assert.doesNotMatch(html, /@import|url\(\s*['"]?https?:/i);
  for (const src of imgSources(html)) assert.ok(!/^https?:/.test(src), src);
  for (const tag of html.match(/<img\b[^>]*>/g)) {
    assert.match(tag, /\balt="/, tag);
    assert.match(tag, /\bwidth="\d+"/, tag);
    assert.match(tag, /\bheight="\d+"/, tag);
  }
  assert.match(html, /<html lang="en">/);
  assert.match(html, new RegExp(`IMG_BASE: ${IMG_BASE}`));
});

test('site: in-page links point to existing ids', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(id), id);
});
