import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FsApi } from '../../../core/fs/fs-api';
import { ImageOverviewApi } from '../../../core/imageoverview/image-overview-api';
import { JobsApi } from '../../../core/jobs/jobs-api';
import { KeymapApi } from '../../../core/actions/keymap-api';
import { SessionApi } from '../../../core/session/session-api';
import { SettingsApi } from '../../../core/settings/settings-api';
import { SettingsStore } from '../../../core/settings/settings.store';
import { FakeImageOverviewApi, overviewItem } from '../../../../testing/fake-image-overview-api';
import { FakeJobsApi } from '../../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../../testing/fake-session-api';
import { FakeSettingsApi } from '../../../../testing/fake-settings-api';
import { dir, entry, FakeFsApi, listing } from '../../../../testing/fs-fixtures';
import { FileBrowserStore } from '../file-browser.store';
import { stubLayoutApis } from '../../../../testing/layout-stubs';
import { DragStore } from '../../dnd/drag.store';
import { FileList } from './file-list';

const wait = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The list with the real GuiExpert Table in jsdom: no layout and nothing painted, but
 * the table's state (order, visibility, widths of the columns) is real – what design 041
 * relies on. Looks and scrolling are checked in the browser (`pnpm screenshots`).
 */
describe('FileList: columns and view modes (design 041)', () => {
  let restore: () => void;
  beforeAll(() => {
    restore = stubLayoutApis();
  });
  afterAll(() => restore());

  const rows = [
    dir('Sub', { path: '/fotos/Sub' }),
    entry('a.jpg', { path: '/fotos/a.jpg', size: 3, createdMs: 5 }),
    entry('b.jpg', { path: '/fotos/b.jpg', size: 1, createdMs: 9 }),
  ];
  let overview: FakeImageOverviewApi;

  async function setup() {
    const fs = new FakeFsApi();
    fs.handler = (p) =>
      Promise.resolve(
        p === '/other'
          ? listing('/other', [entry('x', { path: '/other/x' })], '/')
          : listing('/fotos', rows, '/'),
      );
    overview = new FakeImageOverviewApi();
    TestBed.configureTestingModule({
      imports: [FileList],
      providers: [
        FileBrowserStore,
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SettingsApi, useValue: new FakeSettingsApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: ImageOverviewApi, useValue: overview },
      ],
    });
    const store = TestBed.inject(FileBrowserStore);
    const settings = TestBed.inject(SettingsStore);
    const fixture = TestBed.createComponent(FileList);
    fixture.componentRef.setInput('labelledBy', 'x');
    document.body.appendChild(fixture.nativeElement);
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait();
      fixture.detectChanges();
    };
    await settle();
    await store.load('/fotos');
    await settle();
    const list = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    const columns = () => list.captureTableState()?.columns ?? [];
    const shown = () =>
      columns()
        .filter((c) => c.visible !== false)
        .map((c) => c.property);
    return { fixture, store, settings, list, el, settle, columns, shown };
  }

  afterEach(() => {
    document.body.querySelectorAll('app-file-list, ng-component').forEach((n) => n.remove());
  });

  it('shows the chosen columns in their order – live, and after another folder', async () => {
    const { store, settings, settle, shown, list } = await setup();
    expect(shown()).toEqual(['name', 'ext', 'size', 'modifiedMs']);
    // the acceptance case: "Created" in, "Size" out, another order
    settings.set('view.columns', ['name', 'createdMs', 'modifiedMs', 'ext']);
    await settle();
    expect(shown()).toEqual(['name', 'createdMs', 'modifiedMs', 'ext']);
    await store.load('/other');
    await settle();
    expect(shown()).toEqual(['name', 'createdMs', 'modifiedMs', 'ext']);
    // a tab state from before (its own order and visibility) does not win; its widths do
    store.setPendingTableState({
      columns: [
        { property: 'size', visible: true, width: 222 },
        { property: 'name', visible: true },
        { property: 'ext', visible: true, width: 99 },
      ],
    });
    await store.load('/fotos');
    await settle();
    expect(shown()).toEqual(['name', 'createdMs', 'modifiedMs', 'ext']);
    const by = Object.fromEntries(
      (list.captureTableState()?.columns ?? []).map((c) => [c.property, c]),
    );
    expect(by['ext'].width).toBe(99);
    expect(by['size']).toMatchObject({ visible: false, width: 222 });
    // the measured width of a date column is not stored as the user's
    expect(by['modifiedMs'].width).toBeUndefined();
    expect(by['createdMs'].width).toBeUndefined();
  });

  it('the focus goes into the table, in a tile view into the grid; cursor and marks stay', async () => {
    const { fixture, store, list, el, settle } = await setup();
    list.focus();
    const table = el.querySelector<HTMLElement>('.table');
    expect(table).not.toBeNull();
    expect(document.activeElement).toBe(table);
    store.setCursor('/fotos/b.jpg');
    store.toggleMark('/fotos/a.jpg');
    fixture.componentRef.setInput('viewMode', 'brief');
    await settle();
    await wait(120);
    const grid = el.querySelector<HTMLElement>('app-file-grid');
    expect(grid).not.toBeNull();
    expect(table?.classList.contains('covered')).toBe(true);
    expect(table?.hasAttribute('inert')).toBe(true);
    expect(grid?.contains(document.activeElement)).toBe(true);
    expect(store.cursorPath()).toBe('/fotos/b.jpg');
    expect([...store.marked()]).toEqual(['/fotos/a.jpg']);
    // F2 has no cell to edit in: the caller opens the dialog
    expect(list.listController?.startRename(rows[1], () => undefined)).toBe(false);
    // the grid moves the cursor through the list's controller
    grid?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(store.cursorPath()).toBe('/');
    fixture.componentRef.setInput('viewMode', 'full');
    await settle();
    await wait(120);
    expect(el.querySelector('app-file-grid')).toBeNull();
    expect(table?.classList.contains('covered')).toBe(false);
    expect(document.activeElement).toBe(table);
    expect([...store.marked()]).toEqual(['/fotos/a.jpg']);
  });

  it('thumbnails are asked for only in the thumbnail view of a local folder', async () => {
    const { fixture, store, settle } = await setup();
    expect(overview.opened).toEqual([]);
    fixture.componentRef.setInput('viewMode', 'brief');
    await settle();
    expect(overview.opened).toEqual([]);
    fixture.componentRef.setInput('viewMode', 'thumbnails');
    await settle();
    expect(overview.opened.map((o) => [o.root, o.recursive])).toEqual([['/fotos', false]]);
    overview.deliver([overviewItem(0, 'a.jpg')]);
    // a result tab has no folder Rust could list pictures for
    store.showSearch('s1', [], 'search');
    await settle();
    expect(overview.closed).toEqual(['ov1']);
    expect(overview.opened.length).toBe(1);
    fixture.destroy();
  });

  // ---- the table and our own drag (design 012 E5, 028) ----

  /** A body cell as the table renders it (jsdom paints none): the press finds its row. */
  function fakeCell(el: HTMLElement, rowIndex: number): { table: HTMLElement; cell: HTMLElement } {
    const table = el.querySelector<HTMLElement>('.table')!;
    const cell = document.createElement('div');
    cell.setAttribute('data-area', 'body');
    cell.setAttribute('data-row-index', String(rowIndex));
    table.appendChild(cell);
    return { table, cell };
  }

  const pointer = (type: string, x: number, y: number, buttons = 1) =>
    new MouseEvent(type, { bubbles: true, button: 0, buttons, clientX: x, clientY: y });

  it('a pressed row belongs to our drag: the table sees no mouse moves until the release', async () => {
    const { fixture, el, settle } = await setup();
    fixture.componentRef.setInput('side', 'left');
    await settle();
    const { table, cell } = fakeCell(el, 2); // '..', Sub, a.jpg
    const moves: Event[] = [];
    table.addEventListener('mousemove', (e) => moves.push(e));
    cell.dispatchEvent(pointer('mousemove', 9, 9, 0));
    expect(moves.length).toBe(1); // hover, no button: the table's business
    cell.dispatchEvent(pointer('pointerdown', 10, 10));
    // a little jitter between press and release: with a stale column action of a header
    // click the table (1.1.105) moved that column to the one under the pointer
    cell.dispatchEvent(pointer('mousemove', 11, 10));
    cell.dispatchEvent(pointer('mousemove', 40, 10));
    expect(moves.length).toBe(1);
    window.dispatchEvent(pointer('pointerup', 40, 10, 0));
    cell.dispatchEvent(pointer('mousemove', 41, 10, 0));
    expect(moves.length).toBe(2);
    fixture.destroy();
  });

  it('dragged out of the window, the table gets the mouseup the system keeps', async () => {
    const { fixture, el, settle } = await setup();
    fixture.componentRef.setInput('side', 'left');
    await settle();
    const dnd = TestBed.inject(DragStore);
    const handOff = vi.spyOn(dnd, 'handOff').mockResolvedValue();
    const { table, cell } = fakeCell(el, 2); // '..', Sub, a.jpg
    const ups: MouseEvent[] = [];
    table.addEventListener('mouseup', (e) => ups.push(e as MouseEvent));
    cell.dispatchEvent(pointer('pointerdown', 10, 10));
    window.dispatchEvent(pointer('pointermove', 60, 10));
    expect(dnd.drag()?.sources.map((s) => s.path)).toEqual(['/fotos/a.jpg']);
    expect(ups).toEqual([]);
    window.dispatchEvent(pointer('pointermove', window.innerWidth + 20, 10));
    expect(handOff).toHaveBeenCalledTimes(1);
    expect(ups.map((e) => [e.button, e.clientX])).toEqual([[0, window.innerWidth + 20]]);
    // the press is over: moves reach the table again (hover)
    const moves: Event[] = [];
    table.addEventListener('mousemove', (e) => moves.push(e));
    cell.dispatchEvent(pointer('mousemove', 30, 10, 0));
    expect(moves.length).toBe(1);
    fixture.destroy();
  });

  it('a cancelled pointer (the system took it) ends the press of the table too', async () => {
    const { fixture, el, settle } = await setup();
    fixture.componentRef.setInput('side', 'left');
    await settle();
    const { table, cell } = fakeCell(el, 2); // '..', Sub, a.jpg
    const ups: Event[] = [];
    table.addEventListener('mouseup', (e) => ups.push(e));
    cell.dispatchEvent(pointer('pointerdown', 10, 10));
    window.dispatchEvent(pointer('pointermove', 60, 10));
    window.dispatchEvent(pointer('pointercancel', 60, 10, 0));
    expect(ups.length).toBe(1);
    expect(TestBed.inject(DragStore).drag()).toBeNull();
    fixture.destroy();
  });
});
