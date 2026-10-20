import { Injectable, signal } from '@angular/core';
import { FileType, IconColorGroup } from '../config/config.models';
import { DirEntry, isNavigableDir, isParentRow } from '../fs/fs.models';
import { cleanFileTypes, FileTypeIndex, indexFileTypes } from './file-types-logic';
import builtInJson from './file-types.json';

export type { IconColorGroup };

/** The built-in categories (mr `filetype/defaults/data.json` + icon and colour, design 022 E4). */
export const BUILT_IN_FILE_TYPES: readonly FileType[] = cleanFileTypes(
  builtInJson as unknown as FileType[],
);

/**
 * The categories in use (design 022 E5): set by the `FileTypesStore`, read by the
 * renderers without injection – the file list repaints when it changes.
 */
export const FILE_TYPES = signal<FileTypeIndex>(indexFileTypes(BUILT_IN_FILE_TYPES));

/** Finer icons for some documents: they refine the generic document icon only (design 022 E6). */
const EXTENSION_SPECIFIC_ICONS: Readonly<Record<string, string>> = {
  pdf: 'fa-file-pdf-o',
  doc: 'fa-file-word-o',
  docx: 'fa-file-word-o',
  odt: 'fa-file-word-o',
  rtf: 'fa-file-word-o',
  xls: 'fa-file-excel-o',
  xlsx: 'fa-file-excel-o',
  ods: 'fa-file-excel-o',
  ppt: 'fa-file-powerpoint-o',
  pptx: 'fa-file-powerpoint-o',
  odp: 'fa-file-powerpoint-o',
  txt: 'fa-file-text-o',
  md: 'fa-file-text-o',
};

const DEFAULT_FILE_ICON = 'fa-file-o';
const GENERIC_DOCUMENT_ICON = 'fa-file-text-o';

/** Extracts clean extension without leading dot in lowercase. */
export function extractExtension(filenameOrExt: string): string {
  const trimmed = filenameOrExt.trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot >= 0 && lastDot < trimmed.length - 1) {
    return trimmed.slice(lastDot + 1).toLowerCase();
  }
  return trimmed.replace(/^\./, '').toLowerCase();
}

/** Resolves FontAwesome icon class for a file name or extension. */
export function iconNameForExtension(filenameOrExt: string): string {
  const ext = extractExtension(filenameOrExt);
  if (!ext) {
    return DEFAULT_FILE_ICON;
  }
  const category = FILE_TYPES().byExtension.get(ext);
  const icon = category ? (category.icon ?? DEFAULT_FILE_ICON) : null;
  if ((icon === null || icon === GENERIC_DOCUMENT_ICON) && EXTENSION_SPECIFIC_ICONS[ext]) {
    return EXTENSION_SPECIFIC_ICONS[ext];
  }
  return icon ?? DEFAULT_FILE_ICON;
}

/** Resolves FontAwesome icon name (e.g. `fa-folder`, `fa-file-video-o`) for a DirEntry. */
export function iconNameForEntry(entry: DirEntry): string {
  if (isParentRow(entry)) {
    return 'fa-level-up';
  }
  if (isNavigableDir(entry)) {
    return 'fa-folder';
  }
  switch (entry.kind) {
    case 'symlink':
      if (entry.targetKind === null) {
        return 'fa-chain-broken';
      }
      if (entry.targetKind === 'directory') {
        return 'fa-folder';
      }
      return iconNameForExtension(entry.name);
    case 'unknown':
      return 'fa-question-circle';
    default:
      return iconNameForExtension(entry.name);
  }
}

/** Colour group of an entry's icon; `null` = plain text colour (`..`, unknown types, broken links). */
export function iconColorGroupForEntry(entry: DirEntry): IconColorGroup | null {
  const icon = iconNameForEntry(entry);
  if (icon === 'fa-folder') {
    return 'folder';
  }
  if (isParentRow(entry) || icon === 'fa-chain-broken' || icon === 'fa-question-circle') {
    return null;
  }
  return FILE_TYPES().byExtension.get(extractExtension(entry.name))?.color ?? null;
}

/** Returns full CSS class string with `fa` prefix (e.g. `fa fa-folder`, `fa fa-file-code-o`). */
export function iconFor(entry: DirEntry): string {
  return `fa ${iconNameForEntry(entry)}`;
}

@Injectable({
  providedIn: 'root',
})
export class FileIconService {
  /** The categories in use (built in or the user's, design 022). */
  get categories(): readonly FileType[] {
    return FILE_TYPES().categories;
  }

  getCategory(filenameOrExt: string): string | undefined {
    return FILE_TYPES().byExtension.get(extractExtension(filenameOrExt))?.label;
  }

  getIconName(entryOrExt: DirEntry | string): string {
    if (typeof entryOrExt === 'string') {
      return iconNameForExtension(entryOrExt);
    }
    return iconNameForEntry(entryOrExt);
  }

  getIconClass(entryOrExt: DirEntry | string): string {
    return `fa ${this.getIconName(entryOrExt)}`;
  }

  iconFor(entry: DirEntry): string {
    return iconFor(entry);
  }
}
