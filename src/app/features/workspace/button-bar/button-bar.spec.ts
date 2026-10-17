import { JobsApi } from '../../../core/jobs/jobs-api';
import { JobsStore } from '../../../core/jobs/jobs.store';
import { FakeJobsApi } from '../../../../testing/fake-jobs-api';
import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../../core/actions/action.service';
import { KeymapApi } from '../../../core/actions/keymap-api';
import { KeyboardDispatcher } from '../../../core/actions/keyboard-dispatcher';
import { NO_MODIFIERS } from '../../../core/actions/shortcut';
import { FakeKeymapApi } from '../../../../testing/fake-keymap-api';
import { ButtonBar } from './button-bar';

describe('ButtonBar', () => {
  let jobsApi: FakeJobsApi;
  beforeEach(() => (jobsApi = new FakeJobsApi()));

  async function render() {
    TestBed.configureTestingModule({
      imports: [ButtonBar],
      providers: [
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: JobsApi, useValue: jobsApi },
      ],
    });
    const actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    const fixture = TestBed.createComponent(ButtonBar);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const labels = () =>
      [...el.querySelectorAll('.functions .fbtn')].map((b) =>
        [...b.children].map((c) => c.textContent?.trim()).join(' '),
      );
    return { fixture, el, labels, actions, keys: TestBed.inject(KeyboardDispatcher) };
  }

  it('shows the default set with shortcut badges, dimmed while the action is missing', async () => {
    const { el, labels } = await render();
    expect(labels()).toEqual(['F4 Edit', 'F5 Copy', 'F6 Move', 'F7 Create folder', 'F8 Delete']);
    const copy = el.querySelectorAll<HTMLButtonElement>('.functions .fbtn')[1];
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    expect(copy.title).toBe('Copy – Coming in prompt 006');
  });

  it('switches the set while Shift is held and shows the badge without Shift', async () => {
    const { fixture, labels, keys } = await render();
    keys.held.set({ ...NO_MODIFIERS, shift: true });
    fixture.detectChanges();
    expect(labels()).toEqual(['F4 Create file', 'Copy', 'F6 Rename', 'F7 Create folder', 'Delete']);
  });

  it('enables and runs a registered action', async () => {
    const { fixture, el, actions } = await render();
    let copies = 0;
    actions.register({ OPEN_COPY_DLG: { run: () => void copies++ } });
    fixture.detectChanges();
    const copy = el.querySelectorAll<HTMLButtonElement>('.functions .fbtn')[1];
    expect(copy.getAttribute('aria-disabled')).toBeNull();
    copy.click();
    await Promise.resolve();
    expect(copies).toBe(1);
  });

  it('opens the Actions menu with four columns', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('.actions-toggle')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[role="menu"] [role="group"]')).toHaveLength(4);
    expect(el.querySelector('.actions-toggle')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows "finished / total" and a progress bar on the Tasks button while jobs run', async () => {
    const { fixture, el } = await render();
    const jobs = TestBed.inject(JobsStore);
    await jobs.init();
    const spec = { kind: 'copy' as const, sources: ['/a'], targetDir: '/b' };
    const tasks = () => el.querySelector<HTMLButtonElement>('[aria-label^="Tasks"]')!;
    expect(tasks().getAttribute('aria-label')).toBe('Tasks');
    await jobs.start(spec);
    await jobs.start(spec);
    jobsApi.emit({
      type: 'progress',
      id: 'j1',
      progress: {
        bytesDone: 50,
        bytesTotal: 100,
        itemsDone: 1,
        itemsTotal: 2,
        current: null,
        rateBps: 0,
      },
    });
    fixture.detectChanges();
    expect(tasks().getAttribute('aria-label')).toBe('Tasks 0 / 2');
    expect((el.querySelector('.task-bar span') as HTMLElement).style.width).toBe('50%');
    jobsApi.emit({ type: 'state', id: 'j2', state: 'waitingForDecision' });
    fixture.detectChanges();
    expect(tasks().classList).toContain('attention');
  });
});
