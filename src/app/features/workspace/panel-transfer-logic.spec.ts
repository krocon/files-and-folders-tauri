import { dir, entry } from '../../../testing/fs-fixtures';
import { parentRow, VIRTUAL_PATH_PREFIX } from '../../core/fs/fs.models';
import { transferPath, TransferContext } from './panel-transfer-logic';

describe('transferPath (design 040)', () => {
  const ctx: TransferContext = { folder: '/h', inArchive: false, onServer: false };

  it('a folder, a link to a folder and ".." open themselves', () => {
    expect(transferPath(dir('Sub', { path: '/h/Sub' }), ctx)).toBe('/h/Sub');
    expect(
      transferPath(entry('ln', { path: '/h/ln', kind: 'symlink', targetKind: 'directory' }), ctx),
    ).toBe('/h/ln');
    expect(transferPath(parentRow('/'), ctx)).toBe('/');
  });

  it('a file, a broken name, a synthetic row or no cursor give the shown folder', () => {
    expect(transferPath(entry('a.txt', { path: '/h/a.txt' }), ctx)).toBe('/h');
    expect(transferPath(dir('bad', { path: '/h/bad', lossyName: true }), ctx)).toBe('/h');
    expect(transferPath(dir('rest', { path: `${VIRTUAL_PATH_PREFIX}rest` }), ctx)).toBe('/h');
    expect(transferPath(undefined, ctx)).toBe('/h');
    expect(transferPath(undefined, { ...ctx, folder: null })).toBeNull();
  });

  it('an archive opens as a folder – not inside an archive or on a server', () => {
    const zip = entry('Fotos 📷.zip', { path: '/h/Fotos 📷.zip' });
    expect(transferPath(zip, ctx)).toBe('/h/Fotos 📷.zip');
    expect(transferPath(zip, { ...ctx, inArchive: true })).toBe('/h');
    expect(transferPath(zip, { ...ctx, onServer: true })).toBe('/h');
  });
});
