import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { DirEntry } from '../../core/fs/fs.models';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { PreviewApi } from '../../core/preview/preview-api';
import { Format, Properties } from '../../core/preview/preview.models';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakePreviewApi, textPreview } from '../../../testing/fake-preview-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerPreviewActions } from './preview-actions';
import { previewNotes } from './preview-notes';
import { PREVIEW_PROVIDERS, providerFor } from './preview-providers';
import { propertyRows } from './properties-dialog';
import { PropertiesStore } from './properties.store';
import { QuickViewStore } from './quick-view.store';
import { ViewerStore } from './viewer.store';
import { TextView } from './views/text-view';
import { DEFAULT_CONTEXT } from './preview-providers';
import { findMatches } from './text-search';

const flush = () => new Promise((r) => setTimeout(r));
const PNG: Format = {
  id: 'png',
  label: 'PNG image',
  mime: 'image/png',
  family: 'image',
  displayableImage: true,
};

describe('viewer, quick view and properties (design 010)', () => {
  let fsApi: FakeFsApi;
  let api: FakePreviewApi;
  let jobsApi: FakeJobsApi;
  let actions: ActionService;
  let dialogs: DialogService;
  let ws: WorkspaceStore;
  let viewer: ViewerStore;
  let quick: QuickViewStore;
  let props: PropertiesStore;
  let left: FileBrowserStore;
  let right: FileBrowserStore;
  let moved: string[];
  const entries: DirEntry[] = [
    dir('Ordner', { path: '/src/Ordner' }),
    entry('a.txt', { path: '/src/a.txt' }),
    dir('Zwischen', { path: '/src/Zwischen' }),
    entry('bild.txt', { path: '/src/bild.txt' }),
    entry('link', { path: '/src/link', kind: 'symlink', targetKind: 'file' }),
  ];

  beforeEach(async () => {
    moved = [];
    fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) => Promise.resolve(listing(path ?? '/src', entries));
    api = new FakePreviewApi();
    jobsApi = new FakeJobsApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fsApi },
        { provide: PreviewApi, useValue: api },
        { provide: JobsApi, useValue: jobsApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    actions = TestBed.inject(ActionService);
    dialogs = TestBed.inject(DialogService);
    ws = TestBed.inject(WorkspaceStore);
    viewer = TestBed.inject(ViewerStore);
    quick = TestBed.inject(QuickViewStore);
    props = TestBed.inject(PropertiesStore);
    quick.debounceMs = 0;
    await TestBed.inject(JobsStore).init();
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const controller = {
      displayedEntries: () => left.visibleEntries(),
      moveCursorTo: (path: string) => {
        moved.push(path);
        left.setCursor(path);
        return true;
      },
    } as unknown as FileListController;
    ws.registerPanel('left', { store: left, controller: () => controller });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerPreviewActions(actions, ws, viewer, quick, props);
    await left.load('/src');
  });

  it('F3 needs a file under the cursor, properties anything but ".."', () => {
    left.setCursor('/src/Ordner');
    expect(actions.state('OPEN_VIEW_DLG')).toBe('disabled');
    expect(actions.state('OPEN_ATTRIBUTE_DLG')).toBe('ready');
    expect(actions.state('QUICK_VIEW')).toBe('ready');
    left.setCursor('/src/link');
    expect(actions.state('OPEN_VIEW_DLG')).toBe('ready');
    left.setCursor('/');
    expect(actions.state('OPEN_ATTRIBUTE_DLG')).toBe('disabled');
  });

  it('opens the viewer, steps through files only and moves the panel cursor', async () => {
    left.setCursor('/src/a.txt');
    await actions.run('OPEN_VIEW_DLG');
    await flush();
    expect(dialogs.open()).toBe('viewer');
    expect(api.reads[0]).toEqual({
      path: '/src/a.txt',
      options: { encoding: 'auto', mode: 'auto', imageSlot: 'viewer' },
    });
    expect(viewer.position()).toEqual({ index: 1, count: 3 });
    viewer.step(1); // skips the folder "Zwischen"
    await flush();
    expect(viewer.entry()?.path).toBe('/src/bild.txt');
    expect(moved).toEqual(['/src/bild.txt']);
    expect(left.cursorPath()).toBe('/src/bild.txt');
    viewer.step(1);
    viewer.step(1); // already the last file
    expect(viewer.entry()?.path).toBe('/src/link');
    viewer.step(-1);
    viewer.step(-1);
    viewer.step(-1);
    expect(viewer.entry()?.path).toBe('/src/a.txt');
    viewer.close();
    expect(dialogs.open()).toBeNull();
    expect(left.cursorPath()).toBe('/src/a.txt');
  });

  it('reloads with another encoding or mode and drops stale answers', async () => {
    left.setCursor('/src/a.txt');
    viewer.open();
    await flush();
    viewer.setEncoding('windows-1252');
    viewer.setMode('hex');
    expect(api.reads.at(-1)?.options).toEqual({
      encoding: 'windows-1252',
      mode: 'hex',
      imageSlot: 'viewer',
    });
    api.hold = true;
    api.previews.set('/src/a.txt', textPreview('old'));
    viewer.setEncoding('latin-1');
    api.previews.set('/src/a.txt', textPreview('new'));
    viewer.setEncoding('utf-8');
    api.release('lifo'); // the newer answer arrives first
    await flush();
    const p = viewer.preview();
    expect(p?.kind === 'text' && p.text).toBe('new');
  });

  it('searches the text and wraps around', async () => {
    api.previews.set('/src/a.txt', textPreview('Ab ab\nkein\nAB'));
    left.setCursor('/src/a.txt');
    viewer.open();
    await flush();
    viewer.setQuery('ab');
    expect(viewer.matches()).toHaveLength(3);
    expect(viewer.current()).toBe(0);
    viewer.findNext(-1);
    expect(viewer.current()).toBe(2);
    viewer.findNext(1);
    expect(viewer.current()).toBe(0);
    viewer.setQuery('zz');
    expect(viewer.current()).toBe(-1);
  });

  it('quick view: the other panel previews the cursor, debounced, stale answers dropped', async () => {
    left.setCursor('/src/a.txt');
    await actions.run('QUICK_VIEW');
    expect(quick.shownOn()).toBe('right');
    await flush();
    await flush();
    expect(api.reads.map((r) => r.path)).toEqual(['/src/a.txt']);
    expect(api.reads[0].options.maxTextBytes).toBe(256 * 1024);
    quick.debounceMs = 5;
    left.setCursor('/src/bild.txt');
    TestBed.tick();
    left.setCursor('/src/link');
    TestBed.tick();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.reads.map((r) => r.path)).toEqual(['/src/a.txt', '/src/link']);
    // a slow answer for an old cursor does not replace the new one
    quick.debounceMs = 0;
    api.previews.set('/src/Ordner', { kind: 'directory' });
    api.hold = true;
    left.setCursor('/src/a.txt');
    TestBed.tick();
    await flush();
    left.setCursor('/src/Ordner');
    TestBed.tick();
    await flush();
    api.release('lifo');
    await flush();
    expect(quick.entry()?.path).toBe('/src/Ordner');
    expect(quick.preview()?.kind).toBe('directory');
    await actions.run('QUICK_VIEW');
    TestBed.tick();
    expect(quick.shownOn()).toBeNull();
    expect(quick.preview()).toBeNull();
  });

  it('quick view: down/up within the debounce while loading does not hang in loading (review 1)', async () => {
    left.setCursor('/src/a.txt');
    await actions.run('QUICK_VIEW');
    await flush();
    await flush();
    quick.debounceMs = 5;
    api.hold = true; // slow answer for bild.txt
    left.setCursor('/src/bild.txt');
    TestBed.tick();
    await new Promise((r) => setTimeout(r, 15));
    expect(quick.loading()).toBe(true);
    left.setCursor('/src/link'); // ↓
    TestBed.tick();
    left.setCursor('/src/bild.txt'); // ↑ within the debounce
    TestBed.tick();
    await new Promise((r) => setTimeout(r, 15));
    api.release();
    await flush();
    await flush();
    expect(quick.entry()?.path).toBe('/src/bild.txt');
    expect(quick.loading()).toBe(false);
    expect(quick.preview()?.kind).toBe('text');
    expect(api.reads.map((r) => r.path)).toEqual(['/src/a.txt', '/src/bild.txt']);
  });

  it('properties: loads and calculates a folder size as a job', async () => {
    api.properties = (path) => ({ ...props_(path), kind: 'directory', size: null, format: null });
    left.setCursor('/src/Ordner');
    await actions.run('OPEN_ATTRIBUTE_DLG');
    await flush();
    expect(dialogs.open()).toBe('properties');
    expect(props.props()?.path).toBe('/src/Ordner');
    const done = props.calcSize();
    await flush();
    expect(jobsApi.started[0].spec).toEqual({ kind: 'dirSize', path: '/src/Ordner' });
    expect(props.size().state).toBe('running');
    jobsApi.emit({
      type: 'finished',
      id: jobsApi.started[0].id,
      state: 'done',
      summary: {
        itemsDone: 0,
        itemsSkipped: 0,
        itemsFailed: 0,
        bytesDone: 0,
        errors: [],
        error: null,
        dirSize: { files: 2, dirs: 1, bytes: 2048, unreadable: 0, cancelled: false },
      },
    });
    await done;
    expect(props.size()).toEqual({
      state: 'done',
      size: { files: 2, dirs: 1, bytes: 2048, unreadable: 0, cancelled: false },
    });
    props.close();
    expect(dialogs.open()).toBeNull();
  });

  it('rows of the properties dialog are platform-specific', () => {
    const rows = (p: Properties) =>
      Object.fromEntries(propertyRows(p).map((r) => [r.label, r.value]));
    const unix = rows(props_('/x/f.png'));
    expect(unix['Permissions']).toBe('rw-r--r-- (644)');
    expect(unix['Owner']).toBe('u : g');
    expect(unix['Type']).toBe('File · PNG image (image/png)');
    expect(unix['Size']).toContain('2.0 KB');
    const win = rows({
      ...props_('C:\\x'),
      unix: null,
      windows: { readonly: true, hidden: true, system: false, archive: true },
    });
    expect(win['Attributes']).toBe('Read-only, Hidden, Archive');
    expect(win['Permissions']).toBeUndefined();
    const link = rows({
      ...props_('/l'),
      kind: 'symlink',
      targetKind: null,
      linkTarget: 'nowhere',
    });
    expect(link['Link target']).toBe('nowhere (target missing)');
  });

  it('notes and providers', () => {
    const img = { kind: 'image' as const, size: 9, format: PNG, extMismatch: true, token: 't' };
    expect(previewNotes(img, 'bild.txt')).toEqual([
      'Content is PNG image, although the extension says .txt',
    ]);
    expect(previewNotes(textPreview('abc', { truncated: true, size: 2048 }), 'a')).toEqual([
      'Showing the first 3 B of 2.0 KB',
    ]);
    expect(providerFor(img).id).toBe('image');
    expect(providerFor(textPreview('')).id).toBe('text');
    expect(providerFor({ kind: 'directory' }).id).toBe('info');
    expect(PREVIEW_PROVIDERS.at(-1)?.id).toBe('info');
  });

  it('the text view builds lines with textContent only and marks matches', () => {
    const text = '<img src=x onerror="alert(1)">\nzwei <b>fett</b>\ndrei';
    const fixture = TestBed.createComponent(TextView);
    fixture.componentRef.setInput('preview', textPreview(text));
    fixture.componentRef.setInput('context', DEFAULT_CONTEXT);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const lines = [...el.querySelectorAll('.ln')];
    expect(lines.map((l) => l.textContent)).toEqual(text.split('\n'));
    expect(lines.map((l) => (l as HTMLElement).dataset['n'])).toEqual(['1', '2', '3']);
    expect(el.querySelector('img, b')).toBeNull();
    const matches = findMatches(text.split('\n'), 'b');
    fixture.componentRef.setInput('context', { ...DEFAULT_CONTEXT, matches, current: 1 });
    fixture.detectChanges();
    expect(el.querySelectorAll('mark')).toHaveLength(2);
    expect(el.querySelector('mark.current')?.textContent).toBe('b');
    expect(lines[1].textContent).toBe('zwei <b>fett</b>');
    expect(el.querySelector('b')).toBeNull();
    fixture.componentRef.setInput('context', DEFAULT_CONTEXT);
    fixture.detectChanges();
    expect(el.querySelectorAll('mark')).toHaveLength(0);
  });

  it('the text view fills blocks lazily and only once splits lines (review 3)', () => {
    const observed: Element[] = [];
    let fire: (els: Element[]) => void = () => undefined;
    class FakeIO {
      constructor(cb: (entries: { target: Element; isIntersecting: boolean }[]) => void) {
        fire = (els) => cb(els.map((target) => ({ target, isIntersecting: true })));
      }
      observe(el: Element) {
        observed.push(el);
      }
      unobserve = (): void => undefined;
      disconnect = (): void => undefined;
    }
    const g = globalThis as { IntersectionObserver?: unknown };
    const saved = g.IntersectionObserver;
    g.IntersectionObserver = FakeIO;
    try {
      const lines = Array.from({ length: 1200 }, (_, i) => `Zeile ${i + 1}`);
      const fixture = TestBed.createComponent(TextView);
      fixture.componentRef.setInput('preview', textPreview('ignored'));
      fixture.componentRef.setInput('context', { ...DEFAULT_CONTEXT, lines });
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const blocks = [...el.querySelectorAll<HTMLElement>('.block')];
      expect(blocks).toHaveLength(3);
      expect(el.querySelectorAll('.ln')).toHaveLength(500); // only the first block
      expect(observed).toEqual([blocks[1], blocks[2]]);
      fire([blocks[2]]);
      expect(el.querySelectorAll('.ln')).toHaveLength(700);
      expect(blocks[2].querySelector('.ln')?.textContent).toBe('Zeile 1001');
      // a match in a block not filled yet: marked once the block is filled
      const matches = findMatches(lines, 'Zeile 900');
      fixture.componentRef.setInput('context', { ...DEFAULT_CONTEXT, lines, matches, current: 0 });
      fixture.detectChanges();
      expect(el.querySelector('mark.current')?.textContent).toBe('Zeile 900');
      expect(el.querySelectorAll('.ln')).toHaveLength(1200);
    } finally {
      g.IntersectionObserver = saved;
    }
  });

  it('the viewer splits the text once and hands the lines to the view (review 3)', async () => {
    api.previews.set('/src/a.txt', textPreview('a\nb\nab'));
    left.setCursor('/src/a.txt');
    viewer.open();
    await flush();
    const lines = viewer.context().lines;
    expect(lines).toEqual(['a', 'b', 'ab']);
    viewer.setQuery('a');
    expect(viewer.context().lines).toBe(lines);
  });

  function props_(path: string): Properties {
    return {
      name: 'f.png',
      path,
      kind: 'file',
      targetKind: null,
      linkTarget: null,
      size: 2048,
      createdMs: null,
      modifiedMs: 0,
      accessedMs: null,
      readonly: false,
      format: PNG,
      unix: { mode: 0o644, uid: 1, gid: 1, owner: 'u', group: 'g', flagsHidden: null },
      windows: null,
    };
  }
});
