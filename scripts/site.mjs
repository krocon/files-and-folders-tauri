#!/usr/bin/env node
// Landing page for krocon.de/fnf (prompt 044) – `pnpm site`.
//
// Puts together site/dist/: index.html, favicon.png and img/ with the README pictures
// (docs/screenshots/readme/*.png) and the colour scheme overview. Nothing is built or
// rewritten – the page references img/… and works as it is. Upload the content of
// site/dist/ to the folder /fnf of the web space (site/README.md).
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteImages } from './site-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'dist');
const html = readFileSync(join(ROOT, 'site', 'index.html'), 'utf8');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'img'), { recursive: true });
copyFileSync(join(ROOT, 'site', 'index.html'), join(OUT, 'index.html'));
copyFileSync(join(ROOT, 'docs', 'logo', 'png', 'ff-green-64x64.png'), join(OUT, 'favicon.png'));
const images = siteImages(html);
for (const name of images) copyFileSync(sourceOf(name), join(OUT, 'img', name));
console.log(`✔ site/dist: index.html, favicon.png, ${images.length} pictures in img/`);

function sourceOf(name) {
  return name === 'colour-schemes-overview.png'
    ? join(ROOT, 'docs', 'screenshots', name)
    : join(ROOT, 'docs', 'screenshots', 'readme', name);
}
