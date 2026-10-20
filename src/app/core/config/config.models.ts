/**
 * DTOs of the user config files of design 022 (Rust `config_file.rs`, `buttons.rs`,
 * `filetypes.rs`). Keep in sync by hand.
 */

/** A load problem: `broken` (path = the `.bad` copy, null if it stayed) or `unreadable`. */
export interface ConfigWarning {
  readonly code: 'broken' | 'unreadable';
  readonly path: string | null;
}

export interface Loaded<T> {
  readonly value: T;
  readonly warning: ConfigWarning | null;
}

/** Modifier set → action ids (only the sets the user changed). */
export type ButtonSetsOverride = Readonly<Record<string, readonly string[]>>;

export interface ButtonsOverride {
  readonly sets: ButtonSetsOverride;
}

/** Icon colour group of a file type (theme tokens `--color-icon-<group>`). */
export type IconColorGroup =
  'folder' | 'document' | 'image' | 'video' | 'audio' | 'archive' | 'code' | 'executable';

export interface FileType {
  readonly label: string;
  /** Lower case with a leading dot (`.jpg`). */
  readonly extensions: readonly string[];
  /** Font Awesome 4.5 icon name (`fa-book`), null = generic file icon. */
  readonly icon: string | null;
  readonly color: IconColorGroup | null;
}

/** Same limits as Rust. */
export const MAX_BUTTON_SLOTS = 10;
export const MAX_FILE_TYPES = 100;
export const MAX_FILE_TYPE_LABEL = 64;
export const MAX_EXTENSIONS = 200;
