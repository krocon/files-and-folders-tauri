/**
 * DTOs of the preview and properties commands (design 010). Keep in sync with
 * `src-tauri/src/preview/mod.rs`, `preview/detect.rs` and `properties.rs`.
 */
import { EntryKind } from '../fs/fs.models';

export type FormatFamily =
  'text' | 'image' | 'archive' | 'document' | 'media' | 'program' | 'data' | 'binary';

/** Type detected by content (magic bytes), not by the extension. */
export interface Format {
  /** Stable id: `text`, `png`, `pdf`, `zip`, `binary` … */
  readonly id: string;
  readonly label: string;
  readonly mime: string | null;
  readonly family: FormatFamily;
  readonly displayableImage: boolean;
}

export type EncodingId = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252' | 'latin-1';
export const ENCODINGS: readonly EncodingId[] = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'windows-1252',
  'latin-1',
];

export interface PreviewOptions {
  /** Omitted or `auto` = detect. */
  readonly encoding?: EncodingId | 'auto';
  /** `text` shows binary data as text, `hex` text as hex. */
  readonly mode?: 'auto' | 'text' | 'hex';
  readonly maxTextBytes?: number;
  readonly hexBytes?: number;
  /** Image token slot: a new token revokes the slot's previous one (review 2). */
  readonly imageSlot?: 'quick' | 'viewer';
}

interface PreviewBase {
  readonly size: number;
  readonly format: Format;
  /** The extension promises another family (e.g. `bild.txt` is a PNG). */
  readonly extMismatch: boolean;
}

export interface TextPreview extends PreviewBase {
  readonly kind: 'text';
  readonly encoding: EncodingId;
  readonly text: string;
  /** Only the head of the file (limit). */
  readonly truncated: boolean;
  /** Invalid bytes were replaced by U+FFFD. */
  readonly lossy: boolean;
}

export interface ImagePreview extends PreviewBase {
  readonly kind: 'image';
  /** Fetch via {@link PreviewApi.imageUrl}. */
  readonly token: string;
}

export interface BinaryPreview extends PreviewBase {
  readonly kind: 'binary';
  readonly bytes: readonly number[];
  readonly truncated: boolean;
}

export type Preview =
  | TextPreview
  | ImagePreview
  | BinaryPreview
  | { readonly kind: 'directory' }
  | { readonly kind: 'other' };

export interface UnixPerms {
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly owner: string | null;
  readonly group: string | null;
}

export interface WinAttrs {
  readonly readonly: boolean;
  readonly hidden: boolean;
  readonly system: boolean;
  readonly archive: boolean;
}

export interface Properties {
  readonly name: string;
  readonly path: string;
  readonly kind: EntryKind;
  readonly targetKind: EntryKind | null;
  readonly linkTarget: string | null;
  readonly size: number | null;
  readonly createdMs: number | null;
  readonly modifiedMs: number | null;
  readonly accessedMs: number | null;
  readonly readonly: boolean;
  readonly format: Format | null;
  readonly unix: UnixPerms | null;
  readonly windows: WinAttrs | null;
}
