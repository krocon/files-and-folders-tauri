import { TestBed } from '@angular/core/testing';
import { FsApi } from '../../core/fs/fs-api';
import { DirectoryListing } from '../../core/fs/fs.models';
import { deferred, dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowser } from './file-browser';

describe('FileBrowser', () => {
  let api: FakeFsApi;

  beforeEach(() => {
    api = new FakeFsApi();
    TestBed.configureTestingModule({
      imports: [FileBrowser],
      providers: [{ provide: FsApi, useValue: api }],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(FileBrowser);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
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

  it('renders the current path and entries including unicode names', async () => {
    api.handler = () =>
      Promise.resolve(
        listing('/Users/jörg/Mein Ordner', [dir('Übersicht'), entry('日本語 file.txt')]),
      );
    const { el } = await render();
    expect(el.querySelector('.path')?.textContent).toContain('/Users/jörg/Mein Ordner');
    const names = [...el.querySelectorAll('tbody .name')].map((n) => n.textContent);
    expect(names).toEqual(['Übersicht', '日本語 file.txt']);
    expect(el.querySelector('.status')?.textContent).toContain('1 folder, 1 other item');
  });

  it('shows the empty state', async () => {
    api.handler = () => Promise.resolve(listing('/empty', []));
    const { el } = await render();
    expect(el.querySelector('.empty')?.textContent).toContain('empty');
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

  it('navigates into a folder on double click and up via the button', async () => {
    api.handler = (p) =>
      Promise.resolve(
        p === '/home/Sub'
          ? listing('/home/Sub', [entry('inner.txt')], '/home')
          : listing('/home', [dir('Sub', { path: '/home/Sub' })], '/'),
      );
    const { el, fixture } = await render();
    el.querySelector('tbody tr')!.dispatchEvent(new MouseEvent('dblclick'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.path')?.textContent).toContain('/home/Sub');

    const upButton = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Up'))!;
    upButton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.calls.at(-1)).toBe('/home');
    expect(el.querySelector('tr.selected .name')?.textContent).toBe('Sub');
  });

  it('supports keyboard navigation (arrows, Enter, Backspace)', async () => {
    api.handler = (p) =>
      Promise.resolve(
        p === '/home/B'
          ? listing('/home/B', [], '/home')
          : listing('/home', [dir('A', { path: '/home/A' }), dir('B', { path: '/home/B' })], '/'),
      );
    const { el, fixture } = await render();
    const grid = el.querySelector('[role="grid"]') as HTMLElement;
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(el.querySelector('tr.selected .name')?.textContent).toBe('B');
    expect(grid.getAttribute('aria-activedescendant')).toBe('fnf-row-1');

    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(api.calls.at(-1)).toBe('/home/B');

    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    await fixture.whenStable();
    expect(api.calls.at(-1)).toBe('/home');
  });
});
