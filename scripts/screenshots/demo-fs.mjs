// Demo file system for the screenshot run (scripts/screenshots/run.mjs).
//
// Plain data, deterministic: the same names, sizes and dates on every machine, so
// screenshots of two runs differ only where the app changed. The project folder is
// filled from the real repository (`git ls-files`), the rest is invented.
//
// Shape: { home, dirs: { [dirPath]: Entry[] } } with Entry = the `DirEntry` DTO
// (src/app/core/fs/fs.models.ts) without `path` – the mock joins it.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const HOME = '/home/marc';
export const PROJECT = `${HOME}/Projects/files-and-folders-tauri`;
export const PHOTOS = `${HOME}/Pictures/Italy 2026`;

const MB = 1024 * 1024;
const KB = 1024;

/** Local time → epoch ms (fixed time zone-free: UTC, the app formats it). */
const t = (iso) => Date.parse(`${iso}Z`);

const dir = (name, modified, extra = {}) => ({
  name,
  kind: 'directory',
  targetKind: null,
  size: null,
  modifiedMs: t(modified),
  hidden: name.startsWith('.'),
  lossyName: false,
  ...extra,
});

const file = (name, size, modified, extra = {}) => ({
  name,
  kind: 'file',
  targetKind: null,
  size,
  modifiedMs: t(modified),
  hidden: name.startsWith('.'),
  lossyName: false,
  ...extra,
});

/** Small pseudo random generator (mulberry32) – same numbers on every run. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Turns a list of repository paths (`git ls-files`) into folders below `root`.
 * Sizes come from `sizeOf(relPath)` (null = unknown → 0), dates are spread
 * over a few weeks, deterministic per path.
 */
export function treeFromPaths(root, paths, sizeOf = () => 0) {
  const dirs = { [root]: [] };
  const seen = new Set();
  const date = (rel) => {
    let h = 0;
    for (const c of rel) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const day = 1 + (h % 19);
    const hour = 8 + (h % 11);
    const min = h % 60;
    return `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
  };
  for (const rel of paths) {
    const parts = rel.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const childPath = `${current}/${name}`;
      const isLeaf = i === parts.length - 1;
      if (!seen.has(childPath)) {
        seen.add(childPath);
        const sub = parts.slice(0, i + 1).join('/');
        dirs[current].push(
          isLeaf ? file(name, sizeOf(rel) ?? 0, date(sub)) : dir(name, date(sub)),
        );
        if (!isLeaf) dirs[childPath] = [];
      }
      current = childPath;
    }
  }
  return dirs;
}

function repoFiles(repoRoot) {
  try {
    const out = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' });
    return out
      .split('\n')
      .filter(Boolean)
      .filter((p) => !p.startsWith('docs/screens_old/') && !p.includes('/icons/'));
  } catch {
    return ['README.md', 'package.json', 'src/main.ts', 'src-tauri/Cargo.toml'];
  }
}

function photos() {
  const random = rng(2026);
  const list = [
    dir('Edited', '2026-09-12T10:00:00'),
    dir('Panorama', '2026-09-12T10:02:00'),
    dir('Videos', '2026-09-12T10:05:00'),
  ];
  const numbers = [
    4711, 4712, 4715, 4716, 4720, 4721, 4733, 4734, 4738, 4740, 4741, 4752, 4753, 4760, 4761,
    4768, 4770, 4777, 4781, 4790, 4792, 4801,
  ];
  numbers.forEach((n, i) => {
    const day = 1 + Math.floor(i / 3);
    const hour = 8 + Math.floor(random() * 11);
    const min = Math.floor(random() * 60);
    const stamp = `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
    list.push(file(`IMG_${n}.jpg`, Math.round((2 + random() * 4.5) * MB), stamp));
  });
  list.push(file('VID_4725.mp4', 184 * MB, '2026-09-04T18:22:00'));
  list.push(file('VID_4744.mp4', 96 * MB, '2026-09-05T19:41:00'));
  list.push(file('route.gpx', 412 * KB, '2026-09-10T21:05:00'));
  list.push(file('notes.txt', 2 * KB, '2026-09-11T09:12:00'));
  list.push(file('Italy 2026 best of.zip', 38 * MB, '2026-09-15T20:40:00'));
  return list;
}

/** The whole demo tree. `repoRoot` = this repository (for the project folder). */
export function buildDemoFs(repoRoot) {
  const files = repoFiles(repoRoot);
  const sizeOf = (rel) => {
    try {
      return statSync(join(repoRoot, rel)).size;
    } catch {
      return null;
    }
  };
  const dirs = {
    '/': [dir('home', '2026-01-10T09:00:00'), dir('tmp', '2026-10-20T07:00:00')],
    '/tmp': [],
    '/home': [dir('marc', '2026-10-20T08:00:00')],
    [HOME]: [
      dir('.cache', '2026-10-20T08:00:00'),
      dir('.config', '2026-10-19T22:10:00'),
      dir('Desktop', '2026-10-18T17:20:00'),
      dir('Documents', '2026-10-16T11:45:00'),
      dir('Downloads', '2026-10-20T07:58:00'),
      dir('Music', '2026-08-30T20:12:00'),
      dir('Pictures', '2026-09-15T20:40:00'),
      dir('Projects', '2026-10-20T08:10:00'),
      dir('Videos', '2026-07-02T19:30:00'),
      file('.bashrc', 3 * KB + 771, '2026-05-02T10:00:00'),
      file('.gitconfig', 312, '2026-03-11T16:44:00'),
      file('todo.md', 1 * KB + 210, '2026-10-19T21:03:00'),
    ],
    [`${HOME}/.cache`]: [],
    [`${HOME}/.config`]: [],
    [`${HOME}/Desktop`]: [file('Screenshot 2026-10-18.png', 1 * MB + 233 * KB, '2026-10-18T17:20:00')],
    [`${HOME}/Documents`]: [
      dir('Invoices', '2026-10-01T09:00:00'),
      dir('Taxes 2025', '2026-05-30T14:00:00'),
      file('Lease agreement.pdf', 845 * KB, '2026-02-14T10:31:00'),
      file('CV Marc Kronberg.docx', 64 * KB, '2026-06-21T18:02:00'),
      file('Budget 2026.xlsx', 38 * KB, '2026-10-16T11:45:00'),
    ],
    [`${HOME}/Documents/Invoices`]: [],
    [`${HOME}/Documents/Taxes 2025`]: [],
    [`${HOME}/Downloads`]: [
      file('invoice-2026-09.pdf', 212 * KB, '2026-10-02T08:14:00'),
      file('node-v22.23.3-darwin-arm64.tar.xz', 27 * MB, '2026-10-12T19:33:00'),
      file('tauri-2.8-release-notes.md', 18 * KB, '2026-10-14T21:10:00'),
      file('Screenshot_2026-10-19.png', 980 * KB, '2026-10-19T12:02:00'),
      file('font-awesome-4.5.0.zip', 6 * MB, '2026-10-08T15:20:00'),
      file('setup.exe', 92 * MB, '2026-10-05T10:00:00'),
    ],
    [`${HOME}/Music`]: [
      dir('Air - Moon Safari', '2026-08-30T20:12:00'),
      dir('Daft Punk - Discovery', '2026-08-30T20:10:00'),
      dir('Moby - Play', '2026-08-30T20:08:00'),
    ],
    [`${HOME}/Music/Air - Moon Safari`]: [
      file('01 La femme d’argent.flac', 41 * MB, '2026-08-30T20:12:00'),
      file('02 Sexy Boy.flac', 29 * MB, '2026-08-30T20:12:00'),
      file('03 All I Need.flac', 26 * MB, '2026-08-30T20:12:00'),
      file('cover.jpg', 380 * KB, '2026-08-30T20:12:00'),
    ],
    [`${HOME}/Music/Daft Punk - Discovery`]: [],
    [`${HOME}/Music/Moby - Play`]: [],
    [`${HOME}/Pictures`]: [dir('Italy 2026', '2026-09-15T20:40:00'), dir('Family', '2026-04-10T12:00:00')],
    [`${HOME}/Pictures/Family`]: [],
    [PHOTOS]: photos(),
    [`${PHOTOS}/Edited`]: [],
    [`${PHOTOS}/Panorama`]: [],
    [`${PHOTOS}/Videos`]: [],
    [`${HOME}/Projects`]: [
      dir('files-and-folders-tauri', '2026-10-20T08:10:00'),
      dir('guiexpert-table', '2026-10-18T22:04:00'),
      dir('website', '2026-09-02T13:00:00'),
    ],
    [`${HOME}/Projects/guiexpert-table`]: [],
    [`${HOME}/Projects/website`]: [],
    [`${HOME}/Videos`]: [],
    ...treeFromPaths(PROJECT, files, sizeOf),
  };
  return { home: HOME, dirs };
}

/** Contents for the viewer (F3): a few real files of the repository plus invented notes. */
export function demoTexts(repoRoot) {
  const texts = {
    [`${PHOTOS}/notes.txt`]:
      'Italy 2026\n==========\n\nRome – Florence – Siena – Val d’Orcia\n\n- 01.09. Rome, Trastevere\n- 03.09. Florence, Uffizi (book ahead!)\n- 05.09. Siena, Piazza del Campo\n- 07.09. Pienza, Montepulciano\n',
    [`${HOME}/todo.md`]: '# Todo\n\n- [x] Back up the Italy photos\n- [ ] Sort the downloads\n- [ ] Screenshots for the README\n',
  };
  for (const rel of ['README.md', 'package.json', 'CLAUDE.md', 'TODO.md']) {
    try {
      texts[`${PROJECT}/${rel}`] = readFileSync(join(repoRoot, rel), 'utf8').slice(0, 64 * 1024);
    } catch {
      // not there – the viewer shows the file name only
    }
  }
  return texts;
}

/**
 * A made-up landscape photo as SVG for the image viewer and quick view; colours vary
 * with the file name so neighbouring files look different.
 */
export function demoPhotoSvg(token) {
  // `name#v`: the same picture, edited (warmer) – similar images (design 042)
  const [name, variant] = token.split('#');
  let h = 0;
  for (const c of name) h = (h * 131 + c.charCodeAt(0)) >>> 0;
  const r = rng(h);
  const sky = 190 + Math.floor(r() * 40);
  const sunX = 200 + Math.floor(r() * 1200);
  const sunY = 160 + Math.floor(r() * 180);
  const hill = (base, amp, color) => {
    let d = `M0 ${base}`;
    for (let x = 0; x <= 1600; x += 100) d += ` Q${x + 50} ${base - amp * r()} ${x + 100} ${base - amp * 0.4 * r()}`;
    return `<path d="${d} L1600 1067 L0 1067 Z" fill="${color}"/>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067" viewBox="0 0 1600 1067">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="hsl(${sky},70%,62%)"/><stop offset="1" stop-color="hsl(${(sky + 160) % 360},85%,82%)"/>
</linearGradient></defs>
<rect width="1600" height="1067" fill="url(#s)"/>
<circle cx="${sunX}" cy="${sunY}" r="70" fill="hsl(45,100%,88%)" opacity="0.9"/>
${hill(620, 160, `hsl(${100 + Math.floor(r() * 30)},28%,52%)`)}
${hill(760, 140, `hsl(${80 + Math.floor(r() * 30)},35%,40%)`)}
${hill(900, 110, `hsl(${60 + Math.floor(r() * 30)},38%,30%)`)}
${variant ? '<rect width="1600" height="1067" fill="hsl(30,90%,55%)" opacity="0.22"/>' : ''}
</svg>`;
}
