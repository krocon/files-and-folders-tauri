import { FsApi } from '../../core/fs/fs-api';
import { SessionApi } from '../../core/session/session-api';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FakeFsApi } from '../../../testing/fs-fixtures';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { RenameApi } from '../../core/rename/rename-api';
import { FakeRenameApi } from '../../../testing/fake-rename-api';
import { TestBed } from '@angular/core/testing';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { ConflictDialog } from './conflict-dialog';
import { JobListDialog } from './job-list-dialog';

const copy = { kind: 'copy' as const, sources: ['/a/x.txt'], targetDir: '/b' };

describe('job dialogs', () => {
  let api: FakeJobsApi;
  let store: JobsStore;
  let renameApi: FakeRenameApi;

  beforeEach(async () => {
    api = new FakeJobsApi();
    renameApi = new FakeRenameApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: JobsApi, useValue: api },
        // the task list offers "Undo" for rename jobs (MultiRenameStore → workspace)
        { provide: RenameApi, useValue: renameApi },
        { provide: FsApi, useValue: new FakeFsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    store = TestBed.inject(JobsStore);
    await store.init();
  });

  async function withConflict() {
    const id = await store.start(copy);
    api.emit({
      type: 'conflict',
      id,
      conflict: {
        conflictId: 3,
        kind: 'exists',
        source: '/a/x.txt',
        target: '/b/x.txt',
        sourceMeta: { size: 2048, modifiedMs: 0, isDir: false },
        targetMeta: { size: 10, modifiedMs: 0, isDir: false },
        suggestedName: 'x (1).txt',
      },
    });
    api.emit({ type: 'state', id, state: 'waitingForDecision' });
    TestBed.inject(DialogService).show('conflict');
    const fixture = TestBed.createComponent(ConflictDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    return { id, fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('conflict: alertdialog with both files, Skip is the default', async () => {
    const { el } = await withConflict();
    const dialog = el.querySelector('[role="alertdialog"]')!;
    expect(dialog).not.toBeNull();
    expect(el.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(dialog.getAttribute('aria-describedby')).toBe('fnf-conflict-intro');
    expect(el.textContent).toContain('/b/x.txt');
    expect(el.textContent).toContain('2.0 KB');
    const skip = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Skip')!;
    expect(skip.hasAttribute('data-autofocus')).toBe(true);
    // the underlined letter is part of the word: one flex item, so the button's gap cannot split it
    for (const b of el.querySelectorAll('.buttons button')) {
      const items = [...b.childNodes].filter(
        (n) => n.nodeType === Node.ELEMENT_NODE || n.textContent?.trim(),
      );
      expect(items).toHaveLength(1);
    }
    expect([...el.querySelectorAll('.buttons button')].map((b) => b.textContent?.trim())).toEqual([
      'Overwrite',
      'Skip',
      'Rename…',
      'Overwrite if newer',
      'Cancel copying',
    ]);
  });

  it('conflict: Alt+letter answers, "apply to all" is passed on', async () => {
    const { el, fixture, id } = await withConflict();
    (el.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
    el.querySelector('[role="alertdialog"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', altKey: true, bubbles: true }),
    );
    expect(api.answers).toEqual([
      { id, conflictId: 3, decision: { type: 'overwrite' }, applyToAll: true },
    ]);
    expect(TestBed.inject(DialogService).open()).toBeNull();
  });

  it('conflict: rename with a typed name', async () => {
    const { el, fixture, id } = await withConflict();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('ename'))!.click();
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('.rename input')!;
    expect(input.value).toBe('x (1).txt');
    input.value = 'neu.txt';
    el.querySelector('.rename')!.dispatchEvent(new Event('submit'));
    expect(api.answers[0]).toEqual({
      id,
      conflictId: 3,
      decision: { type: 'rename', newName: 'neu.txt' },
      applyToAll: false,
    });
  });

  it('conflict: a write-protected entry offers delete anyway / skip / cancel deleting', async () => {
    const id = await store.start({ kind: 'delete', paths: ['/a/ro.txt'], mode: 'permanent' });
    api.emit({
      type: 'conflict',
      id,
      conflict: {
        conflictId: 1,
        kind: 'readOnly',
        source: '/a/ro.txt',
        target: '/a/ro.txt',
        sourceMeta: { size: 1, modifiedMs: 0, isDir: false },
        targetMeta: { size: 1, modifiedMs: 0, isDir: false },
        suggestedName: '',
      },
    });
    api.emit({ type: 'state', id, state: 'waitingForDecision' });
    TestBed.inject(DialogService).show('conflict');
    const fixture = TestBed.createComponent(ConflictDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Write-protected');
    expect([...el.querySelectorAll('.buttons button')].map((b) => b.textContent?.trim())).toEqual([
      'Delete anyway',
      'Skip',
      'Cancel deleting',
    ]);
    el.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'KeyR', bubbles: true }));
    expect(api.answers).toEqual([]); // no "rename" here
    el.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'KeyD', bubbles: true }));
    expect(api.answers[0]).toMatchObject({ id, conflictId: 1, decision: { type: 'overwrite' } });
  });

  it('conflict: closes itself when the job ends elsewhere (no invisible modal)', async () => {
    const { fixture, id } = await withConflict();
    api.emit({ type: 'state', id, state: 'cancelled' });
    fixture.detectChanges();
    TestBed.tick();
    expect(TestBed.inject(DialogService).open()).toBeNull();
  });

  it('conflict: Esc postpones the question, the job keeps waiting', async () => {
    const { el, id } = await withConflict();
    el.querySelector('[role="alertdialog"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(api.answers).toEqual([]);
    expect(store.conflictToShow()).toBeNull();
    expect(store.pendingConflict()?.id).toBe(id);
  });

  it('job list: progress, pause/cancel, errors after the end, clear finished', async () => {
    const id = await store.start(copy);
    api.emit({ type: 'state', id, state: 'running' });
    api.emit({
      type: 'progress',
      id,
      progress: {
        bytesDone: 30,
        bytesTotal: 60,
        itemsDone: 1,
        itemsTotal: 2,
        current: '/a/x.txt',
        rateBps: 0,
      },
    });
    const fixture = TestBed.createComponent(JobListDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    const button = (label: string) =>
      [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
    const pause = button('Pause');
    pause.focus();
    pause.click();
    expect(api.paused).toEqual([id]);
    api.emit({ type: 'state', id, state: 'paused' });
    fixture.detectChanges();
    // the same button now resumes and keeps the focus
    expect(document.activeElement).toBe(pause);
    expect(pause.textContent?.trim()).toBe('Resume');
    expect(pause.getAttribute('aria-pressed')).toBe('true');
    pause.click();
    expect(api.resumed).toEqual([id]);
    button('Cancel').click();
    expect(api.cancelled).toEqual([id]);
    api.emit({
      type: 'finished',
      id,
      state: 'doneWithErrors',
      summary: {
        itemsDone: 1,
        itemsSkipped: 0,
        itemsFailed: 1,
        bytesDone: 60,
        errors: [
          {
            path: '/a/locked',
            error: { code: 'permission_denied', message: 'denied', path: '/a/locked' },
          },
        ],
        error: null,
        dirSize: null,
      },
    });
    fixture.detectChanges();
    expect(el.textContent).toContain('Done with errors');
    expect(el.querySelector('.errors summary')?.textContent).toContain('1 error');
    expect(el.querySelector('.errors li')?.textContent).toContain('/a/locked');
    button('Remove finished').click();
    expect(api.clearCalls).toBe(1);
  });

  it('job list: a finished rename job offers Undo', async () => {
    const id = await store.start({ kind: 'rename', items: [{ path: '/a/x', newName: 'y' }] });
    api.emit({
      type: 'finished',
      id,
      state: 'done',
      summary: {
        itemsDone: 1,
        itemsSkipped: 0,
        itemsFailed: 0,
        bytesDone: 0,
        errors: [],
        error: null,
        dirSize: null,
      },
    });
    const fixture = TestBed.createComponent(JobListDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const undoButton = () =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === 'Undo',
      );
    expect(undoButton()).toBeUndefined();
    api.emit({ type: 'undoAvailable', id, available: true });
    fixture.detectChanges();
    expect(undoButton()?.getAttribute('aria-label')).toBe('Undo: Rename /a/x → y');
    undoButton()!.click();
    await new Promise((r) => setTimeout(r));
    expect(renameApi.undos).toEqual([id]);
  });
});
