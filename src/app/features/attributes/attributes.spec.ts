import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { DirEntry } from '../../core/fs/fs.models';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { PreviewApi } from '../../core/preview/preview-api';
import { Properties } from '../../core/preview/preview.models';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakePreviewApi } from '../../../testing/fake-preview-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { OFF_WHILE_UNCHECKED } from '../actions/workspace-actions';
import { OFF_IN_ARCHIVE } from '../archive/archive-actions';
import { FileBrowserStore } from '../browser/file-browser.store';
import { jobTitle } from '../jobs/job-format';
import { registerPreviewActions } from '../preview/preview-actions';
import { PropertiesDialog } from '../preview/properties-dialog';
import { PropertiesStore } from '../preview/properties.store';
import { QuickViewStore } from '../preview/quick-view.store';
import { ViewerStore } from '../preview/viewer.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { rwxBit, toggleBit, setTime } from './attributes-logic';
import { registerAttributesActions } from './attributes-actions';
import { AttributesDialog } from './attributes-dialog';
import { AT_TEXTS } from './attributes-texts';
import { AttributesStore, MAX_PROBED } from './attributes.store';

const flush = () => new Promise((r) => setTimeout(r));

describe('change attributes (design 024)', () => {
  let fsApi: FakeFsApi;
  let preview: FakePreviewApi;
  let jobsApi: FakeJobsApi;
  let actions: ActionService;
  let dialogs: DialogService;
  let ws: WorkspaceStore;
  let jobs: JobsStore;
  let store: AttributesStore;
  let left: FileBrowserStore;
  let modes: Record<string, number>;
  const entries: DirEntry[] = [
    dir('Ordner', { path: '/src/Ordner' }),
    entry('a.txt', { path: '/src/a.txt' }),
    entry('b.txt', { path: '/src/b.txt' }),
    entry('link', { path: '/src/link', kind: 'symlink', targetKind: 'file' }),
  ];

  beforeEach(async () => {
    modes = { '/src/Ordner': 0o755, '/src/a.txt': 0o644, '/src/b.txt': 0o664 };
    fsApi = new FakeFsApi();
    fsApi.handler = (path?: string) => Promise.resolve(listing(path ?? '/src', entries));
    preview = new FakePreviewApi();
    const base = preview.properties;
    preview.properties = (path): Properties => {
      const p = base(path);
      return { ...p, unix: p.unix && { ...p.unix, mode: modes[path] ?? 0o600 } };
    };
    jobsApi = new FakeJobsApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fsApi },
        { provide: PreviewApi, useValue: preview },
        { provide: JobsApi, useValue: jobsApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    dialogs = TestBed.inject(DialogService);
    ws = TestBed.inject(WorkspaceStore);
    jobs = TestBed.inject(JobsStore);
    store = TestBed.inject(AttributesStore);
    await jobs.init();
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    const right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    ws.registerPanel('left', { store: left, controller: () => undefined });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerAttributesActions(actions, store);
    await left.load('/src');
  });

  function finish(state: 'done' | 'doneWithErrors' | 'failed', over: object = {}) {
    jobsApi.emit({
      type: 'finished',
      id: jobsApi.started[0].id,
      state,
      summary: {
        itemsDone: 2,
        itemsSkipped: 0,
        itemsFailed: 0,
        bytesDone: 0,
        errors: [],
        error: null,
        dirSize: null,
        ...over,
      },
    });
  }

  it('the action is a files action with a shortcut on every OS and locked in archives and unchecked listings', () => {
    expect(OFF_IN_ARCHIVE.has('OPEN_CHANGE_ATTRIBUTES_DLG')).toBe(true);
    expect(OFF_WHILE_UNCHECKED.has('OPEN_CHANGE_ATTRIBUTES_DLG')).toBe(true);
    for (const os of ['linux', 'macos', 'windows'] as const) {
      actions.platform.set(os);
      expect(actions.keymap().bindings['OPEN_CHANGE_ATTRIBUTES_DLG']).toEqual(['Mod+Shift+F2']);
      expect(actions.keymap().conflicts).toEqual([]);
    }
  });

  it('opens for the marked entries, reads their values and starts one job', async () => {
    left.setMarked(['/src/a.txt', '/src/b.txt', '/src/link'], true);
    await actions.run('OPEN_CHANGE_ATTRIBUTES_DLG');
    expect(dialogs.open()).toBe('attributes');
    await flush();
    expect(store.loading()).toBe(false);
    expect([...preview.propertyReads].sort()).toEqual(['/src/a.txt', '/src/b.txt']);
    expect(store.links()).toBe(1);
    const f = store.form()!;
    expect(f.bits[rwxBit('group', 'write')].value).toBe('mixed');
    expect(f.bits[rwxBit('owner', 'write')].value).toBe('on');
    expect(store.canRun()).toBe(false);
    store.update((x) => toggleBit(x, rwxBit('others', 'write')));
    expect(store.changeCount()).toBe(1);
    await store.run();
    expect(jobsApi.started[0].spec).toEqual({
      kind: 'attributes',
      paths: ['/src/a.txt', '/src/b.txt', '/src/link'],
      change: { modeSet: 0o002 },
      recursive: false,
      applyTo: 'all',
    });
    expect(dialogs.open()).toBeNull();
    expect(jobTitle({ ...jobsApi.snapshot[0], spec: jobsApi.started[0].spec } as never)).toBe(
      'Change attributes of 3 entries',
    );
    finish('done', { itemsDone: 2, itemsSkipped: 0 });
    await flush();
    expect(jobs.messages().at(-1)).toBe(AT_TEXTS.done(2, 0));
  });

  it('cursor entry without marks; recursion sends the filter; errors are reported', async () => {
    left.setCursor('/src/Ordner');
    await actions.run('OPEN_CHANGE_ATTRIBUTES_DLG');
    await flush();
    store.update((f) => ({
      ...toggleBit(f, rwxBit('group', 'write')),
      recursive: true,
      applyTo: 'dirs',
    }));
    await store.run();
    expect(jobsApi.started[0].spec).toMatchObject({
      paths: ['/src/Ordner'],
      change: { modeSet: 0o020 },
      recursive: true,
      applyTo: 'dirs',
    });
    finish('doneWithErrors', { itemsFailed: 3 });
    await flush();
    expect(jobs.messages().at(-1)).toBe(AT_TEXTS.withErrors(3));
  });

  it('a refused start keeps the dialog open with the error', async () => {
    left.setCursor('/src/a.txt');
    await actions.run('OPEN_CHANGE_ATTRIBUTES_DLG');
    await flush();
    store.update((f) => setTime(f, 'modified', { enabled: true, now: true }));
    jobsApi.refuse = { code: 'dangerous_path', message: 'home', path: '/home/u' };
    await store.run();
    expect(dialogs.open()).toBe('attributes');
    expect(store.runError()?.code).toBe('dangerous_path');
    expect(store.busy()).toBe(false);
  });

  it('too many entries: nothing is read, everything starts as "unchanged"', async () => {
    const many = Array.from({ length: MAX_PROBED + 1 }, (_, i) =>
      entry(`f${i}`, { path: `/src/f${i}` }),
    );
    await store.openFor(many);
    expect(preview.propertyReads).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(Object.values(store.form()!.bits).every((b) => b.value === 'mixed')).toBe(true);
  });

  it('a stale answer does not replace the form of a newer request', async () => {
    const held: (() => void)[] = [];
    const real = preview.getProperties.bind(preview);
    preview.getProperties = (path) =>
      new Promise((resolve) => held.push(() => void real(path).then(resolve)));
    void store.openFor([entries[1]]);
    void store.openFor([entries[2]]);
    held.reverse().forEach((f) => f()); // the newer answer first, then the stale one
    await flush();
    expect(store.request()?.entries[0].path).toBe('/src/b.txt');
    expect(store.form()!.bits[rwxBit('group', 'write')].value).toBe('on');
  });

  describe('dialog', () => {
    async function render() {
      const fixture = TestBed.createComponent(AttributesDialog);
      fixture.detectChanges();
      await fixture.whenStable();
      return { fixture, el: fixture.nativeElement as HTMLElement };
    }

    it('Linux: permission grid, octal, times without "created"; tri-state and Ctrl+Enter', async () => {
      left.setMarked(['/src/a.txt', '/src/b.txt'], true);
      await actions.run('OPEN_CHANGE_ATTRIBUTES_DLG');
      await flush();
      const { fixture, el } = await render();
      expect(el.querySelector('h2')?.textContent).toContain('2 entries');
      const box = (label: string) =>
        el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      const gw = box('Group: Write');
      expect(gw.indeterminate).toBe(true);
      expect(box('Owner: Read').checked).toBe(true);
      expect(el.querySelector<HTMLInputElement>('input.octal')!.value).toBe('');
      expect(el.textContent).toContain(AT_TEXTS.mixedHint);
      expect(el.textContent).not.toContain('Created');
      expect(el.textContent).not.toContain('Hidden');
      gw.click();
      fixture.detectChanges();
      expect(gw.checked).toBe(true);
      expect(gw.indeterminate).toBe(false);
      expect(el.querySelector('.summary')?.textContent).toContain(AT_TEXTS.summary(2, 1, false));
      const octal = el.querySelector<HTMLInputElement>('input.octal')!;
      octal.value = '4750';
      octal.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(el.querySelector('.warn')).not.toBeNull();
      expect(store.change()).toEqual({ modeSet: 0o4750, modeClear: 0o3027 });
      octal.value = '9';
      octal.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(octal.getAttribute('aria-invalid')).toBe('true');
      el.querySelector('.attrs')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      );
      await flush();
      expect(jobsApi.started[0].spec).toMatchObject({ kind: 'attributes' });
    });

    it('Windows: R/H/S/A and created time, no permissions', async () => {
      actions.platform.set('windows');
      left.setCursor('/src/a.txt');
      await actions.run('OPEN_CHANGE_ATTRIBUTES_DLG');
      await flush();
      const { el } = await render();
      expect(el.querySelector('table.perm')).toBeNull();
      const text = el.textContent ?? '';
      for (const label of ['Read-only', 'Hidden', 'System', 'Archive', 'Created']) {
        expect(text).toContain(label);
      }
    });

    it('macOS: permissions plus "hidden" and created time', async () => {
      actions.platform.set('macos');
      left.setCursor('/src/a.txt');
      await actions.run('OPEN_CHANGE_ATTRIBUTES_DLG');
      await flush();
      const { el } = await render();
      expect(el.querySelector('table.perm')).not.toBeNull();
      expect(el.textContent).toContain('Hidden');
      expect(el.textContent).not.toContain('System');
      expect(el.textContent).toContain('Created');
    });

    it('an invalid date blocks "Change" and says why', async () => {
      left.setCursor('/src/a.txt');
      await actions.run('OPEN_CHANGE_ATTRIBUTES_DLG');
      await flush();
      store.update((f) => setTime(f, 'modified', { enabled: true, value: 'x' }));
      const { el } = await render();
      expect(el.querySelector('[role="alert"]')?.textContent).toContain(AT_TEXTS.timeInvalid);
      const run = [...el.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === AT_TEXTS.run,
      )!;
      expect(run.disabled).toBe(true);
    });
  });

  it('properties → "Change…" hands the entry over, not for links', async () => {
    const props = TestBed.inject(PropertiesStore);
    registerPreviewActions(
      actions,
      ws,
      TestBed.inject(ViewerStore),
      TestBed.inject(QuickViewStore),
      props,
    );
    left.setCursor('/src/a.txt');
    await actions.run('OPEN_ATTRIBUTE_DLG');
    await flush();
    const fixture = TestBed.createComponent(PropertiesDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const change = [...el.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Change…',
    )!;
    change.click();
    await flush();
    expect(dialogs.open()).toBe('attributes');
    expect(props.entry()).toBeNull();
    expect(store.request()?.entries.map((e) => e.path)).toEqual(['/src/a.txt']);
    store.close();

    left.setCursor('/src/link');
    await actions.run('OPEN_ATTRIBUTE_DLG');
    await flush();
    fixture.detectChanges();
    const labels = [...el.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Change…');
  });
});
