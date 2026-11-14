import { AreaModelIf } from '@guiexpert/table';
import { overviewItem } from '../../../testing/fake-image-overview-api';
import { OverviewItem } from '../../core/imageoverview/image-overview.models';
import { TileRenderer } from './tile-renderer';

describe('TileRenderer (design 074 E11)', () => {
  const cursor = new Set<string>();
  const marks = new Set<string>();
  const failed = new Set<string>();
  const renderer = new TileRenderer({
    src: (i) => (failed.has(i.path) ? null : `fnfthumb://localhost/x.${i.index}.0`),
    failed: (i) => failed.add(i.path),
    isCursor: (i) => cursor.has(i.path),
    isMarked: (i) => marks.has(i.path),
    title: (i) => i.rel,
    noPreview: () => 'no preview',
  });
  const render = (item: OverviewItem | undefined) => {
    const cell = document.createElement('div');
    renderer.render(cell, 0, 0, 'body', {} as AreaModelIf, item);
    return cell;
  };

  it('shows only the picture, the hostile name only as tooltip, never as HTML', () => {
    const evil = '<img src=x onerror=alert(1)>.jpg';
    const cell = render(overviewItem(0, evil));
    expect(cell.querySelector('.io-name')).toBeNull();
    expect(cell.querySelector<HTMLElement>('.io-tile')?.title).toBe(evil);
    expect(cell.querySelectorAll('img')).toHaveLength(1);
    expect(cell.querySelector('img')?.getAttribute('src')).toBe('fnfthumb://localhost/x.0.0');
    expect(cell.querySelector('img')?.getAttribute('onerror')).toBeNull();
  });

  it('marks cursor and marked tiles; empty cells stay empty', () => {
    const item = overviewItem(1, 'a.jpg');
    cursor.add(item.path);
    marks.add(item.path);
    const tile = render(item).querySelector('.io-tile');
    expect(tile?.classList.contains('io-cursor')).toBe(true);
    expect(tile?.classList.contains('io-marked')).toBe(true);
    expect(tile?.querySelector('.io-check .fa-check')).not.toBeNull();
    expect(render(undefined).childElementCount).toBe(0);
  });

  it('shows a placeholder for unsupported images and after a failed load', () => {
    const heic = render(overviewItem(2, 'x.heic', { kind: 'unsupported' }));
    expect(heic.querySelector('img')).toBeNull();
    expect(heic.querySelector('.io-placeholder')?.textContent).toBe('HEICno preview');
    const broken = overviewItem(3, 'kaputt.jpg');
    const cell = render(broken);
    cell.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(cell.querySelector('img')).toBeNull();
    expect(cell.querySelector('.io-placeholder')).not.toBeNull();
    expect(failed.has(broken.path)).toBe(true);
    expect(render(broken).querySelector('img')).toBeNull(); // waits for the retry
  });
});
