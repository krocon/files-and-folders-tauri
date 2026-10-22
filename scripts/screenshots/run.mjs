#!/usr/bin/env node
// Screenshots of the app for every colour scheme – `pnpm screenshots` (see docs/screenshots.md).
//
// Like the screenshot tool of files-and-folders-mr (apps/screenshot): every scene of
// scenes.json is captured once per colour scheme. Here the real Angular frontend runs
// in Chromium (Playwright) and mock-backend.js answers the Tauri commands from a demo
// file system (demo-fs.mjs) – no Rust build, no window, no OS permissions, and the
// same pictures on macOS, Windows and Linux.
//
//   pnpm screenshots                                all schemes × all scenes → screenshots/
//   pnpm screenshots --theme classic-norton --scene main,actions-menu
//   pnpm screenshots --out docs/screenshots --flat  one scheme, files named <scene>.png
//   pnpm screenshots:docs                           the README pictures (scenes.json "docs") +
//                                                   an overview of all schemes, compressed with pngquant
//
// Options: --theme a,b  --scene a,b  --out <dir>  --flat  --platform linux|windows|macos
//          --lang en|de  --width 1280 --height 760  --scale 1|2  --jobs 4
//          --no-build (use the existing dist/)  --headed  --chrome (installed Google Chrome)
//          --list (print schemes and scenes)  --verbose (browser console)  --docs
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, PHOTOS, PROJECT, buildDemoFs, demoPhotoSvg, demoTexts } from './demo-fs.mjs';
import { actionLabel, firstBinding, list, parseArgs, pick, toPlaywrightStrokes } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DIST = join(ROOT, 'dist', 'files-and-folders-tauri', 'browser');
const KEY_DELAY_MS = 120;
const SETTLE_MS = 700;

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const args = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (err) {
    return fail(err.message);
  }
})();

const config = JSON.parse(readFileSync(join(HERE, 'scenes.json'), 'utf8'));
const allThemes = config.themes;
const allScenes = config.scenes.map((s) => s.name);

if (args.list) {
  console.log(`colour schemes: ${allThemes.join(', ')}`);
  console.log(`scenes:         ${allScenes.join(', ')}`);
  process.exit(0);
}

let themes;
let sceneNames;
try {
  themes = pick(allThemes, list(args.theme), 'colour scheme');
  sceneNames = pick(allScenes, list(args.scene), 'scene');
} catch (err) {
  fail(err.message);
}
const platform = args.platform ?? 'linux';
if (!['linux', 'windows', 'macos'].includes(platform)) fail(`unknown platform "${platform}"`);
const lang = args.lang ?? 'en';
if (!['en', 'de'].includes(lang)) fail(`unknown language "${lang}"`);
const width = Number(args.width ?? 1280);
const height = Number(args.height ?? 760);
const scale = Number(args.scale ?? 1);
const jobs = Math.max(1, Number(args.jobs ?? 4));
const flat = Boolean(args.flat);
if (flat && themes.length > 1) fail('--flat needs exactly one --theme');
const docs = Boolean(args.docs);
if (docs && (args.theme || args.scene || args.out || flat)) fail('--docs takes its pictures from scenes.json ("docs")');
const outDir = resolve(ROOT, docs ? config.docs.out : typeof args.out === 'string' ? args.out : 'screenshots');

// ---- frontend build ------------------------------------------------------------------
if (!args['no-build']) {
  console.log('▸ building the frontend (pnpm build) …');
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const res = spawnSync(pnpm, ['build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) fail('pnpm build failed');
}
if (!existsSync(join(DIST, 'index.html'))) fail(`no frontend build in ${relative(ROOT, DIST)} – run without --no-build`);

// ---- playwright ------------------------------------------------------------------------
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  fail('Playwright is missing – run `pnpm install`');
}

// ---- static server for dist/ (SPA fallback to index.html) ------------------------------
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
};
const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath.startsWith('/__demo-image/')) {
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    res.end(demoPhotoSvg(urlPath.slice('/__demo-image/'.length)));
    return;
  }
  let file = normalize(join(DIST, urlPath));
  if (!file.startsWith(DIST + sep) && file !== DIST) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const baseUrl = `http://127.0.0.1:${server.address().port}/`;

// ---- demo data and keymap ----------------------------------------------------------------
const demoFs = buildDemoFs(ROOT);
const texts = demoTexts(ROOT);
const keymapFile = { linux: 'linux.json', windows: 'windows.json', macos: 'macos.json' }[platform];
const keymap = JSON.parse(
  readFileSync(join(ROOT, 'src', 'app', 'core', 'actions', 'keymaps', keymapFile), 'utf8'),
);
const catalog = readFileSync(join(ROOT, 'src', 'app', 'core', 'actions', 'action-catalog.ts'), 'utf8');
const appVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const mockScript = readFileSync(join(HERE, 'mock-backend.js'), 'utf8');

const tab = (id, path, extra = {}) => ({
  id,
  path,
  title: path.slice(path.lastIndexOf('/') + 1),
  history: [],
  cursor: null,
  hiddenVisible: false,
  filterActive: false,
  filterText: '',
  table: null,
  ...extra,
});
const session = {
  version: 1,
  activeSide: 'right',
  splitter: 0.5,
  favorites: [PROJECT, PHOTOS],
  recent: [`${HOME}/Downloads`, `${HOME}/Music`, `${HOME}/Documents`],
  panels: {
    left: {
      activeTab: 0,
      tabs: [
        tab('l1', PROJECT, { cursor: `${PROJECT}/src-tauri` }),
        tab('l2', `${HOME}/Downloads`),
        tab('l3', `${HOME}/Music`),
      ],
    },
    right: {
      activeTab: 0,
      tabs: [tab('r1', PHOTOS, { cursor: `${PHOTOS}/IMG_4738.jpg` }), tab('r2', HOME)],
    },
  },
  shell: { visible: false, outputOpen: true, outputHeight: 160 },
};
const settings = { 'general.language': lang, 'view.dateFormat': 'iso' };

// ---- one screenshot ---------------------------------------------------------------------
async function pressAction(page, actionId) {
  const binding = firstBinding(keymap, actionId);
  if (binding) {
    for (const stroke of toPlaywrightStrokes(binding, platform)) {
      await page.keyboard.press(stroke);
      await page.waitForTimeout(KEY_DELAY_MS);
    }
    return;
  }
  // no shortcut: through the command palette, by its English label
  const label = actionLabel(catalog, actionId);
  if (!label) throw new Error(`unknown action ${actionId}`);
  await pressAction(page, 'OPEN_COMMAND_PALETTE');
  await page.keyboard.type(label, { delay: 10 });
  await page.waitForTimeout(KEY_DELAY_MS * 2);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(KEY_DELAY_MS);
}

async function runStep(page, step) {
  if (step.action) await pressAction(page, step.action);
  else if (step.key) await page.keyboard.press(step.key);
  else if (step.type) await page.keyboard.type(step.type, { delay: 30 });
  else if (step.wait) await page.waitForTimeout(step.wait);
  else if (step.click) await page.click(step.click);
  else throw new Error(`unknown step ${JSON.stringify(step)}`);
  await page.waitForTimeout(KEY_DELAY_MS);
}

async function capture(browser, theme, scene, target) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    locale: lang === 'de' ? 'de-DE' : 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || args.verbose) errors.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  const cfg = { fs: demoFs, texts, theme, platform, session, settings, appVersion, mock: scene.mock ?? {} };
  await page.addInitScript({ content: `window.__FNF_SCREENSHOT__ = ${JSON.stringify(cfg)};` });
  await page.addInitScript({ content: mockScript });
  try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(
      () =>
        document.querySelectorAll('guiexpert-table, guiexpert-table-signal').length >= 2 &&
        document.body.innerText.includes('IMG_4711.jpg'),
      undefined,
      { timeout: 20000 },
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const prelude = scene.prelude === false ? [] : (config.prelude ?? []);
    for (const step of [...prelude, ...scene.steps]) await runStep(page, step);
    await page.waitForTimeout(SETTLE_MS);
    const file = target ?? join(flat ? outDir : join(outDir, theme), `${scene.name}.png`);
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    return { file, errors };
  } finally {
    await context.close();
  }
}

// ---- docs: overview of all schemes, compression ------------------------------------------
/** One picture with a tile per colour scheme (the `main` scene), labelled with its name. */
async function renderOverview(browser, dir, file) {
  const { columns, tileWidth } = config.docs.overview;
  const tileHeight = Math.round((tileWidth * height) / width);
  const tiles = allThemes
    .map((theme) => {
      const data = readFileSync(join(dir, `${theme}.png`)).toString('base64');
      const name = config.themeNames?.[theme] ?? theme;
      return `<figure><img src="data:image/png;base64,${data}" alt=""><figcaption>${name}</figcaption></figure>`;
    })
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 16px; background: #f4f5f7; font: 600 15px/1.3 system-ui, sans-serif; color: #24292f; }
    main { display: grid; grid-template-columns: repeat(${columns}, ${tileWidth}px); gap: 16px; }
    figure { margin: 0; }
    img { display: block; width: ${tileWidth}px; height: ${tileHeight}px; border-radius: 6px;
          box-shadow: 0 1px 3px rgb(0 0 0 / 0.25); }
    figcaption { padding: 6px 2px 0; text-align: center; }
  </style><main>${tiles}</main>`;
  const page = await browser.newPage({
    viewport: { width: columns * tileWidth + (columns - 1) * 16 + 32, height: 400 },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: file, fullPage: true });
  } finally {
    await page.close();
  }
}

/** pngquant if installed (60–70 % smaller, no visible loss); otherwise leave the files. */
function compress(files) {
  const probe = spawnSync('pngquant', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    console.log('  ! pngquant not found – pictures stay uncompressed (brew install pngquant / apt install pngquant)');
    return;
  }
  let before = 0;
  let after = 0;
  for (const f of files) {
    before += statSync(f).size;
    spawnSync('pngquant', ['--force', '--skip-if-larger', '--strip', '--quality', '70-95', '--output', f, f]);
    after += statSync(f).size;
  }
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(`  ✓ pngquant: ${kb(before)} → ${kb(after)}`);
}

// ---- run ---------------------------------------------------------------------------------
const launchOptions = { headless: !args.headed };
if (args.chrome) launchOptions.channel = 'chrome';
if (process.env.FNF_SCREENSHOT_CHROMIUM) launchOptions.executablePath = process.env.FNF_SCREENSHOT_CHROMIUM;
let browser;
try {
  browser = await chromium.launch(launchOptions);
} catch (err) {
  server.close();
  fail(
    `${err.message.split('\n')[0]}\n  → install the browser once: pnpm screenshots:install\n` +
      '    (or use your Google Chrome: pnpm screenshots --chrome)',
  );
}

const sceneByName = new Map(config.scenes.map((s) => [s.name, s]));
const scenes = config.scenes.filter((s) => sceneNames.includes(s.name));
let queue = themes.flatMap((theme) => scenes.map((scene) => ({ theme, scene })));
const overviewDir = docs ? mkdtempSync(join(tmpdir(), 'fnf-overview-')) : null;
if (docs) {
  const { images, overview } = config.docs;
  queue = [
    ...images.map((img) => ({ theme: img.theme, scene: sceneByName.get(img.scene), file: join(outDir, img.file) })),
    ...allThemes.map((theme) => ({
      theme,
      scene: sceneByName.get(overview.scene),
      file: join(overviewDir, `${theme}.png`),
    })),
  ];
  for (const item of queue) if (!item.scene) fail(`scenes.json "docs": unknown scene for ${item.file}`);
}
const total = queue.length;
let done = 0;
let failed = 0;
const started = Date.now();
console.log(
  docs
    ? `▸ ${total} screenshots for the docs (${platform}, ${lang}) → ${relative(ROOT, outDir)}`
    : `▸ ${total} screenshots (${themes.length} schemes × ${scenes.length} scenes, ${platform}, ${lang}) → ${relative(ROOT, outDir) || '.'}`,
);

async function worker() {
  for (let item = queue.shift(); item; item = queue.shift()) {
    const { theme, scene } = item;
    try {
      const { file, errors } = await capture(browser, theme, scene, item.file);
      done += 1;
      const shown = overviewDir && file.startsWith(overviewDir) ? `(overview) ${theme}` : relative(ROOT, file);
      console.log(`  ✓ [${done}/${total}] ${shown}`);
      for (const line of errors) console.log(`      ${line}`);
    } catch (err) {
      done += 1;
      failed += 1;
      console.log(`  ✖ [${done}/${total}] ${theme}/${scene.name}: ${err.message.split('\n')[0]}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, total) }, worker));
if (docs && failed === 0) {
  const file = join(outDir, config.docs.overview.file);
  await renderOverview(browser, overviewDir, file);
  console.log(`  ✓ ${relative(ROOT, file)}`);
  compress([...config.docs.images.map((img) => join(outDir, img.file)), file]);
}
if (overviewDir) rmSync(overviewDir, { recursive: true, force: true });
await browser.close();
server.close();
const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`${failed ? '✖' : '✔'} ${total - failed}/${total} screenshots in ${secs} s`);
process.exit(failed ? 1 : 0);
