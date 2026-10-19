import { translatable } from '../../core/i18n/i18n';
import { ArchiveFormat } from '../../core/fs/fs.models';
import { ARCHIVE_DE } from './archive-texts.de';

/** Texts of pack/unpack (design 016); German in `archive-texts.de.ts` (design 015). */
export const ARCHIVE_EN = {
  packTitle: 'Pack',
  unpackTitle: 'Unpack',
  extractTitle: 'Extract from the archive',
  entries: (n: number) => (n === 1 ? '1 entry' : `${n} entries`),
  archives: (n: number) => (n === 1 ? '1 archive' : `${n} archives`),
  name: 'Archive name',
  format: 'Format',
  formats: { zip: 'ZIP', tar: 'TAR', tarGz: 'TAR.GZ' } as Readonly<Record<ArchiveFormat, string>>,
  level: 'Compression',
  levelHint: (n: number) => (n === 1 ? '1 (fastest)' : n === 9 ? '9 (smallest)' : `${n}`),
  to: 'To folder',
  suggestions: 'Suggestions',
  intoSubfolder: (name: string) => `Into a subfolder “${name}”`,
  intoSubfolderMany: 'Each archive into a subfolder of its name',
  ifExists: 'If a file exists',
  linksHint: 'Links are not packed (they are reported).',
  unpackHint: 'Links and entries with unsafe names (.., absolute paths) are never extracted.',
  pack: 'Pack',
  unpack: 'Unpack',
  cancel: 'Cancel',
  emptyName: 'Enter a name.',
  emptyTarget: 'Enter a target folder.',
  targetIsFile: 'The target is a file – choose a folder.',
  noArchive: 'No archive selected – put the cursor on a .zip, .tar or .tar.gz file.',
  readOnly: 'Archives are read-only here – extract the entries first (F5).',
  openInside: 'Files inside an archive cannot be opened yet – extract them first (F5).',
  intoArchive: 'Cannot copy into an archive – pack instead (Alt+F5).',
  unsafeHidden: (n: number) => (n === 1 ? '1 unsafe entry hidden' : `${n} unsafe entries hidden`),
  archiveBadge: (format: ArchiveFormat) =>
    `${format === 'zip' ? 'ZIP' : format === 'tar' ? 'TAR' : 'TAR.GZ'} · read-only`,
};

export const ARCHIVE_TEXTS = translatable('archive', ARCHIVE_EN, { de: ARCHIVE_DE });
