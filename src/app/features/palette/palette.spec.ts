import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { PaletteApi } from '../../core/palette/palette-api';
import { PreviewApi } from '../../core/preview/preview-api';
import { SessionApi } from '../../core/session/session-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { ThemeApi } from '../../core/theme/theme-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakePaletteApi, paletteHit } from '../../../testing/fake-palette-api';
import { FakePreviewApi } from '../../../testing/fake-preview-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { FakeFsApi } from '../../../testing/fs-fixtures';
import { CommandPalette } from '../actions/command-palette';
import { DiskUsageStore } from '../diskusage/disk-usage.store';
import { OpsStore } from '../ops/ops.store';
import { SearchStore } from '../search/search.store';
import { newTab, WorkspaceStore } from '../workspace/workspace.store';
import { registerPaletteActions } from './palette-actions';
import { PaletteStore } from './palette.store';

describe('universal palette (design 043)', () => {
  async function render() {
    const api = new FakePaletteApi();
    const preview = new FakePreviewApi();
    TestBed.configureTestingModule({
      imports: [CommandPalette],
      providers: [
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: ThemeApi, useValue: new FakeThemeApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: PaletteApi, useValue: api },
        { provide: PreviewApi, useValue: preview },
        { provide: FsApi, useValue: new FakeFsApi() },
        { provide: JobsApi, useValue: new FakeJobsApi() },
      ],
    });
    const actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    const store = TestBed.inject(PaletteStore);
    store.debounceMs = 0;
    const dialogs = TestBed.inject(DialogService);
    registerPaletteActions(actions, store, dialogs);
    const ws = TestBed.inject(WorkspaceStore);
    ws.restore({
      ...ws.snapshot(),
      activeSide: 'left',
      panels: {
        left: { activeTab: 0, tabs: [newTab('/home/u/Docs', 'Docs')] },
        right: { activeTab: 0, tabs: [newTab('/home/u/Backup', 'Backup')] },
      },
      favorites: ['/home/u/Projects'],
      recent: ['/home/u/Downloads'],
    });
    dialogs.show('palette');
    const fixture = TestBed.createComponent(CommandPalette);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input')!;
    const type = (text: string) => {
      input.value = text;
      input.setSelectionRange(text.length, text.length);
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const key = (k: string, init: KeyboardEventInit = {}) => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
      fixture.detectChanges();
    };
    const refresh = () => fixture.detectChanges();
    const options = () => [...el.querySelectorAll<HTMLElement>('.list [role="option"]')];
    return { api, preview, el, input, type, key, refresh, options, store, ws, dialogs, fixture };
  }

  const invoice = paletteHit('/home/u/Docs/2025', 'Invoice-0815.pdf', {
    score: 200,
    ranges: [[0, 7]],
  });
  const download = paletteHit('/home/u/Downloads', 'invoice_2025_03.pdf', {
    score: 300,
    ranges: [
      [0, 7],
      [8, 12],
    ],
  });

  it('sends each query with the known places and shows the hits as files', async () => {
    const { api, type, refresh, options, el } = await render();
    type('invoice 2025');
    const q = api.last().request;
    expect(q.text).toBe('invoice 2025');
    expect(q.places).toEqual(['/home/u/Docs', '/home/u/Backup', '/home/u/Projects']);
    expect(q.recent).toEqual(['/home/u/Downloads']);
    api.answer([invoice, download]);
    refresh();
    // best first, the words highlighted, the folder beside the name
    expect(el.querySelector('.head')?.textContent).toContain('Files');
    const names = options().map((o) => o.querySelector('.name')?.textContent?.trim());
    expect(names).toEqual(['invoice_2025_03.pdf', 'Invoice-0815.pdf']);
    expect([...options()[0].querySelectorAll('.hit')].map((h) => h.textContent)).toEqual([
      'invoice',
      '2025',
    ]);
    expect(options()[0].getAttribute('title')).toBe('/home/u/Downloads/invoice_2025_03.pdf');
    expect(el.querySelector('[aria-live]')?.textContent).toContain('2 hits');
  });

  it('drops the answers of an older query and keeps the old hits until new ones come', async () => {
    const { api, type, refresh, options } = await render();
    type('invoice');
    const first = api.last();
    api.answer([invoice]);
    refresh();
    type('invoice 2025');
    // the old list stays while the new query has not answered (no jumping)
    expect(options()).toHaveLength(1);
    first.emit({ type: 'hits', id: first.id, hits: [paletteHit('/x', 'stale.pdf')] });
    api.answer([download]);
    refresh();
    expect(options().map((o) => o.querySelector('.name')?.textContent?.trim())).toEqual([
      'invoice_2025_03.pdf',
    ]);
  });

  it('> lists only actions and asks Rust nothing', async () => {
    const { api, type, options, el } = await render();
    type('> copy');
    expect(api.queries).toHaveLength(0);
    expect(el.querySelector('.head')).toBeNull();
    expect(options()[0].textContent).toContain('Copy');
  });

  it('virtualises the list: only the rows in view are in the DOM', async () => {
    const { api, type, refresh, options, el } = await render();
    type('file');
    api.answer(
      Array.from({ length: 300 }, (_, i) => paletteHit('/d', `file ${i}.txt`, { score: 1000 - i })),
    );
    refresh();
    expect(options().length).toBeLessThan(40);
    const spacer = el.querySelector<HTMLElement>('.spacer')!;
    expect(parseInt(spacer.style.height, 10)).toBeGreaterThanOrEqual(300 * 30);
  });

  it('F5 opens the copy dialog with the hit and the other side as target', async () => {
    const { api, type, refresh, key, dialogs } = await render();
    type('invoice');
    api.answer([invoice]);
    refresh();
    key('F5');
    await Promise.resolve();
    await new Promise((r) => setTimeout(r));
    const ops = TestBed.inject(OpsStore);
    expect(dialogs.open()).toBe('copy-move');
    expect(ops.copyMove()).toMatchObject({
      kind: 'copy',
      side: 'left',
      sourceDir: '/home/u/Docs/2025',
      target: '/home/u/Backup',
    });
    expect(ops.copyMove()?.sources.map((s) => s.path)).toEqual([invoice.path]);
    expect('score' in ops.copyMove()!.sources[0]).toBe(false);
  });

  it('Tab shows the hit actions; Escape closes them, not the palette', async () => {
    const { api, type, refresh, key, el, dialogs, input } = await render();
    type('invoice');
    api.answer([invoice]);
    refresh();
    key('Tab');
    const sub = el.querySelector('.sub')!;
    expect(sub.getAttribute('aria-label')).toBe('Actions for Invoice-0815.pdf');
    const labels = [...sub.querySelectorAll('[role="option"]')].map(
      (o) => o.querySelector('.label')?.textContent,
    );
    expect(labels).toContain('Go to location of hit');
    expect(labels).toContain('Analyse parent folder');
    expect(input.getAttribute('aria-activedescendant')).toBe('fnf-palette-sub-0');
    // the copy entry shows the key of the panel action
    const copy = [...sub.querySelectorAll('[role="option"]')].find((o) =>
      o.textContent?.includes('Copy hit'),
    )!;
    expect(copy.querySelector('kbd')?.textContent).toBe('F5');
    key('Escape');
    expect(el.querySelector('.sub')).toBeNull();
    expect(dialogs.open()).toBe('palette');
  });

  it('"Go to location" shows the folder with the cursor on the hit', async () => {
    const { api, type, refresh, key, ws, dialogs } = await render();
    type('invoice');
    api.answer([invoice]);
    refresh();
    key('Tab');
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    await new Promise((r) => setTimeout(r));
    expect(dialogs.open()).toBeNull();
    expect(ws.navigateRequest()).toMatchObject({
      side: 'left',
      path: '/home/u/Docs/2025',
      cursor: invoice.path,
    });
  });

  it('Enter on a folder hit opens it in the active panel', async () => {
    const { api, type, refresh, key, ws, el } = await render();
    ws.setActive('right');
    type('2025');
    api.answer([paletteHit('/home/u/Docs', '2025', { kind: 'directory' })]);
    refresh();
    expect(el.querySelector('.head')?.textContent).toContain('Folders');
    key('Enter');
    await new Promise((r) => setTimeout(r));
    expect(ws.navigateRequest()).toMatchObject({ side: 'right', path: '/home/u/Docs/2025' });
  });

  it('"Analyse parent folder" scans the folder of the hit', async () => {
    const { api, type, refresh } = await render();
    const usage = TestBed.inject(DiskUsageStore);
    const start = vi.spyOn(usage, 'start').mockResolvedValue(null);
    type('invoice');
    api.answer([invoice]);
    refresh();
    await TestBed.inject(PaletteStore).runAction('analyzeParent');
    expect(start).toHaveBeenCalledWith('left', ['/home/u/Docs/2025'], '2025');
  });

  it('Insert marks hits; a copy takes all marked ones (from several folders)', async () => {
    const { api, type, refresh, key, store, el } = await render();
    type('invoice');
    api.answer([invoice, download]);
    refresh();
    key('Insert');
    key('ArrowDown');
    key('Insert');
    refresh();
    expect(store.marked().size).toBe(2);
    expect(el.querySelectorAll('.option.marked')).toHaveLength(2);
    expect(el.querySelector('.foot')?.textContent).toContain('2 marked');
    key('F5');
    await new Promise((r) => setTimeout(r));
    const req = TestBed.inject(OpsStore).copyMove()!;
    expect(req.sourceDir).toBe('');
    expect(req.sources).toHaveLength(2);
  });

  it('F3 shows the preview of the active hit beside the list', async () => {
    const { api, type, refresh, key, el, preview } = await render();
    type('invoice');
    api.answer([invoice]);
    refresh();
    key('F3');
    await new Promise((r) => setTimeout(r));
    refresh();
    expect(preview.reads.at(-1)?.path).toBe(invoice.path);
    expect(el.querySelector('.preview')?.textContent).toContain(`content of ${invoice.path}`);
  });

  it('all hits become a result tab; "search again" asks Rust again', async () => {
    const { api, type, refresh, ws } = await render();
    type('invoice');
    api.answer([invoice, download]);
    refresh();
    await TestBed.inject(PaletteStore).runAction('resultsTab');
    const tab = ws.activeTab('left');
    expect(tab.search?.label).toBe('Palette: invoice');
    const search = TestBed.inject(SearchStore);
    expect(search.result(tab.search!.key)?.hits).toHaveLength(2);
    const rerun = search.rerun(tab.search!.key);
    expect(api.last().request.limit).toBe(2000);
    api.answer([download]);
    await rerun;
    expect(search.result(tab.search!.key)?.hits.map((h) => h.name)).toEqual([
      'invoice_2025_03.pdf',
    ]);
  });

  it('sends the settings to Rust and the palette shows the index state', async () => {
    const { api, el, refresh } = await render();
    await new Promise((r) => setTimeout(r));
    refresh();
    expect(api.configs[0]).toEqual({
      index: true,
      roots: [],
      excludes: ['node_modules', '.git'],
      maxMemoryMb: 256,
      includeHidden: false,
      systemSearch: false,
    });
    expect(el.querySelector('.foot')?.textContent).toContain('Index: 42 entries');
    TestBed.inject(PaletteStore).configureDelayMs = 0;
    TestBed.inject(SettingsStore).set('palette.index', false);
    TestBed.tick();
    await new Promise((r) => setTimeout(r));
    expect(api.configs.at(-1)?.index).toBe(false);
  });

  it('closing cancels the running query by its id (a late cancel never stops a newer one)', async () => {
    const { api, type, fixture } = await render();
    type('invoice');
    const id = api.last().id;
    fixture.destroy();
    await new Promise((r) => setTimeout(r));
    expect(api.cancelled).toEqual([id]);
  });

  it('the hit actions keep the list: after Esc it is the same element, scrolled as before', async () => {
    const { api, type, refresh, key, el } = await render();
    type('file');
    api.answer(
      Array.from({ length: 100 }, (_, i) => paletteHit('/d', `file ${i}.txt`, { score: 1000 - i })),
    );
    refresh();
    const list = el.querySelector<HTMLElement>('.list')!;
    for (let i = 0; i < 40; i++) {
      key('ArrowDown');
    }
    const top = list.scrollTop;
    expect(top).toBeGreaterThan(0);
    key('Tab');
    expect(list.hidden).toBe(true);
    key('Escape');
    expect(el.querySelector('.list')).toBe(list);
    expect(list.hidden).toBe(false);
    expect(list.scrollTop).toBe(top);
    // the active option is rendered and is the one marked active
    const active = el
      .querySelector<HTMLInputElement>('input')!
      .getAttribute('aria-activedescendant')!;
    expect(el.querySelector(`#${active}`)?.classList.contains('active')).toBe(true);
  });

  it('"search again" of a result tab runs detached from the palette', async () => {
    const { api, type, refresh } = await render();
    type('invoice');
    api.answer([invoice]);
    refresh();
    await TestBed.inject(PaletteStore).runAction('resultsTab');
    const ws = TestBed.inject(WorkspaceStore);
    void TestBed.inject(SearchStore).rerun(ws.activeTab('left').search!.key);
    expect(api.last().request.detached).toBe(true);
  });

  it('"Find similar files" searches the folder of the hit too when it lies outside the search folders', async () => {
    const { api, type, refresh } = await render();
    const search = TestBed.inject(SearchStore);
    const find = vi.spyOn(search, 'findDuplicates').mockResolvedValue(null);
    await new Promise((r) => setTimeout(r));
    type('report');
    api.answer([paletteHit('/mnt/data', 'report.pdf')]);
    refresh();
    await TestBed.inject(PaletteStore).runAction('similar');
    expect(find.mock.calls[0][0]).toMatchObject({
      roots: ['/home/u', '/mnt/data'],
      reference: '/mnt/data/report.pdf',
      mode: 'exact',
    });
  });
});
