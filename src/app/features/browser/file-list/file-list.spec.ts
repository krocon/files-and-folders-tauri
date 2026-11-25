import { TestBed } from '@angular/core/testing';
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
});
