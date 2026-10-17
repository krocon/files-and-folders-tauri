import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FsApi } from '../../core/fs/fs-api';
import { DirectoryListing } from '../../core/fs/fs.models';
import { deferred, dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowser } from './file-browser';
import { FileBrowserStore } from './file-browser.store';
import { FileList } from './file-list/file-list';

/** jsdom has no layout – the real table is tested end-to-end; here a stand-in. */
@Component({ selector: 'app-file-list', template: '<div class="stub-list"></div>' })
class FileListStub {
  readonly labelledBy = input.required<string>();
}

describe('FileBrowser', () => {
  let api: FakeFsApi;

  beforeEach(() => {
    api = new FakeFsApi();
    TestBed.configureTestingModule({
      imports: [FileBrowser],
      providers: [{ provide: FsApi, useValue: api }],
    });
    TestBed.overrideComponent(FileBrowser, {
      remove: { imports: [FileList] },
      add: { imports: [FileListStub] },
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(FileBrowser);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const store = fixture.debugElement.injector.get(FileBrowserStore);
    return { fixture, el: fixture.nativeElement as HTMLElement, store };
  }

  it('shows a loading state while the backend is working', async () => {
    const pending = deferred<DirectoryListing>();
    api.handler = () => pending.promise;
    const fixture = TestBed.createComponent(FileBrowser);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.status')?.textContent).toContain('Loading');
    pending.resolve(listing('/home', []));
    await fixture.whenStable();
  });

  it('renders the current path, names the list with it and counts entries', async () => {
    api.handler = () =>
      Promise.resolve(
        listing('/Users/jörg/Mein Ordner', [dir('Übersicht'), entry('日本語 file.txt')]),
      );
    const { el, fixture } = await render();
    const path = el.querySelector('.path') as HTMLElement;
    expect(path.textContent).toContain('/Users/jörg/Mein Ordner');
    const list = fixture.debugElement.query((d) => d.componentInstance instanceof FileListStub);
    expect((list.componentInstance as FileListStub).labelledBy()).toBe(path.id);
    expect(el.querySelector('.status')?.textContent).toContain('1 folder, 1 other item');
  });

  it('shows marked count and the cursor entry in the status line', async () => {
    api.handler = () =>
      Promise.resolve(listing('/x', [entry('a', { path: '/x/a' }), entry('b', { path: '/x/b' })]));
    const { el, fixture, store } = await render();
    store.setCursor('/x/b');
    store.setMarked(['/x/a', '/x/b'], true);
    fixture.detectChanges();
    expect(el.querySelector('.status')?.textContent).toContain('2 marked');
    expect(el.querySelector('.selection')?.textContent).toBe('b');
  });

  it('shows an understandable error message instead of crashing', async () => {
    api.handler = () =>
      Promise.reject({
        code: 'permission_denied',
        message: 'Permission denied (os error 13)',
        path: '/root',
      });
    const { el, fixture } = await render();
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Access denied');
    expect(alert?.textContent).toContain('/root');
    (alert?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('goes up via the button and keeps the cursor on the folder it came from', async () => {
    api.handler = (p) =>
      Promise.resolve(
        p === '/home' || p === undefined
          ? listing('/home', [dir('Sub', { path: '/home/Sub' })], '/')
          : listing('/home/Sub', [entry('inner.txt')], '/home'),
      );
    const { el, fixture, store } = await render();
    await store.load('/home/Sub');
    fixture.detectChanges();
    const upButton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Up'))!;
    upButton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.calls.at(-1)).toBe('/home');
    expect(store.cursorEntry()?.name).toBe('Sub');
    expect(el.querySelector('.selection')?.textContent).toBe('Sub');
  });
});
