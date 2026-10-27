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
  formats: {
    zip: 'ZIP',
    tar: 'TAR',
    tarGz: 'TAR.GZ',
    sevenZ: '7Z',
    rar: 'RAR',
  } as Readonly<Record<ArchiveFormat, string>>,
  level: 'Compression',
  levelHint: (n: number) =>
    n === 0 ? '0 (store only)' : n === 1 ? '1 (fastest)' : n === 9 ? '9 (smallest)' : `${n}`,
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
  noArchive: 'No archive selected – put the cursor on a .zip, .7z, .rar, .tar or .tar.gz file.',
  readOnly: 'Not possible inside an archive – extract the entries first (F5).',
  intoArchive: 'Cannot copy into a 7z or RAR archive – only ZIP, TAR and TAR.GZ can be changed.',
  readOnlyFormat: '7z and RAR archives can only be read – ZIP, TAR and TAR.GZ can be changed.',
  noRenameInto: 'A new name is not possible when copying into an archive.',
  linkIntoArchive: 'Links cannot be created in an archive.',
  deleteNoTrash: 'Entries in an archive are removed for good – an archive has no trash.',
  unsafeHidden: (n: number) => (n === 1 ? '1 unsafe entry hidden' : `${n} unsafe entries hidden`),
  archiveBadge: (format: ArchiveFormat) =>
    // ZIP, TAR and TAR.GZ can be changed since design 035
    format === 'sevenZ' || format === 'rar'
      ? `${ARCHIVE_TEXTS.formats[format]} · read-only`
      : ARCHIVE_TEXTS.formats[format],
  encryptedBadge: 'encrypted',
  password: 'Password',
  passwordOptional: 'Password (if encrypted)',
  packPassword: 'Password (optional)',
  passwordRepeat: 'Repeat password',
  passwordTitle: 'Encrypted archive',
  passwordIntro: (path: string) => `“${path}” is encrypted. Enter its password:`,
  passwordWrongBefore: 'The password did not fit – try again.',
  passwordKept: 'Kept in memory until the app ends – never saved.',
  open: 'Open',
  emptyPassword: 'Enter the password.',
  passwordsDiffer: 'The two passwords differ.',
  passwordTooLongRar: (n: number) => `RAR passwords have at most ${n} characters.`,
  passwordNeeded: (path: string) => `“${path}” is encrypted – try again to enter its password.`,
  zipAesHint:
    'ZIP with a password uses AES-256: Windows Explorer and the macOS Archive Utility cannot open it (7-Zip, WinZip, Keka can).',
  sevenZHint: '7z with a password encrypts the file names too.',
};

export const ARCHIVE_TEXTS = translatable('archive', ARCHIVE_EN, { de: ARCHIVE_DE });
