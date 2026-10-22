// Fake Rust backend for the screenshot run – runs in the browser page *before* the app.
//
// The app only talks to Rust through `invoke()` of `@tauri-apps/api/core`, which calls
// `window.__TAURI_INTERNALS__.invoke`. This script installs that object (like
// `@tauri-apps/api/mocks`) and answers the commands from a demo file system, so the
// real Angular frontend renders in a normal browser without Tauri.
//
// Never part of the app: it is loaded by scripts/screenshots/run.mjs via Playwright's
// `addInitScript`, after `window.__FNF_SCREENSHOT__` was set to the configuration:
//   { fs: { home, dirs }, theme, platform, session, settings, appVersion }
// Read-only: commands that would change something resolve without doing anything.
(() => {
  const cfg = window.__FNF_SCREENSHOT__;
  if (!cfg) return;

  // ---- platform: detectPlatform() reads navigator.platform + userAgent --------------
  const navPlatform = { macos: 'MacIntel', windows: 'Win32', linux: 'Linux x86_64' }[cfg.platform];
  const agents = {
    macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  };
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => navPlatform });
  Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => agents[cfg.platform] });

  // ---- file system -------------------------------------------------------------------
  const dirs = cfg.fs.dirs;
  const home = cfg.fs.home;

  const join = (parent, name) => (parent === '/' ? `/${name}` : `${parent}/${name}`);
  const parentOf = (path) => {
    if (path === '/') return null;
    const i = path.lastIndexOf('/');
    return i <= 0 ? '/' : path.slice(0, i);
  };
  const nameOf = (path) => (path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1));
  const expand = (p) => {
    let path = (p ?? '').trim() || home;
    if (path === '~' || path.startsWith('~/')) path = home + path.slice(1);
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return path;
  };
  const fsError = (code, message, path = null) => ({ code, message, path });
  const mb = 1024 * 1024;
  const gb = 1024 * mb;

  function entriesOf(path) {
    return (dirs[path] ?? []).map((e) => ({ ...e, path: join(path, e.name) }));
  }

  function entryAt(path) {
    const parent = parentOf(path);
    if (parent === null) return null;
    return entriesOf(parent).find((e) => e.name === nameOf(path)) ?? null;
  }

  function segments(path) {
    const out = [{ name: '/', path: '/' }];
    if (path === '/') return out;
    let current = '';
    for (const part of path.split('/').filter(Boolean)) {
      current += `/${part}`;
      out.push({ name: part, path: current });
    }
    return out;
  }

  function remoteProfile(id, name, kind, host, port, user, secret, startPath) {
    return {
      id, name, kind, host, port, user, anonymous: false, auth: 'password', keyFile: null,
      startPath, passive: true, encoding: 'auto', timeoutSecs: 20, maxConnections: 2,
      keepaliveSecs: 60, description: '', pinnedCert: null, acceptHostnameMismatch: false, secret,
    };
  }

  // Scene option `mock.archive`: the zip of the photo folder has contents (design 016/025).
  const archives = {};
  // Scene option `mock.remote`: one server folder (design 034) – demo names, no real host.
  const remotes = {};

  function archiveOf(path) {
    const zip = Object.keys(archives).find((a) => path === a || path.startsWith(`${a}/`));
    if (!zip) return null;
    const inner = path === zip ? '' : path.slice(zip.length + 1);
    return { path: zip, inner, format: 'zip', unsafeEntries: 0, entries: archives[zip], encrypted: false };
  }

  function remoteOf(path) {
    const m = /^remote:\/\/([a-z0-9-]+)(\/.*)?$/.exec(path);
    if (!m) return null;
    const profile = connections().find((p) => p.id === m[1]);
    if (!profile) return null;
    const inner = m[2] && m[2] !== '/' ? m[2] : '/';
    return {
      info: {
        profileId: profile.id,
        name: profile.name,
        kind: profile.kind,
        encrypted: profile.kind !== 'ftp',
        display: `${profile.name}: ${inner}`,
      },
      root: `remote://${profile.id}/`,
      inner,
    };
  }

  function remoteSegments(r) {
    const out = [{ name: r.info.name, path: r.root }];
    let current = r.root.slice(0, -1);
    for (const part of r.inner.split('/').filter(Boolean)) {
      current += `/${part}`;
      out.push({ name: part, path: current });
    }
    return out;
  }

  /** Design 034: three server profiles (no passwords – Rust keeps them in the keychain). */
  function connections() {
    return [
      remoteProfile('k3x9a2', 'My server', 'sftp', 'example.org', 22, 'marc', 'keychain', '/var/www'),
      remoteProfile('n4s7b1', 'NAS', 'ftp', 'nas.local', 21, 'marc', 'none', null),
      remoteProfile('c8w2d5', 'Customer webspace', 'ftpsExplicit', 'ftp.example.com', 21, 'web42', 'none', '/htdocs'),
    ];
  }

  const demoEntry = (name, kind, size, modified) => ({
    name,
    kind,
    targetKind: null,
    size: kind === 'directory' ? null : size,
    modifiedMs: Date.parse(`${modified}Z`),
    hidden: name.startsWith('.'),
    lossyName: false,
  });
  const demoFile = (name, size, modified) => demoEntry(name, 'file', size, modified);
  const demoDir = (name, modified) => demoEntry(name, 'directory', null, modified);
  const photoDir = `${home}/Pictures/Italy 2026`;

  // Scene option `mock.photoFolders`: the sub folders of the photo folder have photos too
  // (flat view, similar images) – only for those scenes, the others stay as they are.
  if (cfg.mock?.photoFolders) {
    dirs[`${photoDir}/Edited`] = [
      demoFile('IMG_4712 edited.jpg', Math.round(2.1 * mb), '2026-09-12T09:40:00'),
      demoFile('IMG_4738 edited.jpg', Math.round(1.8 * mb), '2026-09-12T09:44:00'),
      demoFile('IMG_4752 square.jpg', Math.round(1.2 * mb), '2026-09-12T09:51:00'),
      demoFile('IMG_4760 small.png', Math.round(3.4 * mb), '2026-09-12T09:55:00'),
    ];
    dirs[`${photoDir}/Panorama`] = [
      demoFile('Amalfi coast.jpg', Math.round(14.2 * mb), '2026-09-06T19:02:00'),
      demoFile('Dolomites at sunrise.jpg', Math.round(11.7 * mb), '2026-09-09T06:31:00'),
      demoFile('Lake Garda.jpg', Math.round(9.8 * mb), '2026-09-10T17:48:00'),
    ];
    dirs[`${photoDir}/Videos`] = [
      demoFile('Gondola.mp4', 212 * mb, '2026-09-03T16:20:00'),
      demoFile('Vespa ride.mp4', 148 * mb, '2026-09-07T11:05:00'),
    ];
  }

  // Scene option `mock.shellHeight`: a taller output area of the shell line.
  if (cfg.mock?.shellHeight) cfg.session.shell.outputHeight = cfg.mock.shellHeight;

  if (cfg.mock?.archive) {
    const zip = `${photoDir}/Italy 2026 best of.zip`;
    dirs[zip] = [
      demoDir('Amalfi', '2026-09-15T20:31:00'),
      demoDir('Dolomites', '2026-09-15T20:32:00'),
      demoDir('Venice', '2026-09-15T20:33:00'),
      demoFile('IMG_4711.jpg', Math.round(4.9 * mb), '2026-09-01T13:18:00'),
      demoFile('IMG_4738.jpg', Math.round(3.2 * mb), '2026-09-03T18:45:00'),
      demoFile('IMG_4752.jpg', Math.round(2.2 * mb), '2026-09-04T18:04:00'),
      demoFile('IMG_4790.jpg', Math.round(5.6 * mb), '2026-09-07T10:12:00'),
      demoFile('README.txt', 1200, '2026-09-15T20:40:00'),
      demoFile('slideshow.mp4', 24 * mb, '2026-09-15T20:38:00'),
    ];
    for (const d of ['Amalfi', 'Dolomites', 'Venice']) dirs[`${zip}/${d}`] = [];
    archives[zip] = 31;
    cfg.session.panels.right.tabs[0].cursor = zip;
  }

  if (cfg.mock?.remote) {
    const site = 'remote://k3x9a2/var/www/example.org';
    remotes[site] = [
      demoDir('assets', '2026-10-18T09:12:00'),
      demoDir('blog', '2026-10-20T21:40:00'),
      demoDir('fnf', '2026-10-21T19:02:00'),
      demoDir('img', '2026-10-11T08:30:00'),
      demoFile('.htaccess', 812, '2026-06-02T10:00:00'),
      demoFile('favicon.ico', 15 * 1024, '2026-01-14T12:00:00'),
      demoFile('impressum.html', 7 * 1024 + 300, '2026-03-21T16:45:00'),
      demoFile('index.html', 24 * 1024 + 512, '2026-10-21T19:05:00'),
      demoFile('robots.txt', 68, '2026-01-14T12:00:00'),
      demoFile('sitemap.xml', 3 * 1024 + 90, '2026-10-21T19:05:00'),
      demoFile('styles.css', 18 * 1024 + 700, '2026-10-18T09:12:00'),
    ];
    for (const d of ['assets', 'blog', 'fnf', 'img']) remotes[`${site}/${d}`] = [];
    remotes['remote://k3x9a2/var/www'] = [demoDir('example.org', '2026-10-21T19:05:00')];
    remotes['remote://k3x9a2/var'] = [demoDir('www', '2026-10-21T19:05:00')];
    remotes['remote://k3x9a2/'] = [demoDir('var', '2026-10-21T19:05:00')];
    const right = cfg.session.panels.right;
    right.tabs = [
      { ...right.tabs[0], id: 'r0', path: site, title: 'example.org', cursor: `${site}/index.html` },
      ...right.tabs,
    ];
  }

  function listDirectory(args) {
    const path = expand(args?.path ?? home);
    const remote = remoteOf(path);
    if (remote) {
      if (!(path in remotes)) throw fsError('not_found', 'not found', path);
      const segs = remoteSegments(remote);
      return {
        path,
        parent: segs.length > 1 ? segs[segs.length - 2].path : null,
        segments: segs,
        entries: (remotes[path] ?? []).map((e) => ({ ...e, path: `${path}/${e.name}` })),
        unreadableEntries: 0,
        archive: null,
        network: false,
        remote: remote.info,
      };
    }
    if (!(path in dirs)) {
      throw entryAt(path)
        ? fsError('not_a_directory', 'not a directory', path)
        : fsError('not_found', 'not found', path);
    }
    return {
      path,
      parent: parentOf(path),
      segments: segments(path),
      entries: entriesOf(path),
      unreadableEntries: 0,
      archive: archiveOf(path),
      network: false,
    };
  }

  function resolveLocation(args) {
    const path = expand(args?.input);
    if (path in dirs) return { dir: path, select: null };
    if (entryAt(path)) return { dir: parentOf(path), select: path };
    throw fsError('not_found', 'not found', path);
  }

  // ---- background jobs (Rust `jobs/`): events go through the channel of subscribe_jobs --
  // Channel protocol of @tauri-apps/api/core: callback(id)({ index, message }).
  let jobChannel = null;
  let channelIndex = 0;
  let jobNo = 0;
  const send = (message) => {
    if (!jobChannel) return;
    window.__TAURI_INTERNALS__.runCallback(jobChannel.id, { index: channelIndex++, message });
  };
  const progress = (p = {}) => ({
    bytesDone: 0,
    bytesTotal: 0,
    itemsDone: 0,
    itemsTotal: 0,
    current: null,
    rateBps: 0,
    ...p,
  });
  const summary = (s = {}) => ({
    itemsDone: 0,
    itemsSkipped: 0,
    itemsFailed: 0,
    bytesDone: 0,
    errors: [],
    error: null,
    dirSize: null,
    ...s,
  });
  const jobInfo = (id, spec, state, p, s = null) => ({
    id,
    spec,
    state,
    progress: progress(p),
    conflict: null,
    summary: s,
    pauseReason: null,
    undoAvailable: false,
  });

  /** All entries below `root` (depth-first), with their depth (1 = direct child). */
  function walk(root, maxDepth, excludes, includeHidden) {
    const out = [];
    const visit = (dir, depth) => {
      for (const e of entriesOf(dir)) {
        if (!includeHidden && e.hidden) continue;
        if (excludes.includes(e.name)) continue;
        out.push(e);
        if (e.kind === 'directory' && (maxDepth == null || depth < maxDepth)) visit(e.path, depth + 1);
      }
    };
    visit(root, 1);
    return out;
  }

  const globToRegex = (glob) =>
    new RegExp(
      `^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
      'i',
    );

  function searchHits(c) {
    const patterns = (c.name ?? '')
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean);
    const matchers = patterns.map((p) =>
      c.nameMode === 'regex' ? new RegExp(p, c.caseSensitive ? '' : 'i') : globToRegex(c.wholeName || /[*?]/.test(p) ? p : `*${p}*`),
    );
    const kinds = c.kinds ?? { files: true, dirs: true, links: true };
    const hits = [];
    for (const root of c.roots ?? []) {
      for (const e of walk(root, c.maxDepth, c.excludes ?? [], c.includeHidden)) {
        if (e.kind === 'directory' ? !kinds.dirs : !kinds.files) continue;
        if (matchers.length && !matchers.some((m) => m.test(e.name))) continue;
        const dir = parentOf(e.path);
        const names = dir.split('/').filter(Boolean).reverse();
        const relDir = dir === root ? '' : dir.slice(root.length + 1);
        hits.push({ ...e, dir, relDir, parentNames: [names[0] ?? '', names[1] ?? '', names[2] ?? ''] });
      }
    }
    return hits.slice(0, c.maxHits ?? 10000);
  }

  function startJob(args) {
    const spec = args?.spec ?? {};
    const id = `job-${++jobNo}`;
    // the tree exists before the id returns: the app reads it at once
    if (spec.kind === 'diskUsage') scans[id] = buildScan(spec.roots ?? []);
    setTimeout(() => {
      if (spec.kind === 'search' || spec.kind === 'duplicates') {
        const hits =
          spec.kind === 'search' ? searchHits(spec.criteria ?? {}) : duplicateHits(spec.criteria ?? {});
        const stats = {
          hits: hits.length,
          dirsScanned: 42,
          filesScanned: 615,
          unreadable: 0,
          elapsedMs: 38,
          truncated: false,
          groups: new Set(hits.map((h) => h.group).filter((g) => g !== undefined)).size,
        };
        send({ type: 'added', job: jobInfo(id, spec, 'running') });
        send({ type: 'searchHits', id, hits, stats });
        send({ type: 'finished', id, state: 'done', summary: summary({ itemsDone: hits.length, search: stats }) });
      } else if (spec.kind === 'count' || spec.kind === 'dirSize') {
        const roots = spec.paths ?? [spec.path];
        let files = 0;
        let dirCount = 0;
        let bytes = 0;
        for (const p of roots) {
          const e = entryAt(p);
          const list = e?.kind === 'directory' ? [e, ...walk(p, null, [], true)] : e ? [e] : [];
          for (const x of list) {
            if (x.kind === 'directory') dirCount++;
            else {
              files++;
              bytes += x.size ?? 0;
            }
          }
        }
        const dirSize = { files, dirs: dirCount, bytes, unreadable: 0, cancelled: false };
        send({ type: 'added', job: jobInfo(id, spec, 'running') });
        send({ type: 'finished', id, state: 'done', summary: summary({ dirSize }) });
      } else if (spec.kind === 'diskUsage') {
        send({ type: 'added', job: jobInfo(id, spec, 'running') });
        const entries = scans[id].length;
        const diskUsage = { complete: true, entries, unreadable: 0, simplified: false, elapsedMs: 840 };
        send({ type: 'finished', id, state: 'done', summary: summary({ itemsDone: entries, diskUsage }) });
      } else {
        // copy, move, delete, …: shown as running – screenshots never wait for an end
        send({ type: 'added', job: jobInfo(id, spec, 'running', { itemsTotal: 1 }) });
      }
    }, 0);
    return id;
  }

  // ---- disk usage (design 033): a scan of the demo tree, kept here like Rust keeps it --------
  // Scene option `mock.bigFiles`: a few large files in otherwise empty folders, so the chart
  // has something to show (only for that scene – other screenshots stay as they are).
  if (cfg.mock?.bigFiles) {
    const big = (name, size, modified) => ({
      name,
      kind: 'file',
      targetKind: null,
      size,
      modifiedMs: Date.parse(`${modified}Z`),
      hidden: name.startsWith('.'),
      lossyName: false,
    });
    const add = (dir, list) => (dirs[dir] = [...(dirs[dir] ?? []), ...list]);
    add(`${home}/Videos`, [
      big('Dolomites 4K.mp4', Math.round(4.2 * gb), '2026-07-02T19:30:00'),
      big('Wedding Anna & Tom.mov', Math.round(2.7 * gb), '2026-06-14T22:10:00'),
      big('Drone flight Lake Garda.mp4', Math.round(1.1 * gb), '2026-09-08T18:05:00'),
    ]);
    add(`${home}/.cache`, [
      big('pnpm-store.tar', Math.round(1.6 * gb), '2026-10-20T08:00:00'),
      big('playwright-chromium.zip', Math.round(620 * mb), '2026-10-12T09:30:00'),
    ]);
    add(`${home}/Projects/guiexpert-table`, [
      big('node_modules.tar', Math.round(980 * mb), '2026-10-15T14:00:00'),
      big('demo-recording.mov', Math.round(410 * mb), '2026-10-01T11:20:00'),
    ]);
    add(`${home}/Downloads`, [big('ubuntu-26.04-desktop-arm64.iso', Math.round(3.4 * gb), '2026-10-19T20:00:00')]);
  }

  // Scene option `mock.duplicates`: copies under other names (design 016 E6/042), so the
  // duplicate tab has groups to show – only for that scene.
  if (cfg.mock?.duplicates) {
    const copy = (name, size, modified) => ({
      name,
      kind: 'file',
      targetKind: null,
      size,
      modifiedMs: Date.parse(`${modified}Z`),
      hidden: false,
      lossyName: false,
    });
    const add = (dir, list) => (dirs[dir] = [...(dirs[dir] ?? []), ...list]);
    add(`${home}/Downloads`, [
      copy('Lease agreement (1).pdf', 845 * 1024, '2026-10-03T09:12:00'),
      copy('cover.jpg', 380 * 1024, '2026-09-30T21:40:00'),
      copy('Budget 2026 - Kopie.xlsx', 38 * 1024, '2026-10-17T08:05:00'),
    ]);
  }

  /** Duplicates of the demo tree: files of the same size (the mock has no contents). */
  function duplicateHits(c) {
    if (c.mode === 'similarImages') return similarImageHits();
    const bySize = new Map();
    for (const root of c.roots ?? []) {
      for (const e of walk(root, null, c.excludes ?? [], c.includeHidden)) {
        if (e.kind !== 'file' || (e.size ?? 0) < (c.minSize ?? 1)) continue;
        const list = bySize.get(e.size) ?? [];
        list.push(e);
        bySize.set(e.size, list);
      }
    }
    const groups = [...bySize.values()]
      .filter((g) => g.length > 1)
      .sort((a, b) => b[0].size * (b.length - 1) - a[0].size * (a.length - 1));
    return groups.flatMap((g, i) =>
      g.map((e) => {
        const dir = parentOf(e.path);
        const names = dir.split('/').filter(Boolean).reverse();
        return { ...e, dir, parentNames: [names[0] ?? '', names[1] ?? '', names[2] ?? ''], group: i + 1 };
      }),
    );
  }

  /**
   * Similar images (design 042 E6): each photo of `Edited` next to its original. The mock
   * has no pixels – groups, sizes and distances are made up, the thumbnails of one group
   * show the same demo picture (token = original name, `#variant`).
   */
  function similarImageHits() {
    const pairs = [
      ['IMG_4712.jpg', 'Edited/IMG_4712 edited.jpg', 4],
      ['IMG_4738.jpg', 'Edited/IMG_4738 edited.jpg', 3],
      ['IMG_4752.jpg', 'Edited/IMG_4752 square.jpg', 6],
      ['IMG_4760.jpg', 'Edited/IMG_4760 small.png', 1],
    ];
    const sizes = [
      [4000, 3000],
      [2400, 1800],
    ];
    let order = 0;
    return pairs.flatMap(([a, b, distance], i) =>
      [a, b].map((rel, k) => {
        const path = `${photoDir}/${rel}`;
        const e = entryAt(path);
        const dir = parentOf(path);
        const names = dir.split('/').filter(Boolean).reverse();
        return {
          ...e,
          path,
          dir,
          relDir: '',
          parentNames: [names[0] ?? '', names[1] ?? '', names[2] ?? ''],
          group: i + 1,
          order: order++,
          width: sizes[k][0],
          height: rel.includes('square') && k ? 1800 : sizes[k][1],
          distance: k ? distance : 0,
        };
      }),
    );
  }

  /** Thumbnail token: the original's name, so a group shows the same picture. */
  const thumbToken = (path) => {
    const name = nameOf(path);
    const m = /^(IMG_\d+)/.exec(name);
    return m ? `${m[1]}.jpg${name.includes(' ') ? '#v' : ''}` : name;
  };

  const scans = {};

  function buildScan(roots) {
    const nodes = [];
    const push = (name, path, kind, parent, modifiedMs, size = 0) => {
      const id = nodes.length;
      nodes.push({ id, name, path, kind, parent, modifiedMs, size, files: 0, dirs: 0, children: [] });
      if (parent !== null) nodes[parent].children.push(id);
      return id;
    };
    const fill = (id) => {
      const n = nodes[id];
      for (const e of entriesOf(n.path)) {
        if (e.kind === 'directory') {
          const c = push(e.name, e.path, 'dir', id, e.modifiedMs);
          fill(c);
          n.size += nodes[c].size;
          n.files += nodes[c].files;
          n.dirs += nodes[c].dirs + 1;
        } else {
          push(e.name, e.path, e.kind === 'symlink' ? 'link' : 'file', id, e.modifiedMs, e.size ?? 0);
          n.size += e.size ?? 0;
          n.files += 1;
        }
      }
      n.children.sort((a, b) => nodes[b].size - nodes[a].size);
    };
    if (roots.length === 1) {
      fill(push(nameOf(roots[0]), roots[0], 'dir', null, null));
    } else {
      const top = push('', null, 'dir', null, null);
      for (const r of roots) {
        const c = push(nameOf(r), r, 'dir', top, null);
        fill(c);
        nodes[top].size += nodes[c].size;
        nodes[top].files += nodes[c].files;
        nodes[top].dirs += nodes[c].dirs + 1;
      }
    }
    return nodes;
  }

  function usageNode(nodes, id, depth, threshold, limit) {
    const n = nodes[id];
    const out = {
      id,
      name: n.name,
      path: n.path,
      kind: n.kind,
      allocated: n.size,
      logical: n.size,
      files: n.files,
      dirs: n.dirs,
      unreadable: 0,
      modifiedMs: n.modifiedMs,
      lossyName: false,
    };
    if (depth > 0 && n.kind === 'dir') {
      const shown = [];
      let rest = { count: 0, size: 0 };
      for (const c of n.children) {
        if (shown.length < limit && nodes[c].size >= threshold) {
          shown.push(usageNode(nodes, c, depth - 1, threshold, limit));
        } else {
          rest = { count: rest.count + 1, size: rest.size + nodes[c].size };
        }
      }
      if (rest.count > 0) {
        shown.push({ ...out, id, name: '', path: null, kind: 'rest', allocated: rest.size, logical: rest.size, files: rest.count, dirs: 0, modifiedMs: null });
      }
      out.children = shown;
    }
    return out;
  }

  const chainOf = (nodes, id) => {
    const out = [];
    for (let c = id; c !== null; c = nodes[c].parent) out.unshift(c);
    return out;
  };

  function usageView(a) {
    const nodes = scans[a?.scanId];
    if (!nodes) throw fsError('scan_not_found', 'The scan is no longer available');
    const id = a?.nodeId ?? 0;
    const threshold = nodes[id].size * (a?.minFraction ?? 0);
    return {
      node: usageNode(nodes, id, a?.depth ?? 1, threshold, a?.limit ?? 2000),
      crumbs: chainOf(nodes, id).map((c) => ({ id: c, name: nodes[c].name })),
      virtualTop: nodes[0].path === null,
      running: false,
      complete: true,
      simplified: false,
      scannedAtMs: Date.parse('2026-10-21T10:12:00Z'),
      version: 1,
      sizeMode: 'allocated',
      volume: null,
      scannedAllocated: nodes[0].size,
    };
  }

  function usageLargest(a) {
    const nodes = scans[a?.scanId];
    if (!nodes) throw fsError('scan_not_found', 'The scan is no longer available');
    const base = nodes[a?.nodeId ?? 0];
    const files = [];
    const visit = (id) => {
      for (const c of nodes[id].children) {
        if (nodes[c].kind === 'dir') visit(c);
        else if (nodes[c].kind === 'file') files.push(c);
      }
    };
    visit(base.id);
    return files
      .sort((x, y) => nodes[y].size - nodes[x].size)
      .slice(0, a?.limit ?? 100)
      .map((c) => {
        const n = nodes[c];
        const dir = parentOf(n.path);
        return {
          id: c,
          name: n.name,
          path: n.path,
          dir: base.path && dir.startsWith(base.path) ? dir.slice(base.path.length + 1) : dir,
          dirId: n.parent,
          ancestors: chainOf(nodes, n.parent),
          allocated: n.size,
          logical: n.size,
          modifiedMs: n.modifiedMs,
          lossyName: false,
        };
      });
  }

  // ---- viewer, quick view, properties ---------------------------------------------------
  const FORMATS = {
    jpg: { id: 'jpeg', label: 'JPEG image', mime: 'image/jpeg', family: 'image', displayableImage: true },
    png: { id: 'png', label: 'PNG image', mime: 'image/png', family: 'image', displayableImage: true },
    md: { id: 'markdown', label: 'Markdown', mime: 'text/markdown', family: 'text', displayableImage: false },
    txt: { id: 'text', label: 'Text', mime: 'text/plain', family: 'text', displayableImage: false },
    json: { id: 'json', label: 'JSON', mime: 'application/json', family: 'text', displayableImage: false },
    ts: { id: 'typescript', label: 'TypeScript', mime: 'text/x-typescript', family: 'text', displayableImage: false },
    zip: { id: 'zip', label: 'ZIP archive', mime: 'application/zip', family: 'archive', displayableImage: false },
    mp4: { id: 'mp4', label: 'MPEG-4 video', mime: 'video/mp4', family: 'media', displayableImage: false },
  };
  const BINARY = { id: 'binary', label: 'Binary data', mime: null, family: 'binary', displayableImage: false };
  const formatOf = (name) => FORMATS[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? null;

  function preview(path) {
    const e = entryAt(path);
    if (!e) throw fsError('not_found', 'not found', path);
    if (e.kind === 'directory') return { kind: 'directory' };
    const format = formatOf(e.name) ?? BINARY;
    const base = { size: e.size ?? 0, format, extMismatch: false };
    if (format.displayableImage) return { ...base, kind: 'image', token: e.name };
    const text = cfg.texts?.[path];
    if (text != null || format.family === 'text') {
      const body = text ?? `${e.name}\n`;
      return { ...base, kind: 'text', encoding: 'utf-8', text: body, truncated: false, lossy: false };
    }
    const bytes = Array.from({ length: 512 }, (_, i) => (i * 37 + e.name.length * 11) % 256);
    return { ...base, kind: 'binary', bytes, truncated: true };
  }

  function properties(path) {
    const e = entryAt(path);
    if (!e) throw fsError('not_found', 'not found', path);
    const dir = e.kind === 'directory';
    return {
      name: e.name,
      path: e.path,
      kind: e.kind,
      targetKind: e.targetKind,
      linkTarget: null,
      size: e.size,
      createdMs: e.modifiedMs == null ? null : e.modifiedMs - 86400000 * 3,
      modifiedMs: e.modifiedMs,
      accessedMs: e.modifiedMs == null ? null : e.modifiedMs + 3600000 * 5,
      readonly: false,
      format: dir ? null : (formatOf(e.name) ?? BINARY),
      unix: { mode: dir ? 0o40755 : 0o100644, uid: 501, gid: 20, owner: 'marc', group: 'staff' },
      windows: null,
    };
  }

  /** Jobs the task list shows when a scene sets `"mock": { "jobs": true }`. */
  function demoJobs() {
    const photos = (dirs[`${home}/Pictures/Italy 2026`] ?? []).filter((e) => e.kind === 'file');
    const sources = photos.slice(0, 12).map((e) => `${home}/Pictures/Italy 2026/${e.name}`);
    const total = photos.slice(0, 12).reduce((n, e) => n + (e.size ?? 0), 0);
    const backup = '/Volumes/Backup/Photos';
    return [
      jobInfo(
        'demo-1',
        { kind: 'copy', sources, targetDir: backup },
        'running',
        {
          bytesDone: Math.round(total * 0.62),
          bytesTotal: total,
          itemsDone: 7,
          itemsTotal: 12,
          current: sources[7],
          rateBps: 48 * mb,
        },
      ),
      jobInfo(
        'demo-2',
        { kind: 'move', sources: [`${home}/Downloads/setup.exe`], targetDir: `${home}/Documents` },
        'queued',
        { itemsTotal: 1, bytesTotal: 92 * mb },
      ),
      jobInfo(
        'demo-3',
        { kind: 'delete', paths: [`${home}/Downloads/invoice-2026-09.pdf`], mode: 'trash' },
        'done',
        { itemsDone: 1, itemsTotal: 1 },
        summary({ itemsDone: 1 }),
      ),
    ];
  }

  /** A copy job waiting for the conflict question (scene option `mock.conflict`). */
  function conflictJob() {
    const source = `${photoDir}/IMG_4738.jpg`;
    const target = `/Volumes/Backup/Photos/IMG_4738.jpg`;
    const src = entryAt(source);
    return {
      ...jobInfo(
        'demo-conflict',
        { kind: 'copy', sources: [source, `${photoDir}/IMG_4740.jpg`], targetDir: '/Volumes/Backup/Photos' },
        'waitingForDecision',
        { itemsDone: 3, itemsTotal: 12, bytesDone: 11 * mb, bytesTotal: 46 * mb, current: source },
      ),
      conflict: {
        conflictId: 1,
        kind: 'exists',
        source,
        target,
        sourceMeta: { size: src?.size ?? 3 * mb, modifiedMs: src?.modifiedMs ?? null, isDir: false },
        targetMeta: { size: 2 * mb + 417 * 1024, modifiedMs: Date.parse('2026-08-14T09:20:00Z'), isDir: false },
        suggestedName: 'IMG_4738 (1).jpg',
      },
    };
  }

  /** `run_shell`: a made-up `git status` – nothing is executed. */
  function runShell(args) {
    const id = `job-${++jobNo}`;
    const command = args?.command ?? '';
    setTimeout(() => {
      send({ type: 'added', job: jobInfo(id, { kind: 'shell', cwd: args?.cwd ?? home, command }, 'running') });
      const text = [
        'On branch main',
        'Changes not staged for commit:',
        '\tmodified:   README.md',
        '\tmodified:   scripts/screenshots/scenes.json',
        '',
        'Untracked files:',
        '\tsite/',
      ].join('\n');
      send({ type: 'shellOutput', id, chunks: [{ stream: 'stdout', text }], dropped: 0 });
      send({ type: 'finished', id, state: 'done', summary: summary({ shell: { exitCode: 0, signal: null } }) });
    }, 50);
    return { type: 'started', jobId: id, notices: [] };
  }

  // ---- command table -----------------------------------------------------------------
  const handlers = {
    list_directory: listDirectory,
    resolve_location: resolveLocation,
    check_paths: (a) => (a?.paths ?? []).map((path) => ({ path, danger: null })),
    describe_paths: (a) => {
      const entries = (a?.paths ?? []).map(entryAt).filter(Boolean);
      return { entries, parent: entries.length ? parentOf(entries[0].path) : null, missing: 0 };
    },
    load_session: () => ({ session: cfg.session, warning: null, adjusted: [] }),
    load_settings: () => ({ settings: cfg.settings, warnings: [], persist: false }),
    save_settings: () => [],
    load_themes: () => ({
      file: {
        version: 1,
        selection: {
          mode: 'fixed',
          theme: cfg.theme,
          light: 'classic-light',
          dark: 'classic-coffee',
        },
        themes: [],
      },
      warning: null,
    }),
    load_keymap_override: () => ({ bindings: {}, warning: null }),
    get_app_info: () => ({
      name: 'Files and Folders',
      version: cfg.appVersion,
      crateVersion: cfg.appVersion,
      tauriVersion: '2',
      os: cfg.platform,
      arch: 'aarch64',
      debug: false,
    }),
    list_volumes: () => [
      { path: '/', label: 'System', kind: 'fixed', fsType: 'apfs', total: 994 * gb, free: 412 * gb, reachable: true },
      { path: '/Volumes/Backup', label: 'Backup', kind: 'removable', fsType: 'exfat', total: 2000 * gb, free: 731 * gb, reachable: true },
      { path: '/Volumes/nas', label: 'nas', kind: 'network', fsType: 'smbfs', total: 8000 * gb, free: 3100 * gb, reachable: true },
    ],
    load_tools: () => ({
      tools: [
        { id: 'edit', label: 'Edit', shortcut: null, perFile: false, fileLimit: 50, needsFiles: true, program: 'code' },
        { id: 'vscode', label: 'Open in VS Code', shortcut: null, perFile: false, fileLimit: 50, needsFiles: true, program: 'code' },
      ],
      warnings: [],
      file: `${home}/.config/files-and-folders/tools.json`,
    }),
    // configuration files of 022/032: none changed by the user
    load_buttons: () => ({ value: { sets: {} }, warning: null }),
    load_file_types: () => ({ value: null, warning: null }),
    // compare files (design 037): a small, made-up difference of two tsconfig files
    diff_files: () => {
      const eq = (l, r, a, b = a) => ({ kind: 'equal', left: [l, a], right: [r, b] });
      return {
        kind: 'text',
        left: { size: 409, encoding: 'utf-8', eol: 'lf' },
        right: { size: 988, encoding: 'utf-8', eol: 'lf' },
        rows: [
          eq(1, 1, '{'),
          { kind: 'changed', left: [2, '  "extends": "./tsconfig.json",'], right: [2, '  "compileOnSave": false,'] },
          eq(3, 3, '  "compilerOptions": {'),
          { kind: 'changed', left: [4, '    "outDir": "./out-tsc/spec",'], right: [4, '    "outDir": "./dist/out-tsc",'] },
          { kind: 'added', left: null, right: [5, '    "strict": true,'] },
          { kind: 'added', left: null, right: [6, '    "noImplicitOverride": true,'] },
          eq(5, 7, '    "types": ["vitest/globals"]'),
          eq(6, 8, '  },'),
          { kind: 'skip', left: null, right: null, skipped: 12 },
          eq(19, 21, '  "include": ['),
          { kind: 'removed', left: [20, '    "src/**/*.spec.ts",'], right: null },
          eq(21, 22, '    "src/**/*.d.ts"'),
          eq(22, 23, '  ]'),
          eq(23, 24, '}'),
        ],
        changes: 3,
        truncated: false,
      };
    },
    // folder memory of 027: nothing kept yet
    load_folder_memory: () => ({ value: { version: 1, tabs: [] }, warning: null }),
    run_shell: runShell,
    duplicate_thumbnails: (a) => (a?.paths ?? []).map((p) => (/\.(jpe?g|png)$/i.test(p) ? thumbToken(p) : null)),
    load_starter: () => ({
      items: [
        { id: 's1', kind: 'program', label: 'VS Code', program: 'code', params: '"%P%N"' },
        { id: 's2', kind: 'program', label: 'GIMP', program: 'gimp', params: '%S' },
        { id: 's3', kind: 'program', label: 'Terminal here', program: 'gnome-terminal', workingDir: '%P' },
        { id: 's4', kind: 'separator' },
        { id: 's5', kind: 'folder', label: 'Projects', folder: '~/Projects' },
        { id: 's6', kind: 'folder', label: 'Backup drive', folder: '/Volumes/Backup' },
        { id: 's7', kind: 'separator' },
        {
          id: 's8',
          kind: 'submenu',
          label: 'Scripts',
          items: [
            { id: 's9', kind: 'program', label: 'Resize photos', program: '~/bin/resize.sh', params: '%S' },
            { id: 's10', kind: 'program', label: 'Upload to server', program: '~/bin/upload.sh', params: '"%P%N"' },
          ],
        },
      ],
      warning: null,
      problems: [],
      file: `${home}/.config/files-and-folders/starter.json`,
    }),
    load_connections: () => ({
      profiles: connections(),
      states: { k3x9a2: 'connected' },
      keychain: true,
      sessionSecrets: [],
      warning: null,
    }),
    subscribe_remote: () => null,
    load_rename_presets: () => ({ presets: { version: 1, last: null, presets: [] }, warning: null }),
    plan_rename: (a) => {
      const rows = (a?.items ?? []).map((it) => ({
        status: nameOf(it.path) === it.newName ? 'unchanged' : 'ok',
        error: null,
      }));
      const ok = rows.filter((r) => r.status === 'ok').length;
      return { rows, ok, unchanged: rows.length - ok, errors: 0 };
    },
    load_shell_history: () => ['git status', 'pnpm check', 'ls -la'],
    subscribe_jobs: (a) => {
      jobChannel = a?.onEvent ?? null;
      if (cfg.mock?.conflict) return [conflictJob()];
      return cfg.mock?.jobs ? demoJobs() : [];
    },
    list_jobs: () => [],
    start_job: startJob,
    disk_usage_view: usageView,
    disk_usage_largest: usageLargest,
    disk_usage_locate: (a) => scans[a?.scanId]?.find((n) => n.path === a?.path)?.id ?? null,
    disk_usage_prune: () => [],
    disk_usage_release: (a) => {
      delete scans[a?.scanId];
    },
    watch_dirs: (a) =>
      (a?.dirs ?? []).map((dir) => ({ dir, mode: 'native', reason: null, modifiedMs: null })),
    find_empty_dirs: (a) => {
      const roots = a?.roots ?? [];
      const below = Object.keys(dirs).filter((d) => roots.some((r) => d.startsWith(`${r}/`)));
      const items = below.filter((d) => dirs[d].length === 0).map((path) => ({ path, kind: 'dir' }));
      return { items, unreadable: [], unreadableMore: 0, truncated: false, cancelled: false, visited: below.length };
    },
    create_folders: () => ({ created: [], errors: [] }),
    get_properties: (a) => properties(a?.path),
    read_preview: (a) => preview(a?.path),
  };

  async function invoke(cmd, args) {
    if (cmd.startsWith('plugin:')) return null;
    const handler = handlers[cmd];
    if (!handler) return null; // saves, subscriptions, window chrome, menus …
    return handler(args);
  }

  // ---- what @tauri-apps/api/core expects (cf. node_modules/@tauri-apps/api/mocks.js) -
  const callbacks = new Map();
  let nextId = 1;
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback(callback, once = false) {
      const id = nextId++;
      callbacks.set(id, (data) => {
        if (once) callbacks.delete(id);
        return callback && callback(data);
      });
      return id;
    },
    unregisterCallback: (id) => callbacks.delete(id),
    runCallback: (id, data) => callbacks.get(id)?.(data),
    callbacks,
    convertFileSrc: (path, protocol = 'asset') =>
      protocol === 'fnfpreview'
        ? `/__demo-image/${encodeURIComponent(path)}`
        : `${protocol}://localhost/${encodeURIComponent(path)}`,
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
})();
