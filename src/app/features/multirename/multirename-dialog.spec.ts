import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { RenameApi } from '../../core/rename/rename-api';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeRenameApi } from '../../../testing/fake-rename-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeFsApi } from '../../../testing/fs-fixtures';
import { MultiRenameDialog } from './multirename-dialog';
import { MultiRenameStore } from './multirename.store';
import { PreviewRow } from './multirename-logic';
import { PreviewTable } from './preview-table';

/** The GuiExpert Table needs a layout (ResizeObserver) – jsdom has none. */
@Component({ selector: 'app-mr-preview-table', template: '{{ rows().length }} rows' })
class StubPreviewTable {
  readonly rows = input.required<readonly PreviewRow[]>();
  readonly filter = input<string>('all');
}

const flush = () => new Promise((r) => setTimeout(r));

describe('multi-rename dialog', () => {
  let jobsApi: FakeJobsApi;
  let mr: MultiRenameStore;

  beforeEach(async () => {
    jobsApi = new FakeJobsApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: new FakeFsApi() },
        { provide: JobsApi, useValue: jobsApi },
        { provide: RenameApi, useValue: new FakeRenameApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    TestBed.overrideComponent(MultiRenameDialog, {
      remove: { imports: [PreviewTable] },
      add: { imports: [StubPreviewTable] },
    });
    mr = TestBed.inject(MultiRenameStore);
    await TestBed.inject(JobsStore).init();
    const parents: [string, string, string] = ['src', '', ''];
    mr.request.set({
      side: 'left',
      folder: '/src',
      sources: [
        {
          path: '/src/Sebastian Fitzek - Das Joshua-Profil.epub',
          name: 'Sebastian Fitzek - Das Joshua-Profil.epub',
          isDir: false,
          modifiedMs: null,
          parents,
        },
        { path: '/src/b.txt', name: 'b.txt', isDir: false, modifiedMs: null, parents },
      ],
    });
    TestBed.inject(DialogService).show('multi-rename');
  });

  afterEach(() => mr.close());

  async function render() {
    const fixture = TestBed.createComponent(MultiRenameDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('shows an invalid range at the pattern field and blocks renaming', async () => {
    const { fixture, el } = await render();
    const pattern = el.querySelector<HTMLInputElement>('input[data-autofocus]')!;
    type(pattern, '[N5-2]');
    fixture.detectChanges();
    expect(pattern.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#fnf-mr-pattern-error')?.textContent).toContain('range');
    expect(el.querySelector<HTMLButtonElement>('.btn.primary')!.disabled).toBe(true);
  });

  it('inserts a token at the caret', async () => {
    const { el } = await render();
    const pattern = el.querySelector<HTMLInputElement>('input[data-autofocus]')!;
    pattern.setSelectionRange(3, 3);
    const counter = [...el.querySelectorAll<HTMLButtonElement>('.token')].find(
      (b) => b.textContent?.trim() === '[C]',
    )!;
    counter.click();
    expect(mr.rules().pattern).toBe('[N][C].[E]');
  });

  it('a macro fills its row and switches replacing on; Ctrl+Enter renames', async () => {
    const { fixture, el } = await render();
    const select = el.querySelectorAll<HTMLSelectElement>('select.macros')[0];
    select.value = '2'; // first last - title
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(mr.rules().replaceEnabled).toBe(true);
    expect(mr.rules().replacements[0].regex).toBe(true);
    expect(mr.items()![0].newName).toBe('Fitzek, Sebastian - Das Joshua-Profil.epub');
    await mr.checkNow();
    fixture.detectChanges();
    expect(el.querySelector('.summary')?.textContent).toContain(
      '1 to rename · 1 unchanged · 0 errors',
    );
    el.querySelector('.mr')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    await flush();
    expect(jobsApi.started[0].spec.kind).toBe('rename');
  });
});
