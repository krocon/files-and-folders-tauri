import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { TableStateIf } from '@guiexpert/table';
import { FsApi } from '../../core/fs/fs-api';
import { DirectoryListing } from '../../core/fs/fs.models';
import { SessionApi } from '../../core/session/session-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { deferred, dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileList } from '../browser/file-list/file-list';
import { FilePanel } from './file-panel';
import { newTab, WorkspaceStore } from './workspace.store';

/** jsdom has no layout – the real table is tested end-to-end; here a stand-in. */
@Component({ selector: 'app-file-list', template: '<div class="stub-list" tabindex="0"></div>' })
class FileListStub {
  readonly labelledBy = input.required<string>();
  readonly openInNewTab = output<unknown>();
  readonly tableStateChanged = output<Partial<TableStateIf>>();
}

function withSegments(l: DirectoryListing, names: string[]): DirectoryListing {
  let path = '';
  const segments = names.map((name, i) => {
    path = i === 0 ? name : `${path === '/' ? '' : path}/${name}`;
    return { name, path };
  });
  return { ...l, segments };
}

describe('FilePanel', () => {
  let fs: FakeFsApi;
  let ws: WorkspaceStore;

  beforeEach(() => {
    fs = new FakeFsApi();
    fs.handler = (p) => {
      switch (p) {
        case '/data':
          return Promise.resolve(
            withSegments(
              listing('/data', [
                dir('Übersicht', { path: '/data/Übersicht' }),
                entry('a.txt', { path: '/data/a.txt', size: 1536 }),
                entry('b.txt', { path: '/data/b.txt', size: 512 }),
              ]),
              ['/', 'data'],
            ),
          );
        case '/other':
          return Promise.resolve(
            withSegments(listing('/other', [entry('x', { path: '/other/x' })]), ['/', 'other']),
          );
        case '/data/Übersicht':
          return Promise.resolve(
            withSegments(listing('/data/Übersicht', [], '/data'), ['/', 'data', 'Übersicht']),
          );
        case '/':
          return Promise.resolve(
            withSegments(listing('/', [dir('data', { path: '/data' })], null), ['/']),
          );
        default:
          return Promise.reject({ code: 'not_found', message: 'gone', path: p ?? null });
      }
    };
    TestBed.configureTestingModule({
      imports: [FilePanel],
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: SessionApi, useValue: new FakeSessionApi() },
      ],
    });
    TestBed.overrideComponent(FilePanel, {
      remove: { imports: [FileList] },
      add: { imports: [FileListStub] },
    });
    ws = TestBed.inject(WorkspaceStore);
    const first = newTab('/data');
    const second = {
      ...newTab('/other'),
      cursor: '/other/x',
      table: { version: 1 as const, sort: [] },
    };
    ws.restore({
      ...ws.snapshot(),
      panels: {
        left: { activeTab: 0, tabs: [first, second] },
        right: { activeTab: 0, tabs: [newTab('/data')] },
      },
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(FilePanel);
    fixture.componentRef.setInput('side', 'left');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const store = fixture.debugElement.injector.get(FileBrowserStore);
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, store, el, settle };
  }

  it('loads the active tab and writes the folder title back', async () => {
    const { el } = await render();
    expect(fs.calls).toEqual(['/data']);
    expect(ws.activeTab('left').title).toBe('data');
    const crumbs = [...el.querySelectorAll('.crumb')].map((c) => c.textContent?.trim());
    expect(crumbs).toEqual(['/', 'data']);
    expect(el.querySelectorAll('.sep')).toHaveLength(0);
    expect(el.querySelector('.crumb.current')?.getAttribute('aria-current')).toBe('location');
  });

  it('writes the folder back however late the listing arrives (both sides at once)', async () => {
    const pending: ReturnType<typeof deferred<DirectoryListing>>[] = [];
    fs.handler = () => {
      const d = deferred<DirectoryListing>();
      pending.push(d);
      return d.promise;
    };
    ws.restore({
      ...ws.snapshot(),
      panels: {
        left: { activeTab: 0, tabs: [newTab(null)] },
        right: { activeTab: 0, tabs: [newTab(null)] },
      },
    });
    const left = TestBed.createComponent(FilePanel);
    left.componentRef.setInput('side', 'left');
    const right = TestBed.createComponent(FilePanel);
    right.componentRef.setInput('side', 'right');
    left.detectChanges();
    right.detectChanges();
    await Promise.resolve();
    expect(fs.calls).toEqual([undefined, undefined]);
    const home = withSegments(listing('/home/u', []), ['/', 'home', 'u']);
    // resolve in reverse order, with change detection in between
    pending[1].resolve(home);
    await right.whenStable();
    right.detectChanges();
    pending[0].resolve(home);
    await left.whenStable();
    left.detectChanges();
    await right.whenStable();
    expect(ws.activeTab('left').title).toBe('u');
    expect(ws.activeTab('right').title).toBe('u');
    expect(ws.activeTab('right').path).toBe('/home/u');
  });

  it('shows the status line in the target format', async () => {
    const { el, store, settle } = await render();
    store.setMarked(['/data/a.txt', '/data/Übersicht'], true);
    await settle();
    const text = el.querySelector('.status')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(text).toBe('1.5 KB / 2.0 KB in 1 / 2 Files, 1 / 1 Folders');
    expect(el.querySelector('.status span')?.getAttribute('title')).toBe('1536 / 2048 bytes');
  });

  it('navigates via a breadcrumb segment, cursor on the folder it came from', async () => {
    const { el, store, settle } = await render();
    await store.load('/data/Übersicht');
    await settle();
    expect(ws.activeTab('left').path).toBe('/data/Übersicht');
    expect(ws.activeTab('left').history).toEqual(['/data']);
    const crumbs = [...el.querySelectorAll<HTMLButtonElement>('.crumb')];
    crumbs[1].click();
    await settle();
    expect(store.path()).toBe('/data');
    expect(store.cursorPath()).toBe('/data/Übersicht');
  });

  it('toggles the favourite star for the current folder', async () => {
    const { el, settle } = await render();
    const star = el.querySelector<HTMLButtonElement>('.star')!;
    expect(star.getAttribute('aria-pressed')).toBe('false');
    star.click();
    await settle();
    expect(ws.isFavorite('/data')).toBe(true);
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.textContent?.trim()).toBe('★');
  });

  it('saves the cursor of the old tab and restores cursor and table state of the new one', async () => {
    const { store, settle } = await render();
    store.setCursor('/data/b.txt');
    await settle();
    ws.selectTab('left', 1);
    await settle();
    expect(fs.calls.at(-1)).toBe('/other');
    expect(store.cursorPath()).toBe('/other/x');
    expect(store.takePendingTableState()).toEqual({ version: 1, sort: [] });
    expect(ws.panels().left.tabs[0].cursor).toBe('/data/b.txt');
    ws.selectTab('left', 0);
    await settle();
    expect(store.cursorPath()).toBe('/data/b.txt');
  });

  it('activates its side on pointer down and registers itself for actions', async () => {
    const { el, store } = await render();
    ws.setActive('right');
    el.querySelector('.status')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(ws.activeSide()).toBe('left');
    expect(ws.panel('left')?.store).toBe(store);
  });

  it('shows an error when the tab folder is gone and keeps the panel usable', async () => {
    ws.restore({
      ...ws.snapshot(),
      panels: { ...ws.snapshot().panels, left: { activeTab: 0, tabs: [newTab('/gone')] } },
    });
    const { el } = await render();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('does not exist');
  });

  it('marks its parts as the active panel', async () => {
    const { el, settle } = await render();
    ws.setActive('left');
    await settle();
    expect(el.querySelectorAll('.fnf-active-panel').length).toBe(4);
    ws.setActive('right');
    await settle();
    expect(el.querySelectorAll('.fnf-active-panel').length).toBe(0);
  });

  it('does not let a reload during a pending tab switch overwrite the new tab', async () => {
    const { store, settle } = await render();
    const slow = deferred<DirectoryListing>();
    const original = fs.handler;
    fs.handler = (p) => (p === '/other' ? slow.promise : original(p));
    ws.selectTab('left', 1);
    await settle();
    ws.requestReload('left'); // double click on the tab while /other is still loading
    await settle();
    expect(fs.calls.filter((c) => c === '/data')).toHaveLength(1);
    slow.resolve(
      withSegments(listing('/other', [entry('x', { path: '/other/x' })]), ['/', 'other']),
    );
    await settle();
    expect(store.path()).toBe('/other');
    expect(ws.panels().left.tabs[1].path).toBe('/other');
    expect(ws.panels().left.tabs[0].path).toBe('/data');
  });
});
