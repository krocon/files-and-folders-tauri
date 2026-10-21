import { folderMemoryFile, seedTabMemory } from './folder-memory-logic';
import { createTabMemory, MAX_FOLDERS, recallFolder, rememberFolder } from './tab-memory';

const folder = (path: string, marks: string[] = []) => ({
  path,
  cursor: `${path}/c`,
  marks,
  scrollTop: 30,
});

describe('folder memory logic (design 027)', () => {
  it('seeds a tab memory oldest first, bounded like the in-memory one', () => {
    const m = createTabMemory();
    const folders = Array.from({ length: MAX_FOLDERS + 2 }, (_, i) => folder(`/f${i}`));
    seedTabMemory(m, { tabId: 't', folders });
    expect(m.folders.size).toBe(MAX_FOLDERS);
    expect(recallFolder(m, '/f0')).toBeUndefined();
    expect(recallFolder(m, `/f${MAX_FOLDERS + 1}`)).toEqual({
      cursor: `/f${MAX_FOLDERS + 1}/c`,
      marks: [],
      scrollTop: 30,
    });
    seedTabMemory(m, undefined); // nothing saved: nothing changes
    expect(m.folders.size).toBe(MAX_FOLDERS);
  });

  it('writes the used tabs, the shown folder as the newest, never volatile ones', () => {
    const m = createTabMemory();
    rememberFolder(m, '/a ä', { cursor: '/a ä/x 😀', marks: ['/a ä/x 😀'], scrollTop: 5 });
    rememberFolder(m, '/z.zip', { cursor: null, marks: [], scrollTop: 0, volatile: true });
    rememberFolder(m, '/b', { cursor: null, marks: [], scrollTop: 0 });
    const file = folderMemoryFile([
      {
        tabId: 'used',
        memory: m,
        current: { path: '/a ä', state: { cursor: '/a ä/y', marks: [], scrollTop: 9 } },
        saved: { tabId: 'used', folders: [folder('/old')] },
      },
      {
        tabId: 'untouched',
        saved: { tabId: 'untouched', folders: [folder('/kept', ['/kept/1'])] },
      },
      { tabId: 'empty', memory: createTabMemory() },
      {
        tabId: 'server',
        memory: createTabMemory(),
        current: {
          path: 'remote://p/x',
          state: { cursor: null, marks: [], scrollTop: 0, volatile: true },
        },
      },
    ]);
    expect(file).toEqual({
      version: 1,
      tabs: [
        {
          tabId: 'used',
          folders: [
            { path: '/b', cursor: null, marks: [], scrollTop: 0 },
            { path: '/a ä', cursor: '/a ä/y', marks: [], scrollTop: 9 },
          ],
        },
        { tabId: 'untouched', folders: [folder('/kept', ['/kept/1'])] },
      ],
    });
  });
});
