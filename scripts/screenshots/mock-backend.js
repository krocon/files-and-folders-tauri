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

  function listDirectory(args) {
    const path = expand(args?.path ?? home);
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
      archive: null,
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
        hits.push({ ...e, dir, parentNames: [names[0] ?? '', names[1] ?? '', names[2] ?? ''] });
      }
    }
    return hits.slice(0, c.maxHits ?? 10000);
  }

  function startJob(args) {
    const spec = args?.spec ?? {};
    const id = `job-${++jobNo}`;
    setTimeout(() => {
      if (spec.kind === 'search') {
        const hits = searchHits(spec.criteria ?? {});
        const stats = {
          hits: hits.length,
          dirsScanned: 42,
          filesScanned: 615,
          unreadable: 0,
          elapsedMs: 38,
          truncated: false,
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
      } else {
        // copy, move, delete, …: shown as running – screenshots never wait for an end
        send({ type: 'added', job: jobInfo(id, spec, 'running', { itemsTotal: 1 }) });
      }
    }, 0);
    return id;
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
      return cfg.mock?.jobs ? demoJobs() : [];
    },
    list_jobs: () => [],
    start_job: startJob,
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
