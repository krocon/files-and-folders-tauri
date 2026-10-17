import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FoldersApi } from '../../core/folders/folders-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { RenameApi } from '../../core/rename/rename-api';
import { SessionApi } from '../../core/session/session-api';
import { PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { FakeFoldersApi } from '../../../testing/fake-folders-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeRenameApi } from '../../../testing/fake-rename-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { CleanFoldersDialog } from '../cleanfolders/clean-dialog';
import { CleanFoldersStore } from '../cleanfolders/clean.store';
import { MultiMkdirDialog } from '../multimkdir/multimkdir-dialog';
import { MultiMkdirStore } from '../multimkdir/multimkdir.store';
import { GroupFilesDialog } from './groupfiles-dialog';
import { GroupFilesStore } from './groupfiles.store';

/** The GuiExpert Table needs a layout (ResizeObserver) – jsdom has none. */
@Component({ selector: 'app-preview-grid', template: '{{ rows().length }} rows' })
class StubGrid {
  readonly rows = input.required<readonly unknown[]>();
  readonly columns = input<unknown>();
  readonly rowClass = input<unknown>();
  readonly labelledBy = input<string | null>(null);
}

const flush = () => new Promise((r) => setTimeout(r));

function buttons(el: HTMLElement): Record<string, HTMLButtonElement> {
  const out: Record<string, HTMLButtonElement> = {};
  el.querySelectorAll('button').forEach((b) => (out[b.textContent!.trim()] = b));
  return out;
}

describe('folder tool dialogs (design 008)', () => {
  let jobsApi: FakeJobsApi;
  let folders: FakeFoldersApi;

  beforeEach(async () => {
    jobsApi = new FakeJobsApi();
    folders = new FakeFoldersApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: new FakeFsApi() },
        { provide: JobsApi, useValue: jobsApi },
        { provide: RenameApi, useValue: new FakeRenameApi() },
        { provide: FoldersApi, useValue: folders },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    for (const c of [GroupFilesDialog, CleanFoldersDialog, MultiMkdirDialog]) {
      TestBed.overrideComponent(c, {
        remove: { imports: [PreviewGrid] },
        add: { imports: [StubGrid] },
      });
    }
    await TestBed.inject(JobsStore).init();
  });

  it('group files: heading with the group count, Ctrl+Enter moves', async () => {
    const gf = TestBed.inject(GroupFilesStore);
    gf.request.set({
      side: 'left',
      sourceDir: '/src',
      otherDir: null,
      entries: ['a 1.txt', 'a 2.txt', 'readme'].map((n) => entry(n, { path: `/src/${n}` })),
    });
    const f = TestBed.createComponent(GroupFilesDialog);
    f.detectChanges();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('3 entries → 1 group');
    expect(el.textContent).toContain('3 rows');
    const source = el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1];
    expect(source.checked && source.disabled).toBe(true); // no other panel
    expect(buttons(el)['Move'].disabled).toBe(false);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await flush();
    expect(jobsApi.started[0].spec).toMatchObject({
      kind: 'group',
      transfer: 'move',
      root: '/src',
    });
  });

  it('clean folders: trash is the default, permanent is red, nothing found blocks Delete', async () => {
    const cl = TestBed.inject(CleanFoldersStore);
    cl.request.set({ side: 'left', folder: '/src', roots: ['/src'] });
    const f = TestBed.createComponent(CleanFoldersDialog);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Clean folders – /src');
    expect(el.textContent).toContain('Searching…');
    await cl.scanNow();
    f.detectChanges();
    expect(el.textContent).toContain('Nothing to delete');
    expect(buttons(el)['Delete'].disabled).toBe(true);
    folders.scan = { ...folders.scan, items: [{ path: '/src/e', kind: 'dir' }] };
    await cl.scanNow();
    cl.mode.set('permanent');
    f.detectChanges();
    const del = buttons(el)['Delete permanently'];
    expect(del.classList.contains('danger')).toBe(true);
    expect(del.disabled).toBe(false);
    // Ctrl+Enter never deletes permanently
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await flush();
    expect(jobsApi.started).toEqual([]);
    cl.close();
  });

  it('multi mkdir: error text and a disabled Create for a broken counter', () => {
    const mm = TestBed.inject(MultiMkdirStore);
    mm.request.set({ side: 'left', parent: '/src', parents: ['src', '', ''] });
    mm.update({ step: 0 });
    const f = TestBed.createComponent(MultiMkdirDialog);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[role=alert]')!.textContent).toContain('step > 0');
    expect(buttons(el)['Create'].disabled).toBe(true);
    mm.update({ step: 1 });
    f.detectChanges();
    expect(buttons(el)['Create'].disabled).toBe(false);
    mm.close();
  });
});
