import { RenameApi } from '../../core/rename/rename-api';
import { PreviewApi } from '../../core/preview/preview-api';
import { FakePreviewApi } from '../../../testing/fake-preview-api';
import { FakeRenameApi } from '../../../testing/fake-rename-api';
import { FakeFoldersApi } from '../../../testing/fake-folders-api';
import { FoldersApi } from '../../core/folders/folders-api';
import { TestBed } from '@angular/core/testing';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { SessionApi } from '../../core/session/session-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeFsApi, listing } from '../../../testing/fs-fixtures';
import { FilePanel } from './file-panel';
import { keepsWebViewMenu, Workspace } from './workspace';
import { WorkspaceStore } from './workspace.store';
import { Component, input } from '@angular/core';
import { ConfirmService } from '../../shared/dialog/confirm.service';

@Component({ selector: 'app-file-panel', template: '<button class="in-panel">x</button>' })
class FilePanelStub {
  readonly side = input.required<string>();
}

describe('Workspace', () => {
  let jobs: FakeJobsApi;

  async function render() {
    const fs = new FakeFsApi();
    fs.handler = () => Promise.resolve(listing('/h', []));
    jobs = new FakeJobsApi();
    TestBed.configureTestingModule({
      imports: [Workspace],
      providers: [
        { provide: FsApi, useValue: fs },
        { provide: PreviewApi, useValue: new FakePreviewApi() },
        { provide: JobsApi, useValue: jobs },
        { provide: RenameApi, useValue: new FakeRenameApi() },
        { provide: FoldersApi, useValue: new FakeFoldersApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    TestBed.overrideComponent(Workspace, {
      remove: { imports: [FilePanel] },
      add: { imports: [FilePanelStub] },
    });
    const fixture = TestBed.createComponent(Workspace);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('makes the window behind an open dialog inert', async () => {
    const { fixture, el } = await render();
    expect(el.querySelector('app-file-panel')?.hasAttribute('inert')).toBe(false);
    TestBed.inject(DialogService).show('jobs');
    fixture.detectChanges();
    for (const sel of ['app-file-panel', '.splitter', 'app-button-bar']) {
      expect(el.querySelector(sel)?.hasAttribute('inert'), sel).toBe(true);
    }
    expect(el.querySelector('app-job-list-dialog')).not.toBeNull();
  });

  it('puts the focus back into the active list when a dialog closes onto <body>', async () => {
    const { fixture } = await render();
    const ws = TestBed.inject(WorkspaceStore);
    const dialogs = TestBed.inject(DialogService);
    dialogs.show('jobs');
    fixture.detectChanges();
    (document.activeElement as HTMLElement | null)?.blur();
    const before = ws.focusRequest();
    dialogs.close();
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    expect(ws.focusRequest()).not.toBe(before);
    expect(ws.focusRequest()?.side).toBe(ws.activeSide());
  });

  it('opens the conflict question automatically and asks before quitting', async () => {
    const { fixture } = await render();
    const id = 'j1';
    jobs.emit({
      type: 'added',
      job: {
        id,
        spec: { kind: 'copy', sources: ['/a'], targetDir: '/b' },
        state: 'running',
        progress: {
          bytesDone: 0,
          bytesTotal: 0,
          itemsDone: 0,
          itemsTotal: 0,
          current: null,
          rateBps: 0,
        },
        conflict: null,
        summary: null,
        pauseReason: null,
        undoAvailable: false,
      },
    });
    jobs.emit({
      type: 'conflict',
      id,
      conflict: {
        conflictId: 1,
        kind: 'exists',
        source: '/a',
        target: '/b/a',
        sourceMeta: { size: 1, modifiedMs: 0, isDir: false },
        targetMeta: { size: 1, modifiedMs: 0, isDir: false },
        suggestedName: 'a (1)',
      },
    });
    jobs.emit({ type: 'state', id, state: 'waitingForDecision' });
    fixture.detectChanges();
    TestBed.tick();
    expect(TestBed.inject(DialogService).open()).toBe('conflict');

    TestBed.inject(DialogService).close();
    jobs.emit({ type: 'quitRequested', running: 1 });
    TestBed.tick();
    const confirm = TestBed.inject(ConfirmService);
    expect(confirm.request()?.message).toBe('1 task is still running. Cancel it and quit?');
    confirm.answer(true);
    await new Promise((r) => setTimeout(r));
    expect(jobs.quitCalls).toBe(1);
  });
});

describe('keepsWebViewMenu (review 014 #6)', () => {
  it('only for text fields, contenteditable and a selection under the pointer', () => {
    document.body.innerHTML =
      '<input id="i"><div id="ce" contenteditable="plaintext-only"><b id="inner">x</b></div>' +
      '<p id="sel">selected</p><p id="other">elsewhere</p>';
    const el = (id: string) => document.getElementById(id);
    expect(keepsWebViewMenu(el('i'))).toBe(true);
    expect(keepsWebViewMenu(el('inner'))).toBe(true);
    const range = document.createRange();
    range.selectNodeContents(el('sel')!);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(keepsWebViewMenu(el('sel'))).toBe(true);
    // a selection elsewhere does not unlock the WebView menu on a row or button
    expect(keepsWebViewMenu(el('other'))).toBe(false);
    document.getSelection()!.removeAllRanges();
    expect(keepsWebViewMenu(el('sel'))).toBe(false);
    expect(keepsWebViewMenu(null)).toBe(false);
  });
});
