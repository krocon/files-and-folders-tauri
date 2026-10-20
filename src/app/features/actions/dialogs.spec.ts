import { JobsApi } from '../../core/jobs/jobs-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeTableBridge } from '../../../testing/fake-table-bridge';
import { entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { WorkspaceStore } from '../workspace/workspace.store';
import { MarkPatternDialog } from './mark-pattern-dialog';
import { ShortcutDialog } from './shortcut-dialog';
import { FileTypesStore } from '../config/file-types.store';

describe('dialogs', () => {
  let keymap: FakeKeymapApi;
  let store: FileBrowserStore;

  beforeEach(async () => {
    const fs = new FakeFsApi();
    fs.handler = () =>
      Promise.resolve(
        listing('/x', [
          entry('Foto 1.jpg', { path: '/x/1' }),
          entry('foto 2.JPG', { path: '/x/2' }),
          entry('Brief.pdf', { path: '/x/3' }),
        ]),
      );
    keymap = new FakeKeymapApi();
    TestBed.configureTestingModule({
      providers: [
        FileBrowserStore,
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: keymap },
      ],
    });
    store = TestBed.inject(FileBrowserStore);
    await store.load('/x');
    const bridge = new FakeTableBridge();
    const ctrl = new FileListController(bridge, store);
    ctrl.showRows(store.entries());
    TestBed.inject(WorkspaceStore).registerPanel('left', { store, controller: () => ctrl });
    TestBed.inject(ActionService).platform.set('linux');
    TestBed.inject(DialogService).show('mark-pattern');
  });

  it('mark by pattern: suggests the cursor extension, counts live, marks on submit', async () => {
    const fixture = TestBed.createComponent(MarkPatternDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input.value).toBe('*.jpg');
    expect(el.querySelector('.count')?.textContent).toContain('Matches 2 of 3');
    input.value = '([';
    input.dispatchEvent(new Event('input'));
    (el.querySelector('input[value="regex"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.error')).not.toBeNull();
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    input.value = 'pdf$';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect([...store.marked()]).toEqual(['/x/3']);
    expect(TestBed.inject(DialogService).open()).toBeNull();
  });

  it('mark by pattern: the presets are the file types (design 022 E7)', async () => {
    const fixture = TestBed.createComponent(MarkPatternDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const presets = [...el.querySelectorAll<HTMLButtonElement>('.presets button')];
    expect(presets.map((b) => b.textContent?.trim())).toEqual([
      'Movies',
      'Audio',
      'Images',
      'Documents',
      'Archives',
      'Source code',
      'Programs',
      'Fonts',
      'E-books',
      'Design files',
      '3D models',
      'Everything',
    ]);
    TestBed.inject(FileTypesStore).user.set([
      { label: 'Comics', extensions: ['.cbz', '.cbr'], icon: 'fa-book', color: null },
    ]);
    fixture.detectChanges();
    const first = el.querySelector<HTMLButtonElement>('.presets button')!;
    expect(first.textContent?.trim()).toBe('Comics');
    first.click();
    fixture.detectChanges();
    expect(el.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('*.cbz *.cbr');
  });

  it('shortcuts: records a new shortcut into the override, removes and resets', async () => {
    const fixture = TestBed.createComponent(ShortcutDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const row = () =>
      [...el.querySelectorAll('tbody tr')].find((r) =>
        r.querySelector('th')?.textContent?.includes('Reload'),
      )!;
    expect(row().querySelector('kbd')?.textContent).toBe('Ctrl+R');
    (row().querySelector('button') as HTMLButtonElement).click(); // Record
    fixture.detectChanges();
    row().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }),
    );
    row().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F9', code: 'F9', shiftKey: true, bubbles: true }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(keymap.saved.at(-1)).toEqual({ RELOAD_DIR: ['Shift+F9'] });
    expect(row().querySelector('kbd')?.textContent).toBe('Shift+F9');
    expect(row().textContent).toContain('changed');
    const [, remove, reset] = [...row().querySelectorAll('button')] as HTMLButtonElement[];
    remove.click();
    fixture.detectChanges();
    expect(keymap.saved.at(-1)).toEqual({ RELOAD_DIR: [] });
    reset.click();
    fixture.detectChanges();
    expect(keymap.saved.at(-1)).toEqual({});
    expect(row().querySelector('kbd')?.textContent).toBe('Ctrl+R');
  });
});
