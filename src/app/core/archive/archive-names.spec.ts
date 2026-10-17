import { describe, expect, it } from 'vitest';
import { DirEntry } from '../fs/fs.models';
import {
  archiveFormatOf,
  defaultArchiveName,
  isArchiveEntry,
  stripArchiveExtension,
  withFormat,
} from './archive-names';

const file = (name: string, kind: DirEntry['kind'] = 'file'): DirEntry => ({
  name,
  path: `/x/${name}`,
  kind,
  targetKind: kind === 'symlink' ? 'file' : null,
  size: 1,
  modifiedMs: null,
  hidden: false,
  lossyName: false,
});

describe('archive names (design 016)', () => {
  it('knows zip, tar and tar.gz like Rust', () => {
    expect(archiveFormatOf('A.ZIP')).toBe('zip');
    expect(archiveFormatOf('a.tgz')).toBe('tarGz');
    expect(archiveFormatOf('a.tar.gz')).toBe('tarGz');
    expect(archiveFormatOf('a.tar')).toBe('tar');
    expect(archiveFormatOf('.zip')).toBeNull();
    expect(archiveFormatOf('a.7z')).toBeNull();
    expect(isArchiveEntry(file('Fotos 📷.zip'))).toBe(true);
    expect(isArchiveEntry(file('link.zip', 'symlink'))).toBe(true);
    expect(isArchiveEntry(file('ordner.zip', 'directory'))).toBe(false);
    expect(isArchiveEntry({ ...file('x.zip'), lossyName: true })).toBe(false);
  });

  it('builds archive names', () => {
    expect(stripArchiveExtension('a.tar.gz')).toBe('a');
    expect(withFormat('Fotos.zip', 'tarGz')).toBe('Fotos.tar.gz');
    expect(withFormat('Fotos.tar.gz', 'zip')).toBe('Fotos.zip');
    expect(withFormat('  ', 'zip')).toBe('');
    expect(defaultArchiveName([file('bericht.pdf')], 'Docs', 'zip')).toBe('bericht.zip');
    expect(defaultArchiveName([file('Über alles', 'directory')], 'x', 'tar')).toBe(
      'Über alles.tar',
    );
    expect(defaultArchiveName([file('a'), file('b')], 'Urlaub 2024', 'zip')).toBe(
      'Urlaub 2024.zip',
    );
    expect(defaultArchiveName([file('a'), file('b')], '/', 'zip')).toBe('archive.zip');
  });
});
