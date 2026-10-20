import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { ConfigApi } from '../../core/config/config-api';
import {
  BUILT_IN_FILE_TYPES,
  FILE_TYPES,
  iconColorGroupForEntry,
  iconNameForEntry,
} from '../../core/file-icon/file-icon.service';
import { indexFileTypes } from '../../core/file-icon/file-types-logic';
import { FakeConfigApi } from '../../../testing/fake-config-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { entry } from '../../../testing/fs-fixtures';
import { BUTTON_SETS } from '../workspace/button-bar/button-config';
import { ButtonConfigStore } from './button-config.store';
import { FileTypesStore } from './file-types.store';

describe('configuration stores (design 022)', () => {
  let api: FakeConfigApi;

  beforeEach(() => {
    api = new FakeConfigApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: ConfigApi, useValue: api },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
  });

  afterEach(() => FILE_TYPES.set(indexFileTypes(BUILT_IN_FILE_TYPES)));

  it('buttons: loads the override, reports unknown ids and load problems', async () => {
    api.buttons = {
      value: { sets: { shift: ['OPEN_VIEW_DLG', 'GONE_ACTION'] } },
      warning: { code: 'broken', path: '/cfg/buttons.json.bad' },
    };
    const store = TestBed.inject(ButtonConfigStore);
    await store.init();
    expect(store.sets().shift).toEqual(['OPEN_VIEW_DLG']);
    expect(store.sets().default).toEqual(BUTTON_SETS.default);
    expect(store.unknown()).toEqual(['GONE_ACTION']);
    expect(store.changedCount()).toBe(1);
    const messages = TestBed.inject(ActionService).messages();
    expect(messages.some((m) => m.includes('buttons.json.bad'))).toBe(true);
    expect(messages.some((m) => m.includes('GONE_ACTION'))).toBe(true);
  });

  it('buttons: saving writes only changed sets and the bar follows at once', async () => {
    const store = TestBed.inject(ButtonConfigStore);
    await store.init();
    await store.save({ ...store.sets(), alt: ['OPEN_VIEW_DLG'] });
    expect(api.savedButtons).toEqual([{ alt: ['OPEN_VIEW_DLG'] }]);
    expect(store.sets().alt).toEqual(['OPEN_VIEW_DLG']);
    await store.save(BUTTON_SETS);
    expect(api.savedButtons.at(-1)).toEqual({});
    expect(store.changedCount()).toBe(0);
  });

  it('buttons: a failed save keeps the old sets', async () => {
    const store = TestBed.inject(ButtonConfigStore);
    api.failSave = true;
    await expect(store.save({ ...BUTTON_SETS, alt: [] })).rejects.toBeTruthy();
    expect(store.sets().alt).toEqual(BUTTON_SETS.alt);
  });

  it('file types: the user list drives icons and colours; reset removes the file', async () => {
    api.fileTypes = {
      value: [
        { label: 'Comics', extensions: ['.cbz'], icon: 'fa-book', color: 'archive' },
        { label: 'Bad icon', extensions: ['.xyz'], icon: 'fa-nope', color: null },
      ],
      warning: null,
    };
    const store = TestBed.inject(FileTypesStore);
    await store.init();
    expect(store.categories().map((c) => c.label)).toEqual(['Comics', 'Bad icon']);
    expect(iconNameForEntry(entry('Heft 1.CBZ'))).toBe('fa-book');
    expect(iconColorGroupForEntry(entry('Heft 1.cbz'))).toBe('archive');
    expect(iconNameForEntry(entry('a.xyz'))).toBe('fa-file-o');
    // .mp4 is no longer a category: plain file icon, no colour
    expect(iconNameForEntry(entry('film.mp4'))).toBe('fa-file-o');
    expect(iconColorGroupForEntry(entry('film.mp4'))).toBeNull();
    // fine document icons only refine the generic document icon (E6)
    expect(iconNameForEntry(entry('brief.pdf'))).toBe('fa-file-pdf-o');
    await store.save(null);
    expect(api.savedFileTypes).toEqual([null]);
    expect(store.user()).toBeNull();
    expect(iconNameForEntry(entry('film.mp4'))).toBe('fa-file-video-o');
  });

  it('file types: an mr file without icons keeps the look of built-in names', async () => {
    api.fileTypes = {
      value: [
        { label: 'Movies', extensions: ['.avi'], icon: null, color: null },
        { label: 'Hefte', extensions: ['.cbz'], icon: null, color: null },
      ],
      warning: null,
    };
    const store = TestBed.inject(FileTypesStore);
    await store.init();
    expect(store.categories()[0]).toEqual({
      label: 'Movies',
      extensions: ['.avi'],
      icon: 'fa-file-video-o',
      color: 'video',
    });
    expect(store.categories()[1].icon).toBeNull();
    expect(iconNameForEntry(entry('a.avi'))).toBe('fa-file-video-o');
  });

  it('file types: saving the built-in list removes the user file; a load problem is reported', async () => {
    api.fileTypes = { value: null, warning: { code: 'unreadable', path: '/cfg/filetypes.json' } };
    const store = TestBed.inject(FileTypesStore);
    await store.init();
    expect(store.categories()).toBe(BUILT_IN_FILE_TYPES);
    expect(
      TestBed.inject(ActionService)
        .messages()
        .some((m) => m.includes('filetypes.json could not be read')),
    ).toBe(true);
    await store.save(BUILT_IN_FILE_TYPES.map((t) => ({ ...t })));
    expect(api.savedFileTypes).toEqual([null]);
    const own = [{ label: 'Comics', extensions: ['.cbz'], icon: 'fa-book', color: null }];
    await store.save(own);
    expect(api.savedFileTypes.at(-1)).toEqual(own);
    expect(store.user()).toEqual(own);
  });
});
