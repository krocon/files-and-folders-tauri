import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { dir, entry, FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FileBrowserStore } from '../browser/file-browser.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerJobActions } from './job-actions';

describe('job actions (tasks)', () => {
  let jobsApi: FakeJobsApi;
  let actions: ActionService;
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
    const jobs = TestBed.inject(JobsStore);
    await jobs.init();
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    await left.load('/src');
    await right.load('/dst');
    ws.registerPanel('left', { store: left, controller: () => undefined });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerJobActions(actions, TestBed.inject(DialogService));
  });

  it('opens the task list', async () => {
    await actions.run('OPEN_TASK_DLG');
    expect(TestBed.inject(DialogService).open()).toBe('jobs');
  });
});
