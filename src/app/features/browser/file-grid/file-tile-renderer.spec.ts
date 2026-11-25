import { DirEntry } from '../../../core/fs/fs.models';
import { FileTileContext, FileTileRenderer, TILE_INDEX_ATTR } from './file-tile-renderer';

const entry = (name: string, extra: Partial<DirEntry> = {}): DirEntry => ({
  name,
  path: `/p/${name}`,
  kind: 'file',
  targetKind: null,
  size: 1,
  modifiedMs: 1,
  hidden: false,
  lossyName: false,
  ...extra,
});

function setup(over: Partial<FileTileContext> = {}) {
  const failed: string[] = [];
  const ctx: FileTileContext = {
    mode: () => 'brief',
    cols: () => 4,
    pictureHeight: () => 90,
    isCursor: () => false,
    isMarked: () => false,
    isDropTarget: () => false,
    thumb: () => null,
    thumbFailed: (e) => failed.push(e.name),
    markedText: () => 'marked',
    ...over,
  };
  const renderer = new FileTileRenderer(ctx);
  const render = (value: DirEntry | undefined, row = 0, col = 0) => {
    const cell = document.createElement('div');
    const cleanup = renderer.render(cell, row, col, 'body', null, value);
    return { cell, tile: cell.querySelector<HTMLElement>('.fg-tile'), cleanup };
  };
  return { render, failed };
}

describe('FileTileRenderer (design 041 E5/E6)', () => {
  it('brief: icon and name on one line, the index of the entry on the tile', () => {
    const { render } = setup();
    const { tile } = render(entry('<b>bild</b> & co.txt'), 2, 3);
    expect(tile?.className).toBe('fg-tile fg-brief');
    expect(tile?.getAttribute(TILE_INDEX_ATTR)).toBe('11');
    // a name is text, never markup
    expect(tile?.querySelector('.fg-name')?.textContent).toBe('<b>bild</b> & co.txt');
    expect(tile?.querySelector('b')).toBeNull();
    expect(tile?.querySelector('.fnf-icon i')?.className).toContain('fa ');
    expect(tile?.title).toBe('<b>bild</b> & co.txt');
  });

  it('carries the row classes of the list: cursor, marked, hidden, link, drop target', () => {
    const { render } = setup({
      isCursor: () => true,
      isMarked: () => true,
      isDropTarget: () => true,
    });
    const { tile } = render(entry('.versteckt', { hidden: true, kind: 'symlink' }));
    for (const cls of [
      'fnf-cursor',
      'fnf-marked',
      'fnf-drop-target',
      'fnf-hidden',
      'fnf-symlink',
    ]) {
      expect(tile?.classList.contains(cls)).toBe(true);
    }
    // marked as in the list: a check mark instead of the icon, and a text for screen readers
    expect(tile?.querySelector('.fnf-icon i')?.className).toBe('fa fa-check');
    expect(tile?.querySelector('.ge-table-sr-only')?.textContent).toBe('marked');
  });

  it('the cells behind the last entry stay empty', () => {
    const { render } = setup();
    expect(render(undefined).cell.childElementCount).toBe(0);
  });

  it('thumbnails: the picture where Rust listed one, else the icon; the name below', () => {
    const { render, failed } = setup({
      mode: () => 'thumbnails',
      thumb: (e) => (e.name.endsWith('.jpg') ? `fnfthumb://localhost/x.0.1?v=1` : null),
      isMarked: (e) => e.name === 'a.jpg',
    });
    const a = render(entry('a.jpg'));
    expect(a.tile?.className).toContain('fg-thumb');
    const img = a.tile?.querySelector('img');
    expect(img?.getAttribute('src')).toBe('fnfthumb://localhost/x.0.1?v=1');
    expect(a.tile?.querySelector<HTMLElement>('.fg-picture')?.style.height).toBe('90px');
    expect(a.tile?.querySelector('.fg-check')).not.toBeNull();
    expect(a.tile?.querySelector('.fg-name')?.textContent).toBe('a.jpg');
    const txt = render(entry('notes.txt'));
    expect(txt.tile?.querySelector('img')).toBeNull();
    expect(txt.tile?.querySelector('.fg-picture .fnf-icon')).not.toBeNull();
    // a picture that cannot be loaded: the icon, and the grid hears of it (retries)
    img?.dispatchEvent(new Event('error'));
    expect(a.tile?.querySelector('img')).toBeNull();
    expect(a.tile?.querySelector('.fg-picture .fnf-icon')).not.toBeNull();
    expect(failed).toEqual(['a.jpg']);
    a.cleanup?.();
  });
});
