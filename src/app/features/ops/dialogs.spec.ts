import { TestBed } from '@angular/core/testing';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { CopyMoveDialog } from './copy-move-dialog';
import { OPS_TEXTS } from './ops-texts';
import { DeleteDialog } from './delete-dialog';
import { NameDialog } from './name-dialog';
import { OpsStore } from './ops.store';

const flush = () => new Promise((r) => setTimeout(r));

describe('operation dialogs', () => {
  let fs: FakeFsApi;
  let jobsApi: FakeJobsApi;
  let ops: OpsStore;

  beforeEach(async () => {
    fs = new FakeFsApi();
    fs.locations = { '/dst': { dir: '/dst', select: null } };
    jobsApi = new FakeJobsApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: jobsApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    ops = TestBed.inject(OpsStore);
    await TestBed.inject(JobsStore).init();
  });

  async function render<T>(cmp: new () => T) {
    const fixture = TestBed.createComponent(cmp);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const a = entry('a.txt', { path: '/src/a.txt' });
  const sub = dir('Sub', { path: '/src/Sub' });

  function copyRequest(dangers = false) {
    ops.copyMove.set({
      kind: 'copy',
      side: 'left',
      sourceDir: '/src',
      sources: [a],
      target: '/dst',
      targets: [{ path: '/dst', group: 'Other panel' }],
      dangers: dangers ? [{ path: '/src/a.txt', danger: 'system' }] : [],
    });
    TestBed.inject(DialogService).show('copy-move');
  }

  it('target: the "…" button right of the field opens the suggestions as a menu and fills the field', async () => {
    copyRequest();
    const { fixture, el } = await render(CopyMoveDialog);
    const button = el.querySelector<HTMLButtonElement>('button.pick')!;
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    button.click();
    fixture.detectChanges();
    const items = [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.length).toBeGreaterThan(0);
    items[0].click();
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
    const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input.value).toBe(items[0].textContent?.trim());
  });

  it('copy: counts live, cancels the count on close and starts with the options', async () => {
    copyRequest();
    const { fixture, el } = await render(CopyMoveDialog);
    expect(jobsApi.started[0].spec).toEqual({ kind: 'count', paths: ['/src/a.txt'] });
    const countId = jobsApi.started[0].id;
    await flush();
    fixture.detectChanges();
    expect(el.querySelector('.count')?.textContent).toContain('counting');
    jobsApi.emit({
      type: 'finished',
      id: countId,
      state: 'done',
      summary: {
        itemsDone: 1,
        itemsSkipped: 0,
        itemsFailed: 0,
        bytesDone: 2048,
        errors: [],
        error: null,
        dirSize: { files: 1, dirs: 0, bytes: 2048, unreadable: 0, cancelled: false },
      },
    });
    fixture.detectChanges();
    expect(el.querySelector('.count')?.textContent).toContain('1 file, 0 folders, 2.0 KB');
    // Rust removes finished helper jobs at once (review 009 #10): the count stays
    jobsApi.emit({ type: 'removed', ids: [countId] });
    fixture.detectChanges();
    expect(el.querySelector('.count')?.textContent).toContain('1 file, 0 folders, 2.0 KB');
    const inputs = el.querySelectorAll<HTMLInputElement>('input[type="text"]');
    expect(inputs[0].value).toBe('/dst');
    expect(inputs[1].value).toBe('a.txt');
    const selects = el.querySelectorAll<HTMLSelectElement>('select');
    // the suggestions are a "…" menu now, the only select is the conflict default
    selects[0].value = 'overwrite';
    selects[0].dispatchEvent(new Event('change'));
    el.querySelector('form')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    await flush();
    expect(jobsApi.started[1].spec).toEqual({
      kind: 'copy',
      sources: ['/src/a.txt'],
      targetDir: '/dst',
      background: false,
      options: { conflictDefault: 'overwrite', renameTo: null },
    });
    fixture.destroy();
    expect(jobsApi.cancelled).toEqual([]); // the count had finished
  });

  it('copy: an error stays in the dialog; the count is cancelled when it closes early', async () => {
    copyRequest();
    const { fixture, el } = await render(CopyMoveDialog);
    const target = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    target.value = '/nix';
    target.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await flush();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No such file');
    expect(target.getAttribute('aria-invalid')).toBe('true');
    fixture.destroy();
    expect(jobsApi.cancelled).toEqual([jobsApi.started[0].id]);
  });

  it('copy: a count that starts after the dialog closed is cancelled', async () => {
    copyRequest();
    const fixture = TestBed.createComponent(CopyMoveDialog);
    fixture.destroy(); // before the start of the count resolved
    await flush();
    expect(jobsApi.cancelled).toEqual([jobsApi.started[0].id]);
  });

  it('copy: dangerous paths need the extra tick', async () => {
    copyRequest(true);
    const { fixture, el } = await render(CopyMoveDialog);
    expect(el.querySelector('.danger-box')?.textContent).toContain('system folder');
    const start = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(start.disabled).toBe(true);
    el.querySelector<HTMLInputElement>('.danger-box input')!.click();
    fixture.detectChanges();
    expect(start.disabled).toBe(false);
  });

  it('review 009 #5: copy warns about equal names from different folders, louder with "overwrite"', async () => {
    const other = entry('A.TXT', { path: '/other/A.TXT' });
    ops.copyMove.set({
      kind: 'copy',
      side: 'left',
      sourceDir: 'search:s1',
      sources: [a, sub, other],
      target: '/dst',
      targets: [],
      dangers: [],
    });
    TestBed.inject(DialogService).show('copy-move');
    const { fixture, el } = await render(CopyMoveDialog);
    const box = () => el.querySelector('.same-names')?.textContent ?? '';
    expect(box()).toContain('a.txt');
    expect(box()).not.toContain('Sub');
    expect(box()).not.toContain(OPS_TEXTS.sameNamesOverwrite);
    const select = [...el.querySelectorAll<HTMLSelectElement>('select')].at(-1)!;
    select.value = 'overwrite';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(box()).toContain(OPS_TEXTS.sameNamesOverwrite);
    fixture.destroy();
  });

  it('delete: trash confirms with Enter, permanent defaults to Cancel', async () => {
    ops.del.set({ mode: 'trash', side: 'left', sourceDir: '/src', entries: [a, sub], dangers: [] });
    TestBed.inject(DialogService).show('delete');
    let r = await render(DeleteDialog);
    let buttons = r.el.querySelectorAll<HTMLButtonElement>('.buttons button');
    const confirmBtn = () =>
      r.el.querySelector<HTMLButtonElement>('[data-testid="delete-confirm"]')!;
    expect(r.el.textContent).toContain('Move 2 entries to the trash?');
    expect(confirmBtn().hasAttribute('data-autofocus')).toBe(true);
    expect(r.el.querySelector('[role="dialog"]')).not.toBeNull();
    // the second, red button is there but never the default
    expect(buttons.length).toBe(3);
    expect(buttons[1].dataset['testid']).toBe('delete-permanent');
    expect(buttons[1].classList).toContain('danger');
    expect(buttons[1].hasAttribute('data-autofocus')).toBe(false);
    confirmBtn().click();
    await flush();
    expect(jobsApi.started[0].spec).toMatchObject({ kind: 'delete', mode: 'trash' });
    r.fixture.destroy();

    ops.del.set({ mode: 'permanent', side: 'left', sourceDir: '/src', entries: [a], dangers: [] });
    TestBed.inject(DialogService).show('delete');
    r = await render(DeleteDialog);
    buttons = r.el.querySelectorAll<HTMLButtonElement>('.buttons button');
    expect(r.el.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(r.el.textContent).toContain('cannot be undone');
    expect(buttons[0].hasAttribute('data-autofocus')).toBe(true);
    expect(buttons[1].classList).toContain('danger');
    // permanent mode: no second "Delete permanently" button
    expect(buttons.length).toBe(2);
    r.fixture.destroy();

    // a dangerous path: the delete button starts disabled, so Cancel gets the focus
    ops.del.set({
      mode: 'trash',
      side: 'left',
      sourceDir: '/',
      entries: [a],
      dangers: [{ path: '/src/a.txt', danger: 'home' }],
    });
    r = await render(DeleteDialog);
    buttons = r.el.querySelectorAll<HTMLButtonElement>('.buttons button');
    expect(buttons[0].hasAttribute('data-autofocus')).toBe(true);
    expect(buttons[1].disabled).toBe(true);
    expect(buttons[2].disabled).toBe(true);
  });

  it('delete: the trash dialog can delete permanently instead', async () => {
    ops.del.set({ mode: 'trash', side: 'left', sourceDir: '/src', entries: [a], dangers: [] });
    TestBed.inject(DialogService).show('delete');
    const r = await render(DeleteDialog);
    const forever = r.el.querySelector<HTMLButtonElement>('[data-testid="delete-permanent"]')!;
    const message = () => r.el.querySelector('#fnf-delete-message')!;
    expect(forever.textContent).toContain(OPS_TEXTS.deletePermanent);
    expect(message().textContent).toContain('trash');
    // hover or focus warns before the click
    forever.dispatchEvent(new Event('mouseenter'));
    r.fixture.detectChanges();
    expect(message().textContent).toContain('cannot be undone');
    expect(message().classList).toContain('danger-text');
    // the trash hint only hides: removing it would move the buttons away from the pointer
    const hint = r.el.querySelector<HTMLElement>('p.help')!;
    expect(hint).not.toBeNull();
    expect(hint.style.visibility).toBe('hidden');
    forever.dispatchEvent(new Event('mouseleave'));
    r.fixture.detectChanges();
    expect(message().textContent).not.toContain('cannot be undone');
    forever.dispatchEvent(new Event('focus'));
    r.fixture.detectChanges();
    expect(message().textContent).toContain('cannot be undone');
    forever.click();
    await flush();
    expect(jobsApi.started[0].spec).toMatchObject({ kind: 'delete', mode: 'permanent' });
    expect(ops.del()).toBeNull();
  });

  it('rename: selects the name without extension, offers "Rename anyway" for dangerous paths', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      ops.name.set({
        kind: 'rename',
        side: 'left',
        parent: '/src',
        initial: 'a.txt',
        selectEnd: 1,
        entry: a,
      });
      TestBed.inject(DialogService).show('name');
      const { fixture, el } = await render(NameDialog);
      vi.runAllTimers();
      const input = el.querySelector<HTMLInputElement>('input')!;
      expect(input.value).toBe('a.txt');
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 1]);
      fs.failNext = { code: 'dangerous_path', message: 'This is a system folder', path: null };
      input.value = 'b.txt';
      input.dispatchEvent(new Event('input'));
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await vi.waitFor(() => expect(fs.ops.length).toBe(1));
      await Promise.resolve();
      fixture.detectChanges();
      expect(el.querySelector('[role="alert"]')?.textContent).toContain('system folder');
      expect(el.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Rename anyway');
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await vi.waitFor(() => expect(fs.ops.length).toBe(2));
      expect(fs.ops[1]).toBe('rename /src/a.txt b.txt !');
    } finally {
      vi.useRealTimers();
    }
  });
});
