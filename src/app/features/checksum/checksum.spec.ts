import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { ChecksumDialog } from './checksum-dialog';
import { ChecksumResultDialog } from './checksum-result-dialog';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { checksumAlgoOfName, ChecksumSummary } from '../../core/checksum/checksum.models';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobState, Summary } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { ClipboardApi } from '../../core/os/clipboard';
import { SessionApi } from '../../core/session/session-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeClipboardApi } from '../../../testing/fake-os-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileListController } from '../browser/file-list/file-list-controller';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerChecksumActions } from './checksum-actions';
import {
  ChecksumStore,
  DEFAULT_CHECKSUM_FORM,
  defaultListName,
  restoreChecksumForm,
} from './checksum.store';

const flush = () => new Promise((r) => setTimeout(r));

/** The GuiExpert Table needs a layout – jsdom has none. */
@Component({ selector: 'app-preview-grid', template: '{{ rows().length }} rows' })
class StubGrid {
  readonly rows = input.required<readonly unknown[]>();
  readonly columns = input<unknown>();
  readonly rowClass = input<unknown>();
  readonly labelledBy = input<string | null>(null);
}

const SUMMARY: Summary = {
  itemsDone: 0,
  itemsSkipped: 0,
  itemsFailed: 0,
  bytesDone: 0,
  errors: [],
  error: null,
  dirSize: null,
};

const CS: ChecksumSummary = {
  algo: 'sha256',
  file: null,
  digests: [],
  ok: 0,
  mismatched: 0,
  missing: 0,
  unreadable: 0,
  invalid: 0,
  refused: 0,
  problems: [],
};

describe('checksums (design 039)', () => {
  let jobsApi: FakeJobsApi;
  let clip: FakeClipboardApi;
  let actions: ActionService;
  let dialogs: DialogService;
  let cs: ChecksumStore;
  let store: FileBrowserStore;
  let cursor: string | null;

  beforeEach(async () => {
    const fs = new FakeFsApi();
    fs.handler = () =>
      Promise.resolve(
        listing(
          '/d',
          [
            dir('Ordner', { path: '/d/Ordner' }),
            entry('a ä.txt', { path: '/d/a ä.txt' }),
            entry('b.iso', { path: '/d/b.iso' }),
            entry('CHECKSUMS.sha256', { path: '/d/CHECKSUMS.sha256' }),
          ],
          '/',
        ),
      );
    jobsApi = new FakeJobsApi();
    clip = new FakeClipboardApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: jobsApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: ClipboardApi, useValue: clip },
      ],
    });
    TestBed.overrideComponent(ChecksumResultDialog, {
      remove: { imports: [PreviewGrid] },
      add: { imports: [StubGrid] },
    });
    actions = TestBed.inject(ActionService);
    dialogs = TestBed.inject(DialogService);
    cs = TestBed.inject(ChecksumStore);
    await TestBed.inject(JobsStore).init();
    const ws = TestBed.inject(WorkspaceStore);
    store = TestBed.runInInjectionContext(() => new FileBrowserStore());
    cursor = null;
    const controller = {
      cursorEntry: () => store.entries().find((e) => e.path === cursor) ?? null,
    } as unknown as FileListController;
    ws.registerPanel('left', { store, controller: () => controller });
    registerChecksumActions(actions, cs);
    await store.load('/d');
  });

  function finish(index: number, state: JobState, summary: Partial<Summary> = {}) {
    jobsApi.emit({
      type: 'finished',
      id: jobsApi.started[index].id,
      state,
      summary: { ...SUMMARY, ...summary },
    });
  }

  it('knows checksum files by name, like Rust', () => {
    expect(checksumAlgoOfName('CHECKSUMS.sha256')).toBe('sha256');
    expect(checksumAlgoOfName('x.MD5')).toBe('md5');
    expect(checksumAlgoOfName('SHA512SUMS')).toBe('sha512');
    expect(checksumAlgoOfName('readme.txt')).toBeNull();
    expect(defaultListName([entry('a.iso')], 'sha1')).toBe('a.iso.sha1');
    expect(defaultListName([dir('x')], 'md5')).toBe('CHECKSUMS.md5');
    expect(restoreChecksumForm({ algo: 'crc', mode: 'perFile' })).toEqual({
      ...DEFAULT_CHECKSUM_FORM,
      mode: 'perFile',
    });
  });

  it('creates one list for the marked entries; an existing name must be confirmed', async () => {
    expect(actions.state('CHECKSUM_VERIFY')).toBe('disabled');
    store.setMarked(['/d/Ordner', '/d/a ä.txt'], true);
    await actions.run('OPEN_CHECKSUM_CREATE_DLG');
    expect(dialogs.open()).toBe('checksum');
    expect(cs.name()).toBe('CHECKSUMS.sha256');
    expect(cs.nameExists()).toBe(true);
    expect(cs.canRun()).toBe(false);
    // the name follows the algorithm until it is typed
    cs.update({ algo: 'sha512' });
    expect(cs.name()).toBe('CHECKSUMS.sha512');
    expect(cs.canRun()).toBe(true);
    cs.setName('alles.sha512');
    cs.update({ algo: 'md5' });
    expect(cs.name()).toBe('alles.sha512');
    await cs.run();
    expect(dialogs.open()).toBeNull();
    expect(jobsApi.started[0].spec).toEqual({
      kind: 'checksum',
      paths: ['/d/Ordner', '/d/a ä.txt'],
      baseDir: '/d',
      algo: 'md5',
      output: { kind: 'list', name: 'alles.sha512', overwrite: false },
    });
    finish(0, 'done', {
      itemsDone: 3,
      checksums: { ...CS, file: '/d/alles.sha512' },
    });
    await flush();
    expect(TestBed.inject(JobsStore).messages()).toContain(
      'Checksums of 3 files written to /d/alles.sha512',
    );
    // the next opening starts with the last algorithm and mode
    expect(TestBed.inject(SettingsStore).get('dialogs.recent')[0]).toEqual({
      dialog: 'checksum',
      value: { algo: 'md5', mode: 'list' },
    });
  });

  it('one file per file needs no name; replacing an existing list only when ticked', async () => {
    cursor = '/d/b.iso';
    cs.open();
    expect(cs.name()).toBe('b.iso.sha256');
    cs.update({ mode: 'perFile' });
    expect(cs.canRun()).toBe(true);
    await cs.run();
    expect(jobsApi.started[0].spec).toMatchObject({ output: { kind: 'perFile' } });

    store.setMarked(['/d/a ä.txt'], true);
    cs.open();
    cs.update({ mode: 'list' });
    cs.setName('CHECKSUMS.sha256');
    expect(cs.canRun()).toBe(false);
    cs.overwrite.set(true);
    await cs.run();
    expect(jobsApi.started[1].spec).toMatchObject({
      output: { kind: 'list', name: 'CHECKSUMS.sha256', overwrite: true },
    });
  });

  it('verifies the checksum file under the cursor and marks the changed files', async () => {
    cursor = '/d/CHECKSUMS.sha256';
    expect(actions.state('CHECKSUM_VERIFY')).toBe('ready');
    const done = cs.verify();
    await flush();
    expect(jobsApi.started[0].spec).toEqual({
      kind: 'verifyChecksums',
      file: '/d/CHECKSUMS.sha256',
    });
    finish(0, 'doneWithErrors', {
      checksums: {
        ...CS,
        ok: 5,
        mismatched: 1,
        missing: 1,
        refused: 1,
        problems: [
          { name: 'a ä.txt', path: '/d/a ä.txt', kind: 'mismatch' },
          { name: 'weg.txt', path: null, kind: 'missing' },
          { name: '../x', path: null, kind: 'refused' },
        ],
      },
    });
    await done;
    expect(dialogs.open()).toBe('checksum-result');
    expect(cs.result()?.summary.ok).toBe(5);
    cs.markChanged();
    expect([...store.marked()]).toEqual(['/d/a ä.txt']);
    expect(dialogs.open()).toBeNull();
  });

  it('copies the SHA-256 of the cursor file; folders have none', async () => {
    cursor = '/d/Ordner';
    expect(actions.state('COPY_CHECKSUM')).toBe('disabled');
    cursor = '/d/b.iso';
    const done = cs.copyDigest();
    await flush();
    expect(jobsApi.started[0].spec).toMatchObject({
      kind: 'checksum',
      paths: ['/d/b.iso'],
      output: { kind: 'show' },
    });
    finish(0, 'done', {
      checksums: { ...CS, digests: [{ path: '/d/b.iso', hex: 'ab'.repeat(32) }] },
    });
    await done;
    expect(clip.written).toEqual(['ab'.repeat(32)]);
    expect(TestBed.inject(JobsStore).messages()).toContain('SHA256 of b.iso copied');
  });

  it('the dialogs render: create with algorithm and modes, result with counts', async () => {
    store.setMarked(['/d/a ä.txt'], true);
    cs.open();
    const f = TestBed.createComponent(ChecksumDialog);
    f.detectChanges();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('select')?.value).toBe('sha256');
    expect(el.querySelectorAll('input[type=radio]')).toHaveLength(2);
    expect((el.querySelector('input[type=text]') as HTMLInputElement).value).toBe('a ä.txt.sha256');
    cs.close();

    cs.result.set({
      side: 'left',
      list: entry('CHECKSUMS.sha256', { path: '/d/CHECKSUMS.sha256' }),
      folder: '/d',
      cancelled: false,
      summary: {
        ...CS,
        ok: 2,
        mismatched: 1,
        problems: [{ name: 'x', path: '/d/x', kind: 'mismatch' }],
      },
    });
    const r = TestBed.createComponent(ChecksumResultDialog);
    r.detectChanges();
    await r.whenStable();
    const text = (r.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('2 files OK');
    expect(text).toContain('1 problem');
    expect(text).toContain('Mark changed files');
  });
});
