import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { ArchiveApi } from '../../core/archive/archive-api';
import {
  archiveFormatOf,
  canEncrypt,
  isArchiveEntry,
  PACK_FORMATS,
  stripArchiveExtension,
  withFormat,
} from '../../core/archive/archive-names';
import { FsApi } from '../../core/fs/fs-api';
import { DirectoryListing, FsError } from '../../core/fs/fs.models';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { Summary } from '../../core/jobs/jobs.models';
import { ClipboardApi } from '../../core/os/clipboard';
import { OsApi } from '../../core/os/os-api';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeArchiveApi } from '../../../testing/fake-archive-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeClipboardApi, FakeOsApi } from '../../../testing/fake-os-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { DuplicatesStore } from '../duplicates/duplicates.store';
import { cancelKind, JOB_TEXTS } from '../jobs/job-format';
import { registerOpsActions } from '../ops/ops-actions';
import { OpsStore } from '../ops/ops.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerArchiveActions } from './archive-actions';
import { ArchiveStore } from './archive.store';
import { ARCHIVE_TEXTS } from './archive-texts';

const DATA: DirectoryListing = {
  path: '/data',
  parent: '/',
  segments: [
    { name: '/', path: '/' },
    { name: 'data', path: '/data' },
  ],
  entries: [
    entry('geheim.7z', { path: '/data/geheim.7z' }),
    entry('alt.rar', { path: '/data/alt.rar' }),
    entry('a.txt', { path: '/data/a.txt' }),
  ],
  unreadableEntries: 0,
};
const IN_7Z: DirectoryListing = {
  path: '/data/geheim.7z',
  parent: '/data',
  segments: [...DATA.segments, { name: 'geheim.7z', path: '/data/geheim.7z' }],
  entries: [entry('brief.txt', { path: '/data/geheim.7z/brief.txt' })],
  unreadableEntries: 0,
  archive: {
    path: '/data/geheim.7z',
    inner: '',
    format: 'sevenZ',
    unsafeEntries: 0,
    entries: 1,
    encrypted: true,
    passwordKnown: false,
  },
};
const REQUIRED: FsError = {
  code: 'archive_password_required',
  message: 'The archive is encrypted – a password is needed',
  path: '/data/geheim.7z',
};

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function failed(error: FsError): Summary {
  return {
    itemsDone: 0,
    itemsSkipped: 0,
    itemsFailed: 0,
    bytesDone: 0,
    errors: [],
    error,
    dirSize: null,
  };
}

describe('archives, design 025: 7z/RAR, passwords, opening entries', () => {
  let jobsApi: FakeJobsApi;
  let fsApi: FakeFsApi;
  let archiveApi: FakeArchiveApi;
  let ws: WorkspaceStore;
  let left: FileBrowserStore;
  let archive: ArchiveStore;
  let dialogs: DialogService;
  /** The 7z needs a password before it lists. */
  let locked = true;

  beforeEach(async () => {
    locked = true;
    jobsApi = new FakeJobsApi();
    fsApi = new FakeFsApi();
    archiveApi = new FakeArchiveApi();
    archiveApi.passwords.set('/data/geheim.7z', 'richtig');
    fsApi.handler = (path?: string) => {
      if (path === '/data/geheim.7z') {
        return locked
          ? Promise.reject(REQUIRED)
          : Promise.resolve({ ...IN_7Z, archive: { ...IN_7Z.archive!, passwordKnown: true } });
      }
      return Promise.resolve(DATA);
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: JobsApi, useValue: jobsApi },
        { provide: FsApi, useValue: fsApi },
        { provide: ArchiveApi, useValue: archiveApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: OsApi, useValue: new FakeOsApi() },
        { provide: ClipboardApi, useValue: new FakeClipboardApi() },
      ],
    });
    await TestBed.inject(JobsStore).init();
    ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    ws.registerPanel('left', { store: left, controller: () => undefined });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    const actions = TestBed.inject(ActionService);
    archive = TestBed.inject(ArchiveStore);
    const ops = TestBed.inject(OpsStore);
    registerOpsActions(actions, ops);
    registerArchiveActions(actions, archive, TestBed.inject(DuplicatesStore));
    dialogs = TestBed.inject(DialogService);
    await left.load('/data');
    await right.load('/target');
    ws.setActive('left');
  });

  it('knows 7z and RAR; packs everything but RAR; encrypts ZIP and 7z only', () => {
    expect(archiveFormatOf('Fotos.7Z')).toBe('sevenZ');
    expect(archiveFormatOf('alt.rar')).toBe('rar');
    expect(archiveFormatOf('.7z')).toBeNull();
    expect(isArchiveEntry(entry('x.7z'))).toBe(true);
    expect(stripArchiveExtension('Fotos 2024.7z')).toBe('Fotos 2024');
    expect(withFormat('Fotos.zip', 'sevenZ')).toBe('Fotos.7z');
    expect(PACK_FORMATS).toEqual(['zip', 'sevenZ', 'tar', 'tarGz']);
    expect(PACK_FORMATS).not.toContain('rar');
    expect(PACK_FORMATS.filter(canEncrypt)).toEqual(['zip', 'sevenZ']);
  });

  it('an encrypted listing asks for the password; a wrong one stays in the dialog', async () => {
    await left.open(left.entries()[0]);
    expect(left.error()?.code).toBe('archive_password_required');
    expect(dialogs.open()).toBe('archive-password');
    const req = archive.password()!;
    expect(req.archive).toBe('/data/geheim.7z');
    expect(req.wrong).toBe(false);
    const wrong = await archive.submitPassword(req, 'falsch');
    expect(wrong?.code).toBe('archive_password_wrong');
    expect(dialogs.open()).toBe('archive-password');
    expect(await archive.submitPassword(req, '')).not.toBeNull();
    locked = false;
    expect(await archive.submitPassword(req, 'richtig')).toBeNull();
    expect(dialogs.open()).toBeNull();
    expect(archiveApi.calls.at(-1)).toEqual({ archive: '/data/geheim.7z', password: 'richtig' });
    // the retry loaded the archive
    expect(left.path()).toBe('/data/geheim.7z');
    expect(left.archive()?.passwordKnown).toBe(true);
  });

  it('Enter on an encrypted entry asks and opens it afterwards', async () => {
    locked = false;
    await left.load('/data/geheim.7z');
    const opening = left.open(left.entries()[0]);
    await wait();
    const first = jobsApi.started.at(-1)!;
    expect(first.spec).toEqual({ kind: 'viewEntry', path: '/data/geheim.7z/brief.txt' });
    jobsApi.emit({
      type: 'finished',
      id: first.id,
      state: 'failed',
      summary: failed({ ...REQUIRED, path: '/data/geheim.7z/brief.txt' }),
    });
    await opening;
    expect(dialogs.open()).toBe('archive-password');
    // the archive of the panel, not the entry path
    expect(archive.password()?.archive).toBe('/data/geheim.7z');
    const submitted = archive.submitPassword(archive.password()!, 'richtig');
    await wait();
    const again = jobsApi.started.at(-1)!;
    expect(again.id).not.toBe(first.id);
    expect(again.spec.kind).toBe('viewEntry');
    jobsApi.emit({
      type: 'finished',
      id: again.id,
      state: 'done',
      summary: { ...failed(REQUIRED), error: null, viewPath: '/cache/1/brief.txt' },
    });
    await submitted;
    expect(fsApi.opened.at(-1)?.path).toBe('/cache/1/brief.txt');
  });

  it('Alt+F9 offers a password; it is checked before any job starts', async () => {
    left.setCursor('/data/geheim.7z');
    archive.openUnpack();
    const req = archive.unpack()!;
    expect(req.askPassword).toBe(true);
    fsApi.locations = { '/target': { dir: '/target', select: null } };
    const before = jobsApi.started.length;
    const wrong = await archive.runUnpack(req, {
      target: '/target',
      intoSubfolder: true,
      conflictDefault: 'ask',
      password: 'falsch',
    });
    expect(wrong?.code).toBe('archive_password_wrong');
    expect(jobsApi.started.length).toBe(before);
    expect(
      await archive.runUnpack(req, {
        target: '/target',
        intoSubfolder: true,
        conflictDefault: 'ask',
        password: 'richtig',
      }),
    ).toBeNull();
    const spec = jobsApi.started.at(-1)!.spec;
    expect(spec.kind).toBe('extract');
    // the password never travels in a job spec
    expect(JSON.stringify(spec)).not.toContain('richtig');
  });

  it('an extract job that needs the password asks and starts again', async () => {
    left.setCursor('/data/geheim.7z');
    archive.openUnpack();
    fsApi.locations = { '/target': { dir: '/target', select: null } };
    await archive.runUnpack(archive.unpack()!, {
      target: '/target',
      intoSubfolder: false,
      conflictDefault: 'skip',
    });
    const first = jobsApi.started.at(-1)!;
    jobsApi.emit({ type: 'finished', id: first.id, state: 'failed', summary: failed(REQUIRED) });
    await wait();
    expect(dialogs.open()).toBe('archive-password');
    expect(await archive.submitPassword(archive.password()!, 'richtig')).toBeNull();
    const again = jobsApi.started.at(-1)!;
    expect(again.id).not.toBe(first.id);
    expect(again.spec).toEqual(first.spec);
  });

  it('pack: 7z with a password that must be typed twice; TAR ignores it', async () => {
    left.setCursor('/data/a.txt');
    archive.openPack();
    const req = archive.pack()!;
    fsApi.locations = { '/target': { dir: '/target', select: null } };
    const base = { name: 'a.7z', format: 'sevenZ' as const, level: 5, target: '/target' };
    const differ = await archive.runPack(req, { ...base, password: 'abc', repeat: 'abd' });
    expect(differ?.message).toBe(ARCHIVE_TEXTS.passwordsDiffer);
    expect(await archive.runPack(req, { ...base, password: 'abc', repeat: 'abc' })).toBeNull();
    expect(jobsApi.started.at(-1)!.spec).toEqual({
      kind: 'pack',
      sources: ['/data/a.txt'],
      targetDir: '/target',
      name: 'a.7z',
      format: 'sevenZ',
      level: 5,
      password: 'abc',
    });
    archive.openPack();
    await archive.runPack(archive.pack()!, {
      ...base,
      name: 'a.tar',
      format: 'tar',
      password: 'abc',
      repeat: '',
    });
    expect(jobsApi.started.at(-1)!.spec).not.toHaveProperty('password');
  });

  it('the conflict dialog names the job: no "Cancel copying" when extracting', () => {
    expect(cancelKind('extract')).toBe('extract');
    expect(cancelKind('pack')).toBe('pack');
    expect(cancelKind('group')).toBe('copy');
    expect(JOB_TEXTS.conflictKeys.cancel('extract').join('')).toBe('Cancel extracting');
    expect(JOB_TEXTS.conflictKeys.cancel('pack').join('')).toBe('Cancel packing');
    expect(JOB_TEXTS.conflictKeys.cancel(cancelKind('copy')).join('')).toBe('Cancel copying');
  });
});
