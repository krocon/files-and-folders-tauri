import { Injectable } from '@angular/core';
import { DirEntry, isNavigableDir, isParentRow } from '../fs/fs.models';

export interface FileCategoryDefinition {
  readonly label: string;
  readonly extensions: readonly string[];
}

export const FILE_CATEGORIES: readonly FileCategoryDefinition[] = [
  {
    label: 'movies',
    extensions: ['.avi', '.mkv', '.mp4', '.mov', '.wmv', '.flv', '.webm'],
  },
  {
    label: 'audio',
    extensions: ['.mp3', '.wav', '.aac', '.flac', '.ogg', '.wma', '.m4a'],
  },
  {
    label: 'images',
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp', '.svg', '.heic'],
  },
  {
    label: 'documents',
    extensions: [
      '.pdf',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.ppt',
      '.pptx',
      '.odt',
      '.ods',
      '.odp',
      '.txt',
      '.rtf',
      '.md',
    ],
  },
  {
    label: 'archives',
    extensions: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso'],
  },
  {
    label: 'code',
    extensions: [
      '.html',
      '.css',
      '.js',
      '.ts',
      '.jsx',
      '.tsx',
      '.py',
      '.java',
      '.c',
      '.cpp',
      '.cs',
      '.rb',
      '.php',
      '.go',
      '.rs',
      '.sh',
      '.xml',
      '.json',
      '.yml',
      '.yaml',
      '.sql',
    ],
  },
  {
    label: 'executables',
    extensions: ['.exe', '.msi', '.bat', '.sh', '.apk', '.app', '.jar', '.com', '.bin', '.cmd'],
  },
  {
    label: 'fonts',
    extensions: ['.ttf', '.otf', '.woff', '.woff2', '.eot'],
  },
  {
    label: 'ebooks',
    extensions: ['.epub', '.mobi', '.azw', '.azw3', '.fb2', '.cbz', '.cbr'],
  },
  {
    label: 'design',
    extensions: ['.psd', '.ai', '.xd', '.sketch', '.fig', '.indd', '.cdr'],
  },
  {
    label: '3d',
    extensions: ['.obj', '.fbx', '.stl', '.dae', '.3ds', '.blend'],
  },
];

/** Extension-to-category mapping for fast lookup. */
const EXTENSION_TO_CATEGORY: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const cat of FILE_CATEGORIES) {
    for (const ext of cat.extensions) {
      const normalized = ext.toLowerCase().replace(/^\./, '');
      if (!map.has(normalized)) {
        map.set(normalized, cat.label);
      }
    }
  }
  return map;
})();

/** Specific extension to FontAwesome 4.5.0 icon name overrides. */
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

/** Category to default FontAwesome 4.5.0 icon name. */
const CATEGORY_DEFAULT_ICONS: Readonly<Record<string, string>> = {
  movies: 'fa-file-video-o',
  audio: 'fa-file-audio-o',
  images: 'fa-file-image-o',
  documents: 'fa-file-text-o',
  archives: 'fa-file-archive-o',
  code: 'fa-file-code-o',
  executables: 'fa-cogs',
  fonts: 'fa-font',
  ebooks: 'fa-book',
  design: 'fa-paint-brush',
  '3d': 'fa-cube',
};

const DEFAULT_FILE_ICON = 'fa-file-o';

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
  if (EXTENSION_SPECIFIC_ICONS[ext]) {
    return EXTENSION_SPECIFIC_ICONS[ext];
  }
  const category = EXTENSION_TO_CATEGORY.get(ext);
  if (category && CATEGORY_DEFAULT_ICONS[category]) {
    return CATEGORY_DEFAULT_ICONS[category];
  }
  return DEFAULT_FILE_ICON;
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

/** Returns full CSS class string with `fa` prefix (e.g. `fa fa-folder`, `fa fa-file-code-o`). */
export function iconFor(entry: DirEntry): string {
  return `fa ${iconNameForEntry(entry)}`;
}

@Injectable({
  providedIn: 'root',
})
export class FileIconService {
  readonly categories: readonly FileCategoryDefinition[] = FILE_CATEGORIES;

  getCategory(filenameOrExt: string): string | undefined {
    const ext = extractExtension(filenameOrExt);
    return EXTENSION_TO_CATEGORY.get(ext);
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
