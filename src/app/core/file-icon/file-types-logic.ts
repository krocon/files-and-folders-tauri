import {
  FileType,
  IconColorGroup,
  MAX_EXTENSIONS,
  MAX_FILE_TYPE_LABEL,
  MAX_FILE_TYPES,
} from '../config/config.models';

/**
 * Pure helpers of the file type categories (design 022 E4–E7): the same normalising
 * as Rust `filetypes.rs`, checks for the editor, the extension index and globs.
 */

/** Icons a category may have (Font Awesome 4.5.0, checked against `font-awesome.css`). */
export const FILE_TYPE_ICONS: readonly string[] = [
  'fa-file-o',
  'fa-file-text-o',
  'fa-file-video-o',
  'fa-file-audio-o',
  'fa-file-image-o',
  'fa-file-archive-o',
  'fa-file-code-o',
  'fa-file-pdf-o',
  'fa-file-word-o',
  'fa-file-excel-o',
  'fa-file-powerpoint-o',
  'fa-cogs',
  'fa-font',
  'fa-book',
  'fa-paint-brush',
  'fa-cube',
  'fa-database',
  'fa-music',
  'fa-film',
  'fa-picture-o',
  'fa-terminal',
  'fa-envelope-o',
  'fa-globe',
  'fa-lock',
  'fa-gamepad',
  'fa-camera',
  'fa-table',
  'fa-key',
  'fa-calendar-o',
  'fa-certificate',
];

export const ICON_COLOR_GROUPS: readonly IconColorGroup[] = [
  'folder',
  'document',
  'image',
  'video',
  'audio',
  'archive',
  'code',
  'executable',
];

const MAX_EXTENSION_CHARS = 33;

/** `JPG`, `*.jpg`, ` .Jpg ` → `.jpg`; null if it is no plain extension (same rule as Rust). */
export function normalizeExtension(raw: string): string | null {
  let t = raw.trim();
  t = t.startsWith('*') ? t.slice(1) : t;
  t = (t.startsWith('.') ? t.slice(1) : t).toLowerCase();
  // eslint-disable-next-line no-control-regex
  const bad = /[\s\u0000-\u001f\u007f/\\*?:]/u.test(t);
  return t !== '' && [...t].length < MAX_EXTENSION_CHARS && !bad ? `.${t}` : null;
}

/** Extensions typed as text (spaces, commas, semicolons, lines); duplicates dropped. */
export function parseExtensions(text: string): {
  readonly extensions: readonly string[];
  readonly invalid: readonly string[];
} {
  const extensions: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    if (!part) {
      continue;
    }
    const e = normalizeExtension(part);
    if (e === null) {
      invalid.push(part);
    } else if (!extensions.includes(e)) {
      extensions.push(e);
    }
  }
  return { extensions, invalid };
}

/** Problems of one category in a list (for the editor); empty = fine. */
export type FileTypeProblem = 'labelMissing' | 'labelTooLong' | 'labelTaken' | 'tooManyExtensions';

export function fileTypeProblems(list: readonly FileType[], i: number): FileTypeProblem[] {
  const t = list[i];
  const label = t.label.trim();
  const out: FileTypeProblem[] = [];
  if (!label) {
    out.push('labelMissing');
  } else if ([...label].length > MAX_FILE_TYPE_LABEL) {
    out.push('labelTooLong');
  } else if (list.some((o, j) => j !== i && o.label.trim().toLowerCase() === label.toLowerCase())) {
    out.push('labelTaken');
  }
  if (t.extensions.length > MAX_EXTENSIONS) {
    out.push('tooManyExtensions');
  }
  return out;
}

/** A loaded list as the app uses it: icons from the list, colours known, at most the limit. */
export function cleanFileTypes(list: readonly FileType[]): FileType[] {
  return list.slice(0, MAX_FILE_TYPES).map((t) => ({
    label: t.label,
    extensions: [...t.extensions],
    icon: t.icon && FILE_TYPE_ICONS.includes(t.icon) ? t.icon : null,
    color: t.color && ICON_COLOR_GROUPS.includes(t.color) ? t.color : null,
  }));
}

export function sameFileTypes(a: readonly FileType[], b: readonly FileType[]): boolean {
  return JSON.stringify(cleanFileTypes(a)) === JSON.stringify(cleanFileTypes(b));
}

/** Pattern for the mark dialog: `*.jpg *.png`. */
export function fileTypeGlob(t: FileType): string {
  return t.extensions.map((e) => `*${e}`).join(' ');
}

export interface FileTypeIndex {
  readonly categories: readonly FileType[];
  /** Extension without dot → first category that lists it. */
  readonly byExtension: ReadonlyMap<string, FileType>;
}

export function indexFileTypes(categories: readonly FileType[]): FileTypeIndex {
  const byExtension = new Map<string, FileType>();
  for (const c of categories) {
    for (const e of c.extensions) {
      const key = e.replace(/^\./, '').toLowerCase();
      if (key && !byExtension.has(key)) {
        byExtension.set(key, c);
      }
    }
  }
  return { categories, byExtension };
}
