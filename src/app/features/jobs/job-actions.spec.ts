import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { SessionApi } from '../../core/session/session-api';
import { ConfirmService } from '../../shared/dialog/confirm.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerJobActions } from './job-actions';

describe('job actions (F5, tasks)', () => {
  let jobsApi: FakeJobsApi;
  let actions: ActionService;
  let confirm: ConfirmService;
  let left: FileBrowserStore;
  let right: FileBrowserStore;
  let ws: WorkspaceStore;

  beforeEach(async () => {
    const fs = new FakeFsApi();
    fs.handler = (p) =>
      Promise.resolve(
        p === '/src'
          ? listing('/src', [
              dir('Ordner', { path: '/src/Ordner' }),
              entry('a.txt', { path: '/src/a.txt' }),
            ])
          : listing('/dst', []),
      );
    jobsApi = new FakeJobsApi();
    const providers = [
      { provide: FsApi, useValue: fs },
      { provide: JobsApi, useValue: jobsApi },
      { provide: SessionApi, useValue: new FakeSessionApi() },
      { provide: KeymapApi, useValue: new FakeKeymapApi() },
    ];
    TestBed.configureTestingModule({ providers });
    actions = TestBed.inject(ActionService);
    ws = TestBed.inject(WorkspaceStore);
    confirm = TestBed.inject(ConfirmService);
    const jobs = TestBed.inject(JobsStore);
    await jobs.init();
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    await left.load('/src');
    await right.load('/dst');
    ws.registerPanel('left', { store: left, controller: () => undefined });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerJobActions(actions, ws, jobs, TestBed.inject(DialogService), confirm);
  });

  it('copies the marked entries into the other panel after confirming, then unmarks them', async () => {
    left.setMarked(['/src/Ordner', '/src/a.txt'], true);
    const run = actions.run('OPEN_COPY_DLG');
    await Promise.resolve();
    expect(confirm.request()?.message).toBe('Copy 2 entries to');
    expect(confirm.request()?.detail).toBe('/dst');
    confirm.answer(true);
    await run;
    expect(jobsApi.started[0].spec).toEqual({
      kind: 'copy',
      sources: ['/src/Ordner', '/src/a.txt'],
      targetDir: '/dst',
    });
    jobsApi.emit({
      type: 'finished',
      id: jobsApi.started[0].id,
      state: 'done',
      summary: {
        itemsDone: 2,
        itemsSkipped: 0,
        itemsFailed: 0,
        bytesDone: 0,
        errors: [],
        error: null,
        dirSize: null,
      },
    });
    await Promise.resolve();
    expect(left.marked().size).toBe(0);
  });

  it('uses the cursor entry if nothing is marked; cancelling the question starts nothing', async () => {
    left.setCursor('/src/a.txt');
    const run = actions.run('OPEN_COPY_DLG');
    await Promise.resolve();
    expect(confirm.request()?.message).toBe('Copy 1 entry to');
    confirm.answer(false);
    await run;
    expect(jobsApi.started).toEqual([]);
  });

  it('is disabled without anything to copy and reports a refused job', async () => {
    expect(actions.state('OPEN_COPY_DLG')).toBe('disabled');
    left.setCursor('/src/a.txt');
    jobsApi.refuse = {
      code: 'same_source_target',
      message: 'Source and target folder are the same',
      path: '/src/a.txt',
    };
    const run = actions.run('OPEN_COPY_DLG');
    await Promise.resolve();
    confirm.answer(true);
    await run;
    expect(actions.messages().at(-1)).toContain('Source and target folder are the same');
  });

  it('opens the task list', async () => {
    await actions.run('OPEN_TASK_DLG');
    expect(TestBed.inject(DialogService).open()).toBe('jobs');
  });
});
