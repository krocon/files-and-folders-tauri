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
import { ProposalService } from '../../core/mcp/proposal.service';
import { cleanScan, FakeFoldersApi } from '../../../testing/fake-folders-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeRenameApi } from '../../../testing/fake-rename-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { CleanFoldersDialog } from '../cleanfolders/clean-dialog';
import { CleanFoldersStore, DEFAULT_CLEAN_FORM } from '../cleanfolders/clean.store';
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
  readonly cellClass = input<unknown>();
  readonly labelledBy = input<string | null>(null);
  readonly activeIndex = input<number>(-1);
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
      searchKey: null,
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

  it('clean folders: trash is the default, permanent is red, nothing found blocks the button', async () => {
    const cl = TestBed.inject(CleanFoldersStore);
    cl.request.set({
      side: 'left',
      folder: '/src',
      roots: ['/src'],
      includeRoots: false,
      ignored: 0,
    });
    const f = TestBed.createComponent(CleanFoldersDialog);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Clean folders – /src');
    expect(el.textContent).toContain('Searching…');
    await cl.scanNow();
    f.detectChanges();
    expect(el.textContent).toContain('Nothing to delete');
    const run = () => el.querySelector<HTMLButtonElement>('[data-testid="clean-run"]')!;
    expect(run().textContent).toContain('Clean up');
    expect(run().disabled).toBe(true);
    folders.scan = cleanScan([
      { path: '/src', items: [{ path: '/src/e', kind: 'dir', rel: 'e' }] },
    ]);
    await cl.scanNow();
    cl.mode.set('permanent');
    f.detectChanges();
    expect(run().textContent).toContain('Delete permanently');
    expect(run().classList.contains('danger')).toBe(true);
    expect(run().disabled).toBe(false);
    // neither Enter nor Ctrl+Enter ever deletes permanently
    for (const ctrlKey of [false, true]) {
      el.querySelector('.tool')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey, bubbles: true }),
      );
    }
    await flush();
    expect(jobsApi.started).toEqual([]);
    cl.close();
  });

  it('clean folders: profiles, the folder list with its keys, the hint and the sums (design 077)', async () => {
    const cl = TestBed.inject(CleanFoldersStore);
    cl.request.set({
      side: 'left',
      folder: '/filme',
      roots: ['/filme/Comics', '/filme/Rest'],
      includeRoots: true,
      ignored: 2,
    });
    folders.scan = cleanScan([
      { path: '/filme/Comics', over: { keepFiles: 3, keepBytes: 99, keepExtensions: ['.cbr'] } },
      { path: '/filme/Rest', over: { keepFiles: 1, keepBytes: 736, keepExtensions: ['.nfo'] } },
    ]);
    const f = TestBed.createComponent(CleanFoldersDialog);
    await cl.scanNow();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Clean folders – 2 folders in /filme');
    const radio = (p: string) =>
      el.querySelector<HTMLInputElement>(`[data-testid="clean-profile-${p}"]`)!;
    expect(radio('empty').checked).toBe(true);
    // nothing found, but files inside: the hint names the other profile
    const hint = el.querySelector('[data-testid="clean-try-release"]')!;
    expect(hint.textContent).toContain('Release leftovers');
    expect(el.querySelector('[data-testid="clean-summary"]')!.textContent).toContain(
      'Nothing to delete · 2 marked files are ignored',
    );
    folders.scan = cleanScan([
      { path: '/filme/Comics', over: { keepFiles: 3, keepBytes: 99, keepExtensions: ['.cbr'] } },
      {
        path: '/filme/Rest',
        items: [
          {
            path: '/filme/Rest/Rel',
            kind: 'dir',
            rel: 'Rel',
            junk: 1,
            bytes: 736,
            junkNames: ['x.nfo'],
          },
          { path: '/filme/Rest', kind: 'dir', rel: '' },
        ],
        over: { verdict: 'residue' },
      },
    ]);
    hint.querySelector('button')!.click();
    await cl.scanNow();
    f.detectChanges();
    expect(radio('release').checked).toBe(true);
    expect(el.querySelector('[data-testid="clean-try-release"]')).toBeNull();
    expect(folders.scans.at(-1)!.options.largeJunk).toContain('*-sample.mkv');
    const summary = () => el.querySelector('[data-testid="clean-summary"]')!.textContent!;
    expect(summary()).toContain('1 folder is cleaned · 2 folders, 1 file · 736 B');
    // the list: arrows move the cursor (details follow), Space selects and deselects
    const list = el.querySelector<HTMLElement>('[data-testid="clean-list"]')!;
    const key = (k: string) => {
      list.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      f.detectChanges();
    };
    const details = () => el.querySelector('[data-testid="clean-details-label"]')!.textContent;
    expect(details()).toContain('Comics');
    key(' '); // a folder that stays cannot be selected
    expect(cl.sums().roots).toBe(1);
    key('ArrowDown');
    expect(details()).toContain('Rest');
    expect(cl.details().map((d) => d.entry)).toEqual(['Rel', '(the folder itself)']);
    key(' ');
    expect(summary()).toContain('No folder selected');
    expect(el.querySelector<HTMLButtonElement>('[data-testid="clean-run"]')!.disabled).toBe(true);
    key(' ');
    key('Home');
    expect(cl.active()).toBe(0);
    key('End');
    expect(cl.active()).toBe(1);
    // Enter in the list cleans up – to the trash
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(jobsApi.started).toHaveLength(1);
    expect(jobsApi.started[0].spec).toMatchObject({
      kind: 'clean',
      mode: 'trash',
      roots: ['/filme/Rest'],
      items: [
        { path: '/filme/Rest/Rel', kind: 'dir' },
        { path: '/filme/Rest', kind: 'dir' },
      ],
    });
  });

  it('clean folders: loosened rules open the rules and are named (review 077 #6)', async () => {
    const cl = TestBed.inject(CleanFoldersStore);
    cl.request.set({
      side: 'left',
      folder: '/src',
      roots: ['/src/a'],
      includeRoots: true,
      ignored: 0,
    });
    cl.form.set({ ...DEFAULT_CLEAN_FORM, profile: 'release' });
    const f = TestBed.createComponent(CleanFoldersDialog);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const rules = () => el.querySelector<HTMLDetailsElement>('details.rules')!;
    expect(rules().open).toBe(false);
    expect(el.querySelector('[data-testid="clean-loosened"]')).toBeNull();
    // as kept from an earlier run: samples up to 5 GB, extras-only folders next to content
    cl.form.set({
      ...DEFAULT_CLEAN_FORM,
      profile: 'release',
      sampleMaxMb: 5000,
      junkDirsBesideContent: true,
    });
    f.detectChanges();
    expect(rules().open).toBe(true);
    expect(el.querySelector('[data-testid="clean-loosened"]')!.textContent).toContain('wider');
    cl.close();
  });

  it('clean folders guarded for an MCP client: a note, no Enter, permanent without any key', async () => {
    const cl = TestBed.inject(CleanFoldersStore);
    cl.request.set({
      side: 'left',
      folder: '/src',
      roots: ['/src/a'],
      includeRoots: true,
      ignored: 0,
      changedBy: 'Claude Code',
    });
    folders.scan = cleanScan([
      {
        path: '/src/a',
        items: [{ path: '/src/a', kind: 'dir', rel: '' }],
        over: { verdict: 'residue' },
      },
    ]);
    const f = TestBed.createComponent(CleanFoldersDialog);
    await cl.scanNow();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="proposal-note"]')!.textContent).toContain('Claude Code');
    const run = el.querySelector<HTMLButtonElement>('[data-testid="clean-run"]')!;
    // locked: the keyboard was not quiet yet
    expect(run.disabled).toBe(true);
    TestBed.inject(ProposalService).armed.set(true);
    f.detectChanges();
    expect(run.disabled).toBe(false);
    // Enter alone never confirms a guarded dialog
    el.querySelector('.tool')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
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
