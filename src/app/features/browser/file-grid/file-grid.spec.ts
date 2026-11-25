import { TestBed } from '@angular/core/testing';
import { FsApi } from '../../../core/fs/fs-api';
import { JobsApi } from '../../../core/jobs/jobs-api';
import { SettingsApi } from '../../../core/settings/settings-api';
import { FakeJobsApi } from '../../../../testing/fake-jobs-api';
import { FakeSettingsApi } from '../../../../testing/fake-settings-api';
import { dir, entry, FakeFsApi, listing } from '../../../../testing/fs-fixtures';
import { FileBrowserStore } from '../file-browser.store';
import { stubLayoutApis } from '../../../../testing/layout-stubs';
import { FileGrid } from './file-grid';

/**
 * jsdom has no layout: the grid has one column here and paints nothing. What can be
 * tested is its contract with the list – which index a key asks for, which tile an
 * element belongs to. Layout, scrolling and thumbnails are checked in the browser
 * (`pnpm screenshots --scene view-brief,view-thumbnails`).
 */
describe('FileGrid (design 041 E7)', () => {
  let restore: () => void;
  beforeAll(() => {
    restore = stubLayoutApis(); // the table observes its host; jsdom has no such thing
  });
  afterAll(() => restore());

  const rows = [
    dir('Sub', { path: '/h/Sub' }),
    entry('a.jpg', { path: '/h/a.jpg' }),
    entry('b.jpg', { path: '/h/b.jpg' }),
  ];

  async function setup(mode: 'brief' | 'thumbnails' = 'brief') {
    const fs = new FakeFsApi();
    fs.handler = () => Promise.resolve(listing('/h', rows, '/'));
    TestBed.configureTestingModule({
      imports: [FileGrid],
      providers: [
        FileBrowserStore,
        { provide: FsApi, useValue: fs },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SettingsApi, useValue: new FakeSettingsApi() },
      ],
    });
    const store = TestBed.inject(FileBrowserStore);
    await store.load('/h');
    const fixture = TestBed.createComponent(FileGrid);
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('mode', mode);
    fixture.componentRef.setInput('rowHeight', 30);
    fixture.componentRef.setInput('labelledBy', 'x');
    const moved: number[] = [];
    fixture.componentInstance.cursorMoved.subscribe((i) => moved.push(i));
    fixture.detectChanges();
    await fixture.whenStable();
    const key = (name: string, init: KeyboardEventInit = {}) => {
      const evt = new KeyboardEvent('keydown', {
        key: name,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      (fixture.nativeElement as HTMLElement).dispatchEvent(evt);
      return evt;
    };
    return { fixture, store, moved, key };
  }

  it('follows the cursor of the store and asks for the next index on arrow keys', async () => {
    const { fixture, store, moved, key } = await setup();
    const grid = fixture.componentInstance;
    store.setCursor('/h/a.jpg');
    expect(grid.cursorIndex()).toBe(1);
    expect(key('ArrowDown').defaultPrevented).toBe(true);
    expect(key('End').defaultPrevented).toBe(true);
    key('Home');
    // the grid only asks – the list moves the cursor (here nobody does)
    expect(moved).toEqual([2, 2, 0]);
    // at the end nothing is asked for
    store.setCursor('/h/b.jpg');
    key('ArrowDown');
    expect(moved).toEqual([2, 2, 0]);
  });

  it('leaves keys with modifiers and other keys to the actions', async () => {
    const { moved, key } = await setup();
    for (const init of [
      { shiftKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
    ]) {
      expect(key('ArrowDown', init).defaultPrevented).toBe(false);
    }
    expect(key(' ').defaultPrevented).toBe(false);
    expect(key('Enter').defaultPrevented).toBe(false);
    expect(key('F5').defaultPrevented).toBe(false);
    expect(moved).toEqual([]);
  });

  it('finds the entry of a tile by its index attribute (drag and drop)', async () => {
    const { fixture } = await setup('thumbnails');
    const host = fixture.nativeElement as HTMLElement;
    const tile = document.createElement('div');
    tile.setAttribute('data-fnf-tile', '2');
    const inner = document.createElement('span');
    tile.appendChild(inner);
    host.appendChild(tile);
    expect(fixture.componentInstance.indexAt(inner)).toBe(2);
    tile.setAttribute('data-fnf-tile', '7');
    expect(fixture.componentInstance.indexAt(inner)).toBe(-1); // no such row
    const foreign = document.createElement('div');
    foreign.setAttribute('data-fnf-tile', '0');
    document.body.appendChild(foreign);
    expect(fixture.componentInstance.indexAt(foreign)).toBe(-1); // another list's tile
    foreign.remove();
  });
});
