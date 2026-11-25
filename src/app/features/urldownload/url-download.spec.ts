import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { ACTIONS } from '../../core/actions/action-catalog';
import { KeymapApi } from '../../core/actions/keymap-api';
import linuxKeymap from '../../core/actions/keymaps/linux.json';
import macosKeymap from '../../core/actions/keymaps/macos.json';
import windowsKeymap from '../../core/actions/keymaps/windows.json';
import { describeFsError, toFsError } from '../../core/fs/fs-error';
import { FsApi } from '../../core/fs/fs-api';
import { DirectoryListing } from '../../core/fs/fs.models';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobInfo, JobState, Summary } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { McpGuardService } from '../../core/mcp/mcp-guard.service';
import { ClipboardApi } from '../../core/os/clipboard';
import { SessionApi } from '../../core/session/session-api';
import { SettingsApi } from '../../core/settings/settings-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { UrlDownloadApi } from '../../core/urldownload/url-download-api';
import {
  DEFAULT_DOWNLOAD_OPTIONS,
  DownloadOptions,
} from '../../core/urldownload/url-download.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeClipboardApi } from '../../../testing/fake-os-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeSettingsApi } from '../../../testing/fake-settings-api';
import {
  downloadTools,
  FakeUrlDownloadApi,
  MISSING,
  tool,
} from '../../../testing/fake-url-download-api';
import { entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { ACTIONS_MENU_COLUMNS, OPENS_DIALOG } from '../actions/actions-menu-def';
import { FileBrowserStore } from '../browser/file-browser.store';
import { amountText, jobTitle, speedText } from '../jobs/job-format';
import { jobRows } from '../jobs/job-rows';
import { MENU_BAR } from '../menus/menu-model';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerUrlDownloadActions } from './url-download-actions';
import { UrlDownloadDialog } from './url-download-dialog';
import {
  appendUrls,
  applyPreset,
  BUILTIN_PRESETS,
  clipboardUrls,
  CUSTOM_PRESET,
  defaultTarget,
  needsFfmpeg,
  presetValue,
  rememberedForm,
  restoreDownloadForm,
  shortenMiddle,
  SideView,
  subLangsOk,
  targetChoices,
  withoutFfmpeg,
} from './url-download-logic';
import { UrlDownloadStore } from './url-download.store';

const flush = () => new Promise((r) => setTimeout(r));

const SUMMARY: Summary = {
  itemsDone: 0,
  itemsSkipped: 0,
  itemsFailed: 0,
  bytesDone: 0,
  errors: [],
  error: null,
  dirSize: null,
};

const folder = (path: string, tabId = 't'): SideView => ({
  path,
  result: false,
  archive: false,
  remote: false,
  tabId,
});

describe('download from URLs: pure logic (design 078)', () => {
  const d = DEFAULT_DOWNLOAD_OPTIONS;

  it('maps the built-in presets to fields and back', () => {
    expect(BUILTIN_PRESETS.map((p) => p.id)).toEqual([
      'best',
      'video1080mp4',
      'audioMp3',
      'audioBest',
    ]);
    expect(presetValue(d)).toBe('best');
    const p1080 = applyPreset(d, 'video1080mp4');
    expect(p1080).toMatchObject({ content: 'video', maxHeight: 1080, container: 'mp4' });
    expect(presetValue(p1080)).toBe('video1080mp4');
    const mp3 = applyPreset(p1080, 'audioMp3');
    expect(mp3).toMatchObject({ content: 'audio', audioFormat: 'mp3' });
    expect(presetValue(mp3)).toBe('audioMp3');
    // audio ignores what was left in the video fields
    expect(presetValue({ ...mp3, maxHeight: 720, container: 'mkv' })).toBe('audioMp3');
    expect(presetValue(applyPreset(mp3, 'audioBest'))).toBe('audioBest');
    // a changed field: none of the presets
    expect(presetValue({ ...d, maxHeight: 720 })).toBe(CUSTOM_PRESET);
    expect(presetValue({ ...d, content: 'audio', audioFormat: 'opus' })).toBe(CUSTOM_PRESET);
    // an own preset: only its id travels; the other options stay
    const own = applyPreset({ ...d, embedMetadata: true }, 'own:p720');
    expect(own.preset).toBe('p720');
    expect(own.embedMetadata).toBe(true);
    expect(presetValue(own)).toBe('own:p720');
    expect(applyPreset(own, 'best').preset).toBeNull();
    // nothing in a preset is an argument
    expect(JSON.stringify(BUILTIN_PRESETS)).not.toMatch(/--|-f|-x/);
  });

  it('knows what needs ffmpeg and takes it back without ffmpeg', () => {
    expect(needsFfmpeg(d)).toBe(false);
    expect(needsFfmpeg({ ...d, content: 'audio' })).toBe(true);
    expect(needsFfmpeg({ ...d, container: 'mkv' })).toBe(true);
    expect(needsFfmpeg({ ...d, embedThumbnail: true })).toBe(true);
    expect(needsFfmpeg({ ...d, preset: 'x', content: 'audio' })).toBe(false);
    const cut = withoutFfmpeg({
      ...d,
      content: 'audio',
      container: 'mp4',
      embedThumbnail: true,
      embedMetadata: true,
    });
    expect(needsFfmpeg(cut)).toBe(false);
    expect(cut.content).toBe('video');
  });

  it('restores a kept form field by field and never keeps overwrite or cookies', () => {
    expect(restoreDownloadForm(undefined)).toEqual(d);
    expect(restoreDownloadForm('x')).toEqual(d);
    const kept = restoreDownloadForm({
      preset: '../evil',
      content: 'audio',
      maxHeight: 1081,
      container: 'webm',
      audioFormat: 'mp3',
      template: '%(title)s.%(ext)s',
      playlist: true,
      playlistSubfolder: true,
      subtitles: true,
      subLangs: 'de,en',
      embedThumbnail: true,
      embedMetadata: 'yes',
      overwrite: true,
      cookiesBrowser: 'firefox',
      args: ['--exec', 'x'],
    });
    expect(kept).toEqual({
      ...d,
      content: 'audio',
      audioFormat: 'mp3',
      template: '%(title)s.%(ext)s',
      playlist: true,
      playlistSubfolder: true,
      subtitles: true,
      subLangs: 'de,en',
      embedThumbnail: true,
    });
    expect('args' in kept).toBe(false);
    expect(rememberedForm({ ...d, overwrite: true, cookiesBrowser: 'safari' })).toEqual(d);
    expect(restoreDownloadForm({ template: '' }).template).toBe(d.template);
    expect(restoreDownloadForm({ preset: 'p720' }).preset).toBe('p720');
  });

  it('checks the subtitle languages like Rust', () => {
    for (const ok of ['en', 'de,en', 'en.*,-live_chat']) {
      expect(subLangsOk(ok), ok).toBe(true);
    }
    for (const bad of ['', ',en', 'en de', 'en;x', 'en --exec x']) {
      expect(subLangsOk(bad), bad).toBe(false);
    }
  });

  it('offers left and right, the other side first, and blocks what is no local folder', () => {
    const both = targetChoices({ left: folder('/l', 'a'), right: folder('/r', 'b') }, 'left');
    expect(both).toEqual([
      { side: 'left', path: '/l', tabId: 'a', active: true, blocked: null },
      { side: 'right', path: '/r', tabId: 'b', active: false, blocked: null },
    ]);
    expect(defaultTarget(both)).toBe('right');
    expect(defaultTarget(targetChoices({ left: folder('/l'), right: folder('/r') }, 'right'))).toBe(
      'left',
    );
    const blocked = (view: Partial<SideView>) =>
      targetChoices({ left: folder('/l'), right: { ...folder('/r'), ...view } }, 'left');
    expect(blocked({ archive: true })[1]).toMatchObject({ blocked: 'archive', path: null });
    expect(blocked({ remote: true, path: 'remote://p/x' })[1]).toMatchObject({
      blocked: 'server',
      path: null,
    });
    expect(blocked({ result: true, path: null })[1].blocked).toBe('result');
    expect(blocked({ path: null })[1].blocked).toBe('noFolder');
    // the other side is blocked: the active one is chosen
    expect(defaultTarget(blocked({ archive: true }))).toBe('left');
    const none = targetChoices({ left: null, right: { ...folder('/r'), archive: true } }, 'left');
    expect(none.map((c) => c.blocked)).toEqual(['noFolder', 'archive']);
    expect(defaultTarget(none)).toBeNull();
  });

  it('shortens a long path in the middle without splitting it', () => {
    expect(shortenMiddle('/short')).toBe('/short');
    const long = `/Users/marc/${'ä'.repeat(80)}/Filme.nosync`;
    const cut = shortenMiddle(long, 40);
    expect([...cut].length).toBe(40);
    expect(cut.startsWith('/Users/marc/')).toBe(true);
    expect(cut.endsWith('Filme.nosync')).toBe(true);
    expect(cut).toContain('…');
  });

  it('takes only http(s) lines from the clipboard', () => {
    expect(
      clipboardUrls(
        'https://a.example/1\r\nsecret password\n  http://b.example/x  \nftp://c\nhttps://a.example/1\n--exec=x\nhttps://d.example/a b',
      ),
    ).toEqual(['https://a.example/1', 'http://b.example/x']);
    expect(clipboardUrls('')).toEqual([]);
    expect(clipboardUrls(`https://a.example/${'x'.repeat(3000)}`)).toEqual([]);
    expect(appendUrls('', ['https://a/1', 'https://a/2'])).toEqual({
      text: 'https://a/1\nhttps://a/2\n',
      added: 2,
    });
    expect(appendUrls('https://a/1', ['https://a/1', 'https://a/2'])).toEqual({
      text: 'https://a/1\nhttps://a/2\n',
      added: 1,
    });
    expect(appendUrls('x\n', [])).toEqual({ text: 'x\n', added: 0 });
  });
});

describe('download from URLs: store and dialog (design 078)', () => {
  let api: FakeUrlDownloadApi;
  let jobsApi: FakeJobsApi;
  let clip: FakeClipboardApi;
  let settingsApi: FakeSettingsApi;
  let actions: ActionService;
  let dialogs: DialogService;
  let ws: WorkspaceStore;
  let s: UrlDownloadStore;
  let left: FileBrowserStore;
  let right: FileBrowserStore;
  let fs: FakeFsApi;

  function dirListing(path: string, extra: Partial<DirectoryListing> = {}): DirectoryListing {
    return { ...listing(path, [entry('a.txt', { path: `${path}/a.txt` })], '/'), ...extra };
  }

  beforeEach(async () => {
    fs = new FakeFsApi();
    fs.handler = (path) => Promise.resolve(dirListing(path ?? '/home'));
    api = new FakeUrlDownloadApi();
    jobsApi = new FakeJobsApi();
    clip = new FakeClipboardApi();
    settingsApi = new FakeSettingsApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: jobsApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: ClipboardApi, useValue: clip },
        { provide: SettingsApi, useValue: settingsApi },
        { provide: UrlDownloadApi, useValue: api },
      ],
    });
    actions = TestBed.inject(ActionService);
    dialogs = TestBed.inject(DialogService);
    await TestBed.inject(SettingsStore).init();
    await TestBed.inject(JobsStore).init();
    ws = TestBed.inject(WorkspaceStore);
    s = TestBed.inject(UrlDownloadStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    ws.registerPanel('left', { store: left, controller: () => undefined });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerUrlDownloadActions(actions, s);
    await left.load('/home/marc/Download.nosync');
    await right.load('/home/marc/Filme.nosync');
  });

  async function open(): Promise<void> {
    await actions.run('OPEN_URL_DOWNLOAD_DLG');
    await flush();
  }

  async function type(text: string): Promise<void> {
    s.setText(text);
    await flush();
  }

  function finish(index: number, state: JobState, summary: Partial<Summary> = {}): void {
    jobsApi.emit({
      type: 'finished',
      id: jobsApi.started[index].id,
      state,
      summary: { ...SUMMARY, ...summary },
    });
  }

  it('opens with the other side as target and both folders to choose from', async () => {
    expect(ws.activeSide()).toBe('left');
    await open();
    expect(dialogs.open()).toBe('url-download');
    expect(s.choices().map((c) => [c.side, c.path, c.active, c.blocked])).toEqual([
      ['left', '/home/marc/Download.nosync', true, null],
      ['right', '/home/marc/Filme.nosync', false, null],
    ]);
    expect(s.side()).toBe('right');
    expect(s.target()?.path).toBe('/home/marc/Filme.nosync');
    expect(s.tools()?.ytDlp.state).toBe('ok');
    // nothing was read from the clipboard by opening
    expect(clip.reads).toBe(0);
    // overwrite is never preselected
    expect(s.form().overwrite).toBe(false);
    s.setSide('left');
    expect(s.target()?.path).toBe('/home/marc/Download.nosync');
  });

  it('follows the panels while it is open: the path shown is the path used', async () => {
    await open();
    await type('https://a.example/1');
    await right.load('/home/marc/Musik');
    expect(s.target()?.path).toBe('/home/marc/Musik');
    await s.run();
    expect(jobsApi.started[0].spec).toMatchObject({
      kind: 'download',
      targetDir: '/home/marc/Musik',
    });
  });

  it('blocks a side that shows an archive, a server or a result, and the action when both do', async () => {
    fs.handler = (path) =>
      Promise.resolve(
        dirListing(path ?? '/', { archive: { path: '/home/x.zip', format: 'zip' } as never }),
      );
    await right.load('/home/x.zip/inner');
    expect(actions.state('OPEN_URL_DOWNLOAD_DLG')).toBe('ready');
    await open();
    expect(s.choices()[1].blocked).toBe('archive');
    // the other (active) side is chosen instead
    expect(s.side()).toBe('left');
    // a blocked side cannot be chosen
    s.setSide('right');
    expect(s.side()).toBe('left');
    s.close();

    fs.handler = (path) =>
      Promise.resolve(dirListing(path ?? '/', { remote: { profile: 'p' } as never }));
    await left.load('remote://p/srv');
    expect(s.choices().map((c) => c.blocked)).toEqual(['server', 'archive']);
    expect(actions.state('OPEN_URL_DOWNLOAD_DLG')).toBe('disabled');
  });

  it('counts the lines and starts only without an invalid one', async () => {
    await open();
    // the acceptance case: three lines, one ftp, one repeated
    await type('https://a.example/1\nftp://a.example/2\nhttps://a.example/1');
    expect(s.check()).toMatchObject({
      urls: ['https://a.example/1'],
      problems: [{ line: 2, reason: 'scheme' }],
      duplicates: 1,
    });
    expect(s.canRun()).toBe(false);
    await s.run();
    expect(jobsApi.started).toEqual([]);
    // an option is no URL: it never reaches the job
    await type('https://a.example/1\n--exec=touch /tmp/pwned\n-o /tmp/x');
    expect(s.check()?.problems.map((p) => p.line)).toEqual([2, 3]);
    expect(s.canRun()).toBe(false);
    await type('');
    expect(s.canRun()).toBe(false);
    await type('https://a.example/1\n\nhttps://b.example/2\n');
    expect(s.canRun()).toBe(true);
    await s.run();
    expect(jobsApi.started).toHaveLength(1);
    const spec = jobsApi.started[0].spec;
    expect(spec).toEqual({
      kind: 'download',
      urls: ['https://a.example/1', 'https://b.example/2'],
      targetDir: '/home/marc/Filme.nosync',
      options: DEFAULT_DOWNLOAD_OPTIONS,
    });
    // the spec has typed options only – no program, no argument list
    expect(Object.keys(spec).sort()).toEqual(['kind', 'options', 'targetDir', 'urls']);
    expect(dialogs.open()).toBeNull();
    expect(s.text()).toBe('');
  });

  it('refuses a template that could leave the folder, with the reason', async () => {
    await open();
    await type('https://a.example/1');
    expect(s.canRun()).toBe(true);
    for (const bad of ['../x', '/etc/x', 'C:\\x']) {
      s.update({ template: bad });
      await flush();
      expect(s.check()?.template, bad).not.toBeNull();
      expect(s.canRun(), bad).toBe(false);
    }
    s.update({ template: '%(title)s.%(ext)s' });
    await flush();
    expect(s.check()?.example).toBe('My video.mp4');
    expect(s.canRun()).toBe(true);
  });

  it('ignores the answer of an older check', async () => {
    await open();
    let release: () => void = () => undefined;
    api.gate = new Promise<void>((r) => (release = r));
    s.setText('ftp://old.example/x');
    api.gate = null;
    s.setText('https://new.example/1');
    await flush();
    expect(s.check()?.urls).toEqual(['https://new.example/1']);
    release();
    await flush();
    // the late answer for the old text did not replace the newer one
    expect(s.check()?.urls).toEqual(['https://new.example/1']);
    expect(s.check()?.problems).toEqual([]);
    expect(s.checking()).toBe(false);
  });

  it('does not start while an answer is on its way', async () => {
    await open();
    await type('https://a.example/1');
    api.gate = new Promise<void>(() => undefined);
    s.setText('ftp://a.example/1');
    expect(s.checking()).toBe(true);
    expect(s.canRun()).toBe(false);
  });

  it('shows the install help instead of the form when yt-dlp is missing', async () => {
    api.toolsAnswer = downloadTools({ ytDlp: MISSING });
    await open();
    expect(s.locks().noYtDlp).toBe(true);
    await type('https://a.example/1');
    expect(s.canRun()).toBe(false);
    const fixture = TestBed.createComponent(UrlDownloadDialog);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('textarea')).toBeNull();
    expect(el.textContent).toContain('yt-dlp was not found');
    expect(el.textContent).toContain('brew install yt-dlp');
    // found after installing: the form appears
    api.toolsAnswer = downloadTools();
    await s.rescan();
    await fixture.whenStable();
    expect(el.querySelector('textarea')).not.toBeNull();
    expect(api.toolCalls).toBe(2);
  });

  it('locks what needs ffmpeg when ffmpeg is missing', async () => {
    TestBed.inject(SettingsStore).set('dialogs.recent', [
      { dialog: 'urlDownload', value: { content: 'audio', audioFormat: 'mp3' } },
    ]);
    api.toolsAnswer = downloadTools({ ffmpeg: MISSING, jsRuntime: MISSING });
    await open();
    expect(s.locks()).toEqual({ noYtDlp: false, noFfmpeg: true, noJsRuntime: true });
    // the kept "audio only (mp3)" cannot run: taken back to video
    expect(s.form().content).toBe('video');
    s.choosePreset('audioMp3');
    expect(s.form().content).toBe('video');
    s.update({ embedMetadata: true, container: 'mkv' });
    expect(s.form()).toMatchObject({ embedMetadata: false, container: 'auto' });
    await type('https://a.example/1');
    // a missing JavaScript runtime locks nothing
    expect(s.canRun()).toBe(true);
    const fixture = TestBed.createComponent(UrlDownloadDialog);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const audio = [...el.querySelectorAll<HTMLInputElement>('input[name="fnf-dl-content"]')][1];
    expect(audio.disabled).toBe(true);
    expect(audio.closest('label')?.getAttribute('title')).toBe('needs ffmpeg');
    expect(el.textContent).toContain('ffmpeg was not found');
    expect(el.textContent).toContain('YouTube needs one');
  });

  it('hints at an old yt-dlp and a too old runtime', async () => {
    api.toolsAnswer = downloadTools({
      ytDlpOutdated: true,
      jsRuntime: tool({ state: 'tooOld', version: '1.46.3', name: 'deno' }),
    });
    await open();
    const fixture = TestBed.createComponent(UrlDownloadDialog);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('more than 90 days old');
    expect(text).toContain('deno 1.46.3 is too old');
    expect(text).toContain('yt-dlp 2026.11.23 – found');
  });

  it('keeps the options of the last run – never the URLs, the cookies or overwrite', async () => {
    await open();
    await type('https://secret.example/private?token=abc');
    s.choosePreset('audioMp3');
    s.update({
      template: '%(title)s.%(ext)s',
      overwrite: true,
      cookiesBrowser: 'firefox',
      playlist: true,
      playlistSubfolder: true,
    });
    await flush();
    await s.run();
    const sent = jobsApi.started[0].spec;
    expect(sent.kind === 'download' && sent.options).toMatchObject({
      content: 'audio',
      audioFormat: 'mp3',
      overwrite: true,
      cookiesBrowser: 'firefox',
      playlistSubfolder: true,
    });
    const kept = TestBed.inject(SettingsStore).get('dialogs.recent');
    const text = JSON.stringify(kept);
    expect(text).not.toContain('secret.example');
    expect(text).not.toContain('token');
    expect(text).not.toContain('http');
    expect(text).not.toContain('firefox');
    expect(kept).toEqual([
      {
        dialog: 'urlDownload',
        value: {
          ...DEFAULT_DOWNLOAD_OPTIONS,
          content: 'audio',
          audioFormat: 'mp3',
          template: '%(title)s.%(ext)s',
          playlist: true,
          playlistSubfolder: true,
        } satisfies DownloadOptions,
      },
    ]);
    // the next opening starts with these options, an empty field and no cookies
    await open();
    expect(s.text()).toBe('');
    expect(s.form()).toMatchObject({
      content: 'audio',
      audioFormat: 'mp3',
      overwrite: false,
      cookiesBrowser: null,
    });
  });

  it('reads the clipboard only on the button and takes only addresses', async () => {
    await open();
    clip.text = 'my password\nhttps://a.example/1\nhttps://b.example/2';
    expect(clip.reads).toBe(0);
    await s.paste();
    await flush();
    expect(clip.reads).toBe(1);
    expect(s.text()).toBe('https://a.example/1\nhttps://b.example/2\n');
    expect(s.text()).not.toContain('password');
    expect(s.notice()).toBe('2 addresses added from the clipboard.');
    await s.paste();
    expect(s.notice()).toBe('The clipboard holds no new http(s) address.');
    clip.text = null;
    await s.paste();
    expect(s.notice()).toContain('could not be read');
  });

  it('copies the command of the first URL and names the shell it is quoted for', async () => {
    await open();
    await type('https://a.example/1\nhttps://b.example/2');
    await s.copyCommand();
    expect(api.commandLines.map((c) => c.url)).toEqual(['https://a.example/1']);
    expect(clip.written).toEqual(["yt-dlp -- 'https://a.example/1'"]);
    expect(s.notice()).toBe('The command for PowerShell is in the clipboard.');
  });

  // review 078 #2: cmd.exe cannot take the command safely – then nothing is copied
  it('copies nothing when the shell cannot take the command', async () => {
    api.refuseCommandLine = { code: 'unquotable_name', message: 'cmd', path: null };
    await open();
    await type('https://a.example/1');
    await s.copyCommand();
    expect(clip.written).toEqual([]);
    expect(s.notice()).toBeNull();
    expect(s.runError()).toContain('PowerShell');
  });

  // review 078 #4: an MCP client can navigate the other side – which is the default target
  it('says so when an MCP client chose the folder of the target', async () => {
    const guard = TestBed.inject(McpGuardService);
    guard.changed('right', 'Evil client', null);
    await open();
    expect(s.side()).toBe('right');
    expect(s.targetChangedBy()).toBe('Evil client');
    const fixture = TestBed.createComponent(UrlDownloadDialog);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const hint = el.querySelector('.mcp-hint');
    expect(hint?.textContent).toContain('Evil client');
    expect(hint?.getAttribute('role')).toBe('alert');
    // the side the user is on is theirs
    s.setSide('left');
    expect(s.targetChangedBy()).toBeNull();
    await fixture.whenStable();
    expect(el.querySelector('.mcp-hint')).toBeNull();
    // the user touched the panel again: the folder is theirs
    s.setSide('right');
    guard.userTouched('right');
    expect(s.targetChangedBy()).toBeNull();
    // starting a download into it is a knowing confirmation
    guard.changed('right', 'Evil client', null);
    await type('https://a.example/1');
    await s.run();
    expect(guard.influence('right', new Set())).toBeNull();
  });

  it('an own preset travels as its id; one that is gone blocks the start', async () => {
    api.presetsAnswer = {
      presets: [{ id: 'p720', label: 'Video 720p' }],
      problems: [{ id: 'evil', reason: 'notAllowed', option: '--exec' }],
      warning: null,
      file: '/config/url-download.json',
    };
    await open();
    await type('https://a.example/1');
    s.choosePreset(s.ownPresetValue('p720'));
    await flush();
    expect(s.form().preset).toBe('p720');
    const fixture = TestBed.createComponent(UrlDownloadDialog);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Video 720p (url-download.json)');
    // the refused preset is named with its reason – and is not offered
    expect(el.textContent).toContain('evil: option not allowed (--exec)');
    expect([...el.querySelectorAll('option')].some((o) => o.value === 'own:evil')).toBe(false);
    expect(s.canRun()).toBe(true);
    await s.run();
    const spec = jobsApi.started[0].spec;
    expect(spec.kind === 'download' && spec.options.preset).toBe('p720');
    expect(JSON.stringify(spec)).not.toContain('--');
    // the preset left the file
    api.presetsAnswer = { ...api.presetsAnswer, presets: [] };
    await open();
    await type('https://a.example/1');
    expect(s.presetGone()).toBe(true);
    expect(s.canRun()).toBe(false);
  });

  it('reports what the job came to', async () => {
    const jobs = TestBed.inject(JobsStore);
    await open();
    await type('https://a.example/1\nhttps://b.example/2');
    await s.run();
    expect(jobs.messages()).toContain('Download of 2 URLs started.');
    finish(0, 'doneWithErrors', { itemsDone: 1, itemsFailed: 1 });
    await flush();
    expect(jobs.messages()).toContain('Download finished – 1 URL failed (see Tasks).');
    await open();
    await type('https://a.example/1');
    await s.run();
    finish(1, 'done', {
      itemsDone: 1,
      download: { files: ['/home/marc/Filme.nosync/a.mp4'], fileCount: 1, present: 0 },
    });
    await flush();
    expect(jobs.messages()).toContain('Download finished: 1 file.');
  });

  it('shows a refusal of Rust in the dialog and keeps it open', async () => {
    await open();
    await type('https://a.example/1');
    jobsApi.refuse = { code: 'download_tool_missing', message: 'yt-dlp was not found', path: null };
    await s.run();
    expect(dialogs.open()).toBe('url-download');
    expect(s.runError()).toContain('A program for the download was not found');
    expect(s.busy()).toBe(false);
    expect(s.text()).toBe('https://a.example/1');
  });

  it('the dialog: select, count line, Enter in the URL field is a line break', async () => {
    await open();
    await type('https://a.example/1\nftp://a.example/2\nhttps://a.example/1');
    const fixture = TestBed.createComponent(UrlDownloadDialog);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const select = el.querySelector<HTMLSelectElement>('select.target');
    expect([...(select?.options ?? [])].map((o) => [o.textContent?.trim(), o.selected])).toEqual([
      ['Left · /home/marc/Download.nosync (active panel)', false],
      ['Right · /home/marc/Filme.nosync', true],
    ]);
    expect(el.querySelector('#fnf-dl-count')?.textContent?.trim()).toBe(
      '1 URL · 1 invalid (line 2: only http and https) · 1 repeated',
    );
    expect(el.querySelector('#fnf-dl-count')?.getAttribute('aria-live')).toBe('polite');
    const start = el.querySelector<HTMLButtonElement>('button.primary');
    expect(start?.disabled).toBe(true);
    // the select changes the target by keyboard (a native select)
    if (select) {
      select.value = 'left';
      select.dispatchEvent(new Event('change'));
    }
    expect(s.side()).toBe('left');
    // Enter in the textarea does not start; Mod+Enter does (when the input is valid)
    await type('https://a.example/1');
    await fixture.whenStable();
    const area = el.querySelector<HTMLTextAreaElement>('textarea');
    area?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(jobsApi.started).toEqual([]);
    area?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, metaKey: true, bubbles: true }),
    );
    await flush();
    expect(jobsApi.started).toHaveLength(1);
  });

  it('hostile text is shown as text', async () => {
    api.presetsAnswer = {
      presets: [{ id: 'x', label: '<img src=x onerror=alert(1)>' }],
      problems: [],
      warning: null,
      file: '/c/<b>url-download.json</b>',
    };
    api.toolsAnswer = downloadTools({ ytDlp: tool({ version: '<script>1</script>' }) });
    await open();
    const fixture = TestBed.createComponent(UrlDownloadDialog);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(el.textContent).toContain('<script>1</script>');
  });
});

describe('download from URLs: entries and job texts (design 078)', () => {
  it('has the action in the catalog, the Actions menu, the main menu and all keymaps', () => {
    expect(ACTIONS.OPEN_URL_DOWNLOAD_DLG.label).toBe('Download from URLs…');
    // vetoed right after an MCP client changed the view (design 071): category files
    expect(ACTIONS.OPEN_URL_DOWNLOAD_DLG.category).toBe('files');
    expect(ACTIONS_MENU_COLUMNS[2]).toContain('OPEN_URL_DOWNLOAD_DLG');
    expect(OPENS_DIALOG.has('OPEN_URL_DOWNLOAD_DLG')).toBe(true);
    expect(JSON.stringify(MENU_BAR)).toContain('OPEN_URL_DOWNLOAD_DLG');
    for (const map of [linuxKeymap, macosKeymap, windowsKeymap] as Record<string, string[]>[]) {
      expect(map['OPEN_URL_DOWNLOAD_DLG']).toEqual(['Mod+Alt+U']);
      const taken = Object.entries(map).filter(([, keys]) => keys.includes('Mod+Alt+U'));
      expect(taken.map(([id]) => id)).toEqual(['OPEN_URL_DOWNLOAD_DLG']);
    }
  });

  it('describes the new error codes', () => {
    for (const code of [
      'download_target_unsupported',
      'download_tool_missing',
      'download_invalid_url',
      'download_invalid_template',
      'download_invalid_options',
      'download_failed',
    ]) {
      const e = toFsError({ code, message: 'x', path: null });
      expect(e.code, code).toBe(code);
      expect(describeFsError(e), code).not.toBe('Read or write error.');
    }
  });

  it('shows a download job without its URLs in the title and without a pause button', () => {
    const job: JobInfo = {
      id: 'j1',
      spec: {
        kind: 'download',
        urls: ['https://secret.example/a?token=1', 'https://b.example/2'],
        targetDir: '/home/marc/Filme',
        options: DEFAULT_DOWNLOAD_OPTIONS,
      },
      state: 'running',
      progress: {
        bytesDone: 1024 * 1024,
        bytesTotal: 4 * 1024 * 1024,
        itemsDone: 0,
        itemsTotal: 2,
        current: 'secret.example/a',
        rateBps: 512 * 1024,
        phase: 'downloading',
      },
      conflict: null,
      summary: null,
      pauseReason: null,
      undoAvailable: false,
      retryAvailable: false,
    };
    expect(jobTitle(job)).toBe('Download 2 URLs → /home/marc/Filme');
    expect(jobTitle(job)).not.toContain('secret');
    expect(amountText(job.progress)).toMatch(/^URL 1 of 2 · /);
    expect(speedText(job.progress)).toContain('/s');
    expect(speedText({ ...job.progress, phase: 'processing', rateBps: 0 })).toBe(
      'processing (ffmpeg)',
    );
    const [row] = jobRows([job]);
    expect(row.buttons.map((b) => b.act)).toEqual(['cancel']);
    expect(row.percent).toBe(25);
    // other jobs keep their pause button
    const [copy] = jobRows([
      { ...job, spec: { kind: 'copy', sources: ['/a'], targetDir: '/b' } as never },
    ]);
    expect(copy.buttons.map((b) => b.act)).toEqual(['pause', 'cancel']);
  });
});
