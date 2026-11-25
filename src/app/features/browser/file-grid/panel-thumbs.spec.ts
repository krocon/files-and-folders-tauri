import { FakeImageOverviewApi, overviewItem } from '../../../../testing/fake-image-overview-api';
import { PanelThumbs } from './panel-thumbs';

const flush = () => new Promise<void>((r) => setTimeout(r));

describe('PanelThumbs (design 041 E6)', () => {
  it('opens an overview of the folder without subfolders and hands out its thumbnails', async () => {
    const api = new FakeImageOverviewApi();
    const thumbs = new PanelThumbs(api);
    thumbs.show('/fotos', 's1');
    await flush();
    expect(api.opened.map((o) => [o.root, o.recursive])).toEqual([['/fotos', false]]);
    expect(thumbs.url('/fotos/a.jpg', 1)).toBeNull();
    const before = thumbs.version();
    api.deliver([overviewItem(0, 'a.jpg'), overviewItem(1, 'b.heic', { kind: 'unsupported' })]);
    expect(thumbs.version()).toBeGreaterThan(before);
    expect(thumbs.url('/fotos/a.jpg', 1)).toBe('fnfthumb://localhost/ov1.0.1?v=1700000000000');
    // no decoder for it, and not listed at all: the tile keeps its icon
    expect(thumbs.url('/fotos/b.heic', 1)).toBeNull();
    expect(thumbs.url('/fotos/readme.txt', 1)).toBeNull();
    // the same folder and stamp again: nothing new is opened
    thumbs.show('/fotos', 's1');
    expect(api.opened.length).toBe(1);
  });

  it('a refresh keeps the old thumbnails until the new list is complete', async () => {
    const api = new FakeImageOverviewApi();
    const thumbs = new PanelThumbs(api);
    thumbs.show('/fotos', 's1');
    await flush();
    api.deliver([overviewItem(0, 'a.jpg')]);
    thumbs.show('/fotos', 's2');
    await flush();
    expect(api.closed).toEqual([]);
    expect(thumbs.url('/fotos/a.jpg', 0)).toContain('ov1.0.0');
    api
      .last()
      .emit({ kind: 'items', items: [overviewItem(0, 'new.jpg'), overviewItem(1, 'a.jpg')] });
    expect(thumbs.url('/fotos/a.jpg', 0)).toContain('ov1.0.0');
    api.last().emit({ kind: 'done', truncated: false, unreadable: [], unreadableMore: 0 });
    expect(api.closed).toEqual(['ov1']);
    expect(thumbs.url('/fotos/a.jpg', 0)).toContain('ov2.1.0');
    expect(thumbs.url('/fotos/new.jpg', 0)).toContain('ov2.0.0');
  });

  it('another folder drops the old pictures at once; none = everything closed', async () => {
    const api = new FakeImageOverviewApi();
    const thumbs = new PanelThumbs(api);
    thumbs.show('/fotos', 's1');
    await flush();
    api.deliver([overviewItem(0, 'a.jpg')]);
    thumbs.show('/other', 's1');
    expect(api.closed).toEqual(['ov1']);
    expect(thumbs.url('/fotos/a.jpg', 0)).toBeNull();
    await flush();
    // an archive, a server, a result tab: no overview
    thumbs.show(null, '');
    expect(api.closed).toEqual(['ov1', 'ov2']);
    expect(api.opened.length).toBe(2);
  });

  it('a list that was overtaken is closed when its id arrives', async () => {
    const api = new FakeImageOverviewApi();
    const thumbs = new PanelThumbs(api);
    thumbs.show('/a', 's');
    thumbs.show('/b', 's');
    await flush();
    expect(api.closed).toEqual(['ov1']);
    const stale = api.opened[0];
    stale.emit({ kind: 'items', items: [overviewItem(0, 'x.jpg', { dir: '/a' })] });
    expect(thumbs.url('/a/x.jpg', 0)).toBeNull();
    thumbs.dispose();
    expect(api.closed).toEqual(['ov1', 'ov2']);
  });

  it('without thumbnails (no backend) the tiles simply keep their icons', async () => {
    const api = new FakeImageOverviewApi();
    api.failOpen = { code: 'no_backend', message: '', path: null };
    const thumbs = new PanelThumbs(api);
    thumbs.show('/fotos', 's1');
    await flush();
    expect(thumbs.url('/fotos/a.jpg', 0)).toBeNull();
  });
});
