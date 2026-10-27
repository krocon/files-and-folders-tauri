import { ArchiveFormat, DirEntry } from '../fs/fs.models';

/**
 * Archive names (design 016). Rust decides what is an archive when listing
 * (`archive::format_of_name`); these helpers mirror it for the UI only (Enter
 * opens, Alt+F9 offers, the pack dialog picks the extension). Names are user
 * data – only their end is compared, paths are never split.
 */
const EXTENSIONS: readonly [string, ArchiveFormat][] = [
  ['.tar.gz', 'tarGz'],
  ['.tgz', 'tarGz'],
  ['.zip', 'zip'],
  ['.tar', 'tar'],
  ['.7z', 'sevenZ'],
  ['.rar', 'rar'],
];

export function archiveFormatOf(name: string): ArchiveFormat | null {
  const n = name.toLowerCase();
  for (const [ext, format] of EXTENSIONS) {
    if (n.endsWith(ext) && n.length > ext.length) {
      return format;
    }
  }
  return null;
}

/** Formats whose entries can be added, deleted and created (design 035 E1). */
export function isWritableFormat(format: ArchiveFormat | null | undefined): boolean {
  return format === 'zip' || format === 'tar' || format === 'tarGz';
}

/** A file (or link to a file) whose name says ZIP, TAR, TAR.GZ, 7z or RAR (design 025). */
export function isArchiveEntry(entry: DirEntry): boolean {
  const file = entry.kind === 'file' || (entry.kind === 'symlink' && entry.targetKind === 'file');
  return file && !entry.lossyName && archiveFormatOf(entry.name) !== null;
}

export const FORMAT_EXTENSION: Readonly<Record<ArchiveFormat, string>> = {
  zip: '.zip',
  tar: '.tar',
  tarGz: '.tar.gz',
  sevenZ: '.7z',
  rar: '.rar',
};

/** Formats the pack dialog offers – RAR can only be read (licence, design 025 E2). */
export const PACK_FORMATS: readonly ArchiveFormat[] = ['zip', 'sevenZ', 'tar', 'tarGz'];

/** Formats that can be encrypted when packing (design 025 E4). */
export function canEncrypt(format: ArchiveFormat): boolean {
  return format === 'zip' || format === 'sevenZ';
}

/** The name without a known archive extension (`a.tar.gz` → `a`). */
export function stripArchiveExtension(name: string): string {
  const n = name.toLowerCase();
  for (const [ext] of EXTENSIONS) {
    if (n.endsWith(ext) && n.length > ext.length) {
      return name.slice(0, name.length - ext.length);
    }
  }
  return name;
}

/** `name` with the extension of `format` (an old archive extension is replaced). */
export function withFormat(name: string, format: ArchiveFormat): string {
  const base = stripArchiveExtension(name.trim());
  return base === '' ? '' : base + FORMAT_EXTENSION[format];
}

/**
 * Default archive name (design 016 E5): one file → its name without the
 * extension, one folder → its name, several → the name of the folder they are in.
 */
export function defaultArchiveName(
  sources: readonly DirEntry[],
  folderName: string | null,
  format: ArchiveFormat,
): string {
  let base: string;
  if (sources.length === 1) {
    const e = sources[0];
    const dot = e.name.lastIndexOf('.');
    base = e.kind === 'directory' || dot <= 0 ? e.name : e.name.slice(0, dot);
  } else {
    base = folderName && !/^[/\\]|^[A-Za-z]:[/\\]?$/.test(folderName) ? folderName : 'archive';
  }
  return withFormat(base, format);
}
