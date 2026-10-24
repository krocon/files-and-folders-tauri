import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { MenuApi } from '../../core/menu/menu-api';
import { ClipboardApi } from '../../core/os/clipboard';
import { OsApi } from '../../core/os/os-api';
import { RemoteApi } from '../../core/remote/remote-api';
import {
  isNotConnected,
  profileOf,
  RemoteConnectPrompt,
} from '../../core/remote/remote-connect-prompt';
import { displayPath, isRemotePath, isServerUrl, serverPath } from '../../core/remote/remote-path';
import { SessionApi } from '../../core/session/session-api';
import { ThemeApi } from '../../core/theme/theme-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeMenuApi } from '../../../testing/fake-menu-api';
import { FakeClipboardApi, FakeOsApi } from '../../../testing/fake-os-api';
import { FakeRemoteApi, sampleProfile } from '../../../testing/fake-remote-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { ConnectionsDialog } from './connections-dialog';
import { activeServerPath, OFF_ON_SERVER, registerRemoteActions } from './remote-actions';
import {
  blankProfile,
  DEFAULT_PORT,
  duplicateProfile,
  needsSecret,
  problemOf,
  sameProfile,
  withKind,
} from './remote-logic';
import { RemotePromptDialog } from './remote-prompt-dialog';
import { RemoteStore } from './remote.store';

const flush = () => new Promise((r) => setTimeout(r));

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('remote logic (design 034)', () => {
  it('server paths are recognised by the prefix only', () => {
    expect(isRemotePath('remote://k3x9/pub')).toBe(true);
    expect(isRemotePath('/remote://x')).toBe(false);
    expect(isRemotePath(null)).toBe(false);
    expect(isServerUrl(' sftp://u@h/x')).toBe(true);
    expect(isServerUrl('ftp://h')).toBe(true);
    expect(isServerUrl('ftpes://h')).toBe(true);
    expect(isServerUrl('/Users/sftp://')).toBe(false);
    expect(profileOf('remote://k3x9/pub')).toBe('k3x9');
    expect(profileOf('remote://k3x9')).toBe('k3x9');
    expect(profileOf('/k3x9')).toBeNull();
    expect(serverPath('a1', null)).toBe('remote://a1/');
    expect(serverPath('a1', '/srv/www')).toBe('remote://a1/srv/www');
    const names = new Map([['a1', 'Mein Server']]);
    expect(displayPath('remote://a1/pub', names)).toBe('Mein Server: /pub');
    expect(displayPath('remote://a1', names)).toBe('Mein Server: /');
    expect(displayPath('remote://zz/pub', names)).toBe('remote://zz/pub');
    expect(displayPath('/Users/x', names)).toBe('/Users/x');
    expect(isNotConnected({ code: 'remote_not_connected', message: '', path: null })).toBe(true);
    expect(isNotConnected({ code: 'not_found', message: '', path: null })).toBe(false);
  });

  it('the type change keeps a custom port, follows a default one', () => {
    const p = blankProfile('Neu');
    expect(p.port).toBe(22);
    const ftps = withKind(p, 'ftpsImplicit');
    expect(ftps.port).toBe(DEFAULT_PORT.ftpsImplicit);
    expect(ftps.auth).toBe('password');
    const custom = withKind({ ...p, port: 2222, auth: 'agent' }, 'ftp');
    expect(custom.port).toBe(2222);
    expect(custom.auth).toBe('password');
    expect(withKind({ ...p, kind: 'ftp', anonymous: true }, 'sftp').anonymous).toBe(false);
  });

  it('checks the form like Rust does', () => {
    const ok = sampleProfile('a');
    expect(problemOf(ok)).toBeNull();
    expect(problemOf({ ...ok, name: ' ' })).toBe('name');
    expect(problemOf({ ...ok, host: 'evil.org\r\nUSER x' })).toBe('host');
    expect(problemOf({ ...ok, host: 'a/b' })).toBe('host');
    expect(problemOf({ ...ok, host: '::1' })).toBeNull();
    expect(problemOf({ ...ok, port: 0 })).toBe('port');
    expect(problemOf({ ...ok, port: 70000 })).toBe('port');
    expect(problemOf({ ...ok, user: '' })).toBe('user');
    expect(problemOf({ ...ok, user: 'a\nb' })).toBe('user');
    expect(problemOf({ ...ok, kind: 'ftp', user: '', anonymous: true })).toBeNull();
    expect(problemOf({ ...ok, auth: 'key', keyFile: null })).toBe('keyFile');
    expect(problemOf({ ...ok, startPath: 'rel' })).toBe('startPath');
    expect(problemOf({ ...ok, startPath: '/a/../b' })).toBe('startPath');
    expect(needsSecret(ok)).toBe(true);
    expect(needsSecret({ ...ok, auth: 'agent' })).toBe(false);
    expect(needsSecret({ ...ok, kind: 'ftp', anonymous: true })).toBe(false);
  });

  it('a duplicate has no id, secret or pin; sameProfile ignores the keychain marker', () => {
    const p = sampleProfile('a', { secret: 'keychain', pinnedCert: 'ab'.repeat(32) });
    const d = duplicateProfile(p, 'Kopie');
    expect([d.id, d.secret, d.pinnedCert, d.name]).toEqual(['', 'none', null, 'Kopie']);
    expect(sameProfile(p, { ...p, secret: 'none' })).toBe(true);
    expect(sameProfile(p, { ...p, port: 23 })).toBe(false);
  });
});

describe('remote store and dialogs (design 034)', () => {
  let api: FakeRemoteApi;
  let fsApi: FakeFsApi;
  let store: RemoteStore;
  let ws: WorkspaceStore;
  let dialogs: DialogService;
  let actions: ActionService;
  let left: FileBrowserStore;

  beforeEach(async () => {
    api = new FakeRemoteApi();
    api.profiles = [sampleProfile('a1', { name: 'Mein Server' })];
    fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) => {
      const p = path ?? '/home';
      if (p.startsWith('remote://')) {
        return Promise.resolve({
          path: p,
          parent: null,
          segments: [{ name: 'Mein Server', path: 'remote://a1/' }],
          entries: [
            entry('f.txt', { path: 'remote://a1/f.txt' }),
            dir('pub', { path: 'remote://a1/pub' }),
          ],
          unreadableEntries: 0,
          network: true,
          remote: {
            profileId: 'a1',
            name: 'Mein Server',
            kind: 'sftp',
            encrypted: true,
            display: 'Mein Server: /',
          },
        });
      }
      return Promise.resolve({
        path: p,
        parent: '/',
        segments: [{ name: '/', path: '/' }],
        entries: [entry('x.txt', { path: `${p}/x.txt` })],
        unreadableEntries: 0,
      });
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fsApi },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: OsApi, useValue: new FakeOsApi() },
        { provide: ClipboardApi, useValue: new FakeClipboardApi() },
        { provide: ThemeApi, useValue: new FakeThemeApi() },
        { provide: MenuApi, useValue: new FakeMenuApi() },
        { provide: RemoteApi, useValue: api },
      ],
    });
    actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    ws = TestBed.inject(WorkspaceStore);
    dialogs = TestBed.inject(DialogService);
    store = TestBed.inject(RemoteStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    ws.registerPanel('left', { store: left, controller: () => undefined });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerRemoteActions(actions, ws, store);
    await store.init();
  });

  it('loads the profiles and follows the state events', async () => {
    expect(store.profiles().map((p) => p.name)).toEqual(['Mein Server']);
    await store.connect('a1');
    expect(store.state('a1')).toBe('connected');
    await store.disconnect('a1');
    expect(store.state('a1')).toBe('disconnected');
    expect(store.status()).toContain('Mein Server');
  });

  it('asks for the password, sends it once and keeps nothing', async () => {
    api.outcomes.set('a1', [
      { status: 'needsSecret', what: 'password', keychain: true, refused: false },
      { error: 'remote_auth_failed' },
      {
        status: 'connected',
        home: 'remote://a1/home/marc',
        encrypted: true,
        serverInfo: 'SFTP',
        keychainFailed: false,
      },
    ]);
    await store.connect('a1', { navigate: true });
    expect(dialogs.open()).toBe('remote-prompt');
    expect(store.prompt()?.kind).toBe('secret');
    // the dialog: type, submit – the field is empty right after
    const fixture = TestBed.createComponent(RemotePromptDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input[type="password"]')!;
    type(input, 'falsch');
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(input.value).toBe('');
    await flush();
    fixture.detectChanges();
    // wrong password: still asking, with the message
    expect(store.prompt()?.kind).toBe('secret');
    expect(el.querySelector('#fnf-remote-secret-error')?.textContent).toContain('refused');
    type(input, 'richtig');
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    expect(store.prompt()).toBeNull();
    expect(dialogs.open()).toBeNull();
    expect(api.calls.filter((c) => c.startsWith('connect'))).toEqual([
      'connect:a1:-:none',
      'connect:a1:***:keychain',
      'connect:a1:***:keychain',
    ]);
    // the store holds no password anywhere
    expect(JSON.stringify(store.prompt())).not.toContain('richtig');
    expect(store.profile('a1')?.secret).toBe('keychain');
    expect(ws.navigateRequest()?.path).toBe('remote://a1/home/marc');
  });

  it('a host key question: trust, then the same connect again without a password', async () => {
    api.outcomes.set('a1', [
      { status: 'hostKeyUnknown', keyType: 'ssh-ed25519', fingerprint: 'SHA256:abc' },
      {
        status: 'connected',
        home: 'remote://a1/',
        encrypted: true,
        serverInfo: '',
        keychainFailed: false,
      },
    ]);
    await store.connect('a1');
    const fixture = TestBed.createComponent(RemotePromptDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('SHA256:abc');
    expect(el.querySelector('[role="alertdialog"]')).not.toBeNull();
    const trust = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Trust'))!;
    trust.click();
    await flush();
    expect(api.calls).toContain('trustHostKey:a1:SHA256:abc');
    expect(store.state('a1')).toBe('connected');
  });

  it('a certificate with another host name needs the extra tick', async () => {
    api.outcomes.set('a1', [
      {
        status: 'certificateUntrusted',
        sha256: 'ab'.repeat(32),
        reason: 'UnknownIssuer',
        hostnameMismatch: true,
        pinnedChanged: false,
      },
      {
        status: 'connected',
        home: 'remote://a1/',
        encrypted: true,
        serverInfo: '',
        keychainFailed: false,
      },
    ]);
    await store.connect('a1');
    const fixture = TestBed.createComponent(RemotePromptDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const trust = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Trust'))!;
    expect(trust.disabled).toBe(true);
    el.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    fixture.detectChanges();
    expect(trust.disabled).toBe(false);
    trust.click();
    await flush();
    expect(api.calls).toContain(`trustCertificate:a1:${'ab'.repeat(32)}:true`);
  });

  it('cancel gives the connect up and drops a pending secret in Rust', async () => {
    api.outcomes.set('a1', [{ status: 'hostKeyUnknown', keyType: 'k', fingerprint: 'f' }]);
    await store.connect('a1');
    store.cancelPrompt();
    expect(store.prompt()).toBeNull();
    expect(api.calls).toContain('disconnect:a1');
  });

  it('the panel bridge connects and runs the retry', async () => {
    let retried = 0;
    TestBed.inject(RemoteConnectPrompt).connect('a1', () => retried++);
    await flush();
    expect(retried).toBe(1);
  });

  it('vetoes local-only actions in a server panel', async () => {
    const ids = [
      'OPEN_TERMINAL_HERE',
      'OPEN_DISK_USAGE',
      'OPEN_PACK_DLG',
      'OPEN_COPY_DLG',
    ] as const;
    actions.register(Object.fromEntries(ids.map((id) => [id, { run: () => undefined }])));
    ws.updateTab(ws.activeTab('left').id, { path: 'remote://a1/' });
    expect(activeServerPath(ws)).toBe('remote://a1/');
    for (const id of ids.slice(0, 3)) {
      expect(OFF_ON_SERVER.has(id)).toBe(true);
      expect(actions.state(id)).toBe('disabled');
    }
    expect(actions.state('OPEN_COPY_DLG')).toBe('ready');
    ws.updateTab(ws.activeTab('left').id, { path: '/home' });
    expect(actions.state('OPEN_TERMINAL_HERE')).toBe('ready');
  });

  it('the connections dialog: table, editor dialog, footer buttons (Marc, 2026-10-24)', async () => {
    store.openDialog('a1');
    const fixture = TestBed.createComponent(ConnectionsDialog);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = () => [...el.querySelectorAll<HTMLElement>('tbody tr[data-id]')];
    expect(rows().length).toBe(1);
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
    expect(rows()[0].textContent).toContain('Mein Server');
    // no form in the main dialog: the editor opens from the row action
    expect(el.querySelector('.details')).toBeNull();
    rows()[0].querySelector<HTMLElement>('[data-act="edit"]')!.click();
    fixture.detectChanges();
    const editor = () => el.querySelector<HTMLElement>('.editor-modal')!;
    expect(editor().textContent).toContain('Edit connection');
    // change the type: the port follows
    const kind = editor().querySelector<HTMLSelectElement>('select')!;
    kind.value = 'ftp';
    kind.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(editor().querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('21');
    expect(editor().textContent).toContain('Unencrypted');
    editor().querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    fixture.detectChanges();
    expect(api.profiles[0].kind).toBe('ftp');
    expect(el.querySelector('.editor-modal')).toBeNull();
    expect(rows()[0].textContent).toContain('FTP');
    // footer: New opens an empty editor; an invalid host cannot be saved
    const foot = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('.foot button')].find(
        (b) => b.textContent?.trim() === label,
      )!;
    foot('New').click();
    fixture.detectChanges();
    expect(editor().textContent).toContain('New connection');
    const save = [...editor().querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Save',
    )!;
    expect(save.disabled).toBe(true);
    expect(editor().querySelector('.notice')?.textContent).toContain('server name');
    // Cancel closes only the editor, nothing was added
    [...editor().querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Cancel')!
      .click();
    fixture.detectChanges();
    expect(el.querySelector('.editor-modal')).toBeNull();
    expect(rows().length).toBe(1);
    // F2 on the row edits, Escape in the editor closes it
    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.editor-modal')).not.toBeNull();
    editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.editor-modal')).toBeNull();
    // Delete asks first (the button turns red), the second press removes
    foot('Delete').click();
    fixture.detectChanges();
    expect(el.querySelector('.notice')?.textContent).toContain('Mein Server');
    expect(api.profiles.length).toBe(1);
    foot('Delete connection?').click();
    await flush();
    fixture.detectChanges();
    expect(api.profiles.length).toBe(0);
    expect(foot('Connect').disabled).toBe(true);
  });

  it('a quick-connect address drops the password and fills a draft', async () => {
    await store.openUrl('sftp://marc:geheim@example.org/srv');
    const draft = store.dialogDraft();
    expect(draft?.profile.host).toBe('example.org');
    expect(draft?.profile.startPath).toBe('/srv');
    expect(draft?.note).toContain('password');
    expect(JSON.stringify(draft)).not.toContain('geheim');
    expect(dialogs.open()).toBe('connections');
  });

  it('Enter on a server file opens a local copy (job viewEntry)', async () => {
    await left.load('remote://a1/');
    expect(left.remote()?.profileId).toBe('a1');
    const jobs = TestBed.inject(JobsApi) as unknown as FakeJobsApi;
    void left.open(left.entries().find((e) => e.name === 'f.txt')!);
    await flush();
    expect(jobs.started.map((j) => j.spec)).toContainEqual({
      kind: 'viewEntry',
      path: 'remote://a1/f.txt',
    });
  });
});
