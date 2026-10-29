import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FoldersApi } from '../../core/folders/folders-api';
import { TreeFile } from '../../core/folders/folders.models';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobsStore } from '../../core/jobs/jobs.store';
import { RenameApi } from '../../core/rename/rename-api';
import { SessionApi } from '../../core/session/session-api';
import { PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { EMPTY_TREE, FakeFoldersApi } from '../../../testing/fake-folders-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeRenameApi } from '../../../testing/fake-rename-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeFsApi } from '../../../testing/fs-fixtures';
import { SeriesGroupDialog } from './series-dialog';
import { SeriesGroupStore } from './series.store';

/** The GuiExpert Table needs a layout (ResizeObserver) – jsdom has none. */
@Component({ selector: 'app-preview-grid', template: '{{ rows().length }} rows' })
class StubGrid {
  readonly rows = input.required<readonly unknown[]>();
  readonly columns = input<unknown>();
  readonly rowClass = input<unknown>();
  readonly labelledBy = input<string | null>(null);
}

const flush = () => new Promise((r) => setTimeout(r));

function buttons(el: HTMLElement): Record<string, HTMLButtonElement> {
  const out: Record<string, HTMLButtonElement> = {};
  el.querySelectorAll('button').forEach((b) => (out[b.textContent!.trim()] = b));
  return out;
}

function file(rel: string): TreeFile {
  const parts = rel.split('/');
  const name = parts.pop()!;
  return {
    path: `/src/${rel}`,
    name,
    size: 1,
    modifiedMs: 0,
    dirs: parts,
    top: parts.length > 0 ? `/src/${parts[0]}` : null,
    rel,
  };
}

describe('series dialog (design 045 E6)', () => {
  let jobsApi: FakeJobsApi;

  beforeEach(async () => {
    jobsApi = new FakeJobsApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: new FakeFsApi() },
        { provide: JobsApi, useValue: jobsApi },
        { provide: RenameApi, useValue: new FakeRenameApi() },
        { provide: FoldersApi, useValue: new FakeFoldersApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    TestBed.overrideComponent(SeriesGroupDialog, {
      remove: { imports: [PreviewGrid] },
      add: { imports: [StubGrid] },
    });
    await TestBed.inject(JobsStore).init();
  });

  it('scanning blocks the buttons; heading, hints and Ctrl+Enter copies', async () => {
    const sg = TestBed.inject(SeriesGroupStore);
    sg.request.set({ side: 'left', sourceDir: '/src', otherDir: null });
    const f = TestBed.createComponent(SeriesGroupDialog);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Collecting files');
    expect(buttons(el)['Copy'].disabled).toBe(true);
    sg.tree.set({
      ...EMPTY_TREE,
      truncated: true,
      files: ['A.S01E01/a.s01e01.mkv', 'A.S01E01/a.nfo', 'a.s01e03.mkv', 'b.s02e01.mkv'].map(file),
    });
    f.detectChanges();
    expect(el.textContent).toContain('Group series by season – 3 episodes in 2 seasons');
    expect(el.textContent).toContain('4 rows');
    expect(el.textContent).toContain('S01: 2 · S02: 1 — 3 to group, 1 ignored, 0 other');
    expect(el.textContent).toContain('Missing episodes: S01: 2');
    expect(el.textContent).toContain('Several series in this folder: a, b');
    expect(el.textContent).toContain('Not everything was read');
    const other = el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[0];
    expect(other.disabled && !other.checked).toBe(true); // no other panel
    expect(buttons(el)['Move'].disabled).toBe(false);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await flush();
    expect(jobsApi.started[0].spec).toMatchObject({
      kind: 'group',
      transfer: 'copy',
      root: '/src',
    });
  });

  it('an own template shows its field and an invalid one blocks', () => {
    const sg = TestBed.inject(SeriesGroupStore);
    sg.update({ template: 'Teil {n}' });
    sg.request.set({ side: 'left', sourceDir: '/src', otherDir: '/dst' });
    sg.tree.set({ ...EMPTY_TREE, files: [file('a.s01e01.mkv')] });
    const f = TestBed.createComponent(SeriesGroupDialog);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const field = [...el.querySelectorAll<HTMLInputElement>('input[type=text]')].find(
      (i) => i.value === 'Teil {n}',
    );
    expect(field).toBeTruthy();
    field!.value = 'Teil';
    field!.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(el.textContent).toContain('The template needs {n} or {nn}.');
    expect(buttons(el)['Copy'].disabled).toBe(true);
  });
});
