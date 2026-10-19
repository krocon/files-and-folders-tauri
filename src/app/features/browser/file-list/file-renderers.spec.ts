import { AreaModelIf, SimpleDomService } from '@guiexpert/table';
import { DirEntry } from '../../../core/fs/fs.models';
import { dir, entry } from '../../../../testing/fs-fixtures';
import { DateCellRenderer, iconFor, NameCellRenderer, SizeCellRenderer } from './file-renderers';

function render(
  renderer: { render: NameCellRenderer['render'] },
  row: DirEntry,
  value: unknown,
): HTMLDivElement {
  const cell = document.createElement('div');
  const areaModel = { getRowByIndex: () => row } as unknown as AreaModelIf;
  renderer.render(cell, 0, 0, 'body', areaModel, value, new SimpleDomService());
  return cell;
}

describe('file renderers', () => {
  it('renders the name as text – no HTML injection', () => {
    const name = '<img src=x onerror=alert(1)>.txt';
    const cell = render(new NameCellRenderer(), entry(name), name);
    expect(cell.querySelector('img')).toBeNull();
    expect(cell.querySelector('.fnf-name')?.textContent).toBe(name);
    expect(cell.querySelector('.fnf-icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a check mark and a screen-reader hint for marked rows', () => {
    const cell = document.createElement('div');
    const areaModel = {
      getRowByIndex: () => entry('m'),
      isMarkedAt: () => true,
    } as unknown as AreaModelIf;
    new NameCellRenderer().render(cell, 0, 0, 'body', areaModel, 'm', new SimpleDomService());
    expect(cell.querySelector('.fnf-icon i')?.className).toBe('fa fa-check');
    expect(cell.querySelector('.ge-table-sr-only')?.textContent).toBe('marked, ');
  });

  it('renders unicode names unchanged', () => {
    const name = 'Übersicht März 日本語 😀.md';
    expect(render(new NameCellRenderer(), entry(name), name).textContent).toContain(name);
  });

  it('marks lossy names with a tooltip', () => {
    const cell = render(new NameCellRenderer(), entry('bad�', { lossyName: true }), 'bad�');
    expect(cell.getAttribute('title')).toContain('invalid characters');
  });

  it('shows <DIR> for folders and a formatted size for files', () => {
    expect(render(new SizeCellRenderer(), dir('d'), null).textContent).toBe('<DIR>');
    expect(render(new SizeCellRenderer(), entry('f', { size: 1536 }), 1536).textContent).toBe(
      '1.5 KB',
    );
    expect(render(new SizeCellRenderer(), dir('d'), null).querySelector('*')).toBeNull();
  });

  it('shows a spinner animation in size cell when directory size is being calculated', () => {
    const d = dir('d', { path: '/home/d' });
    const cell = document.createElement('div');
    const areaModel = {
      getRowByIndex: () => d,
      isCalculatingSize: (path: string) => path === '/home/d',
    } as unknown as AreaModelIf;
    new SizeCellRenderer().render(cell, 0, 0, 'body', areaModel, null, new SimpleDomService());
    expect(cell.querySelector('.fnf-size-spinner')).not.toBeNull();
    expect(cell.textContent).toBe('');
  });

  it('formats dates and leaves missing dates empty', () => {
    expect(render(new DateCellRenderer(), entry('f', { modifiedMs: 0 }), 0).textContent).not.toBe(
      '',
    );
    expect(render(new DateCellRenderer(), entry('f', { modifiedMs: null }), null).textContent).toBe(
      '',
    );
  });

  it('chooses icons per kind and extension', () => {
    expect(iconFor(dir('d'))).toBe('fa fa-folder');
    expect(iconFor(entry('l', { kind: 'symlink', targetKind: 'directory' }))).toBe('fa fa-folder');
    expect(iconFor(entry('l.pdf', { kind: 'symlink', targetKind: 'file' }))).toBe(
      'fa fa-file-pdf-o',
    );
    expect(iconFor(entry('l', { kind: 'symlink', targetKind: null }))).toBe('fa fa-chain-broken');
    expect(iconFor(entry('u', { kind: 'unknown' }))).toBe('fa fa-question-circle');
    expect(iconFor(entry('video.mp4'))).toBe('fa fa-file-video-o');
    expect(iconFor(entry('track.mp3'))).toBe('fa fa-file-audio-o');
    expect(iconFor(entry('f.unknown'))).toBe('fa fa-file-o');
  });
});
