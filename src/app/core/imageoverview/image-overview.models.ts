import type { FsError } from '../fs/fs.models';

/**
 * DTOs of the image overview (design 074). Keep in sync with Rust
 * `src-tauri/src/image_overview/mod.rs` (`OverviewItem`, `OverviewEvent`).
 */

/** What the overview can make of a file (Rust `images::ImageKind`). */
export type ImageKind = 'image' | 'raw' | 'unsupported';

/** An image of an overview. */
export interface OverviewItem {
  /** Position in the overview: the `index` of its thumbnail URL. */
  readonly index: number;
  /** Full path (opaque). */
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly modifiedMs: number | null;
  /** Path below the overview's folder with the OS separators – display only, never split. */
  readonly rel: string;
  /** The folder the image is in (opaque). */
  readonly dir: string;
  readonly kind: ImageKind;
}

export type OverviewEvent =
  | { readonly kind: 'items'; readonly items: readonly OverviewItem[] }
  | {
      readonly kind: 'done';
      /** A limit stopped the walk (20 000 images, 500 000 entries). */
      readonly truncated: boolean;
      readonly unreadable: readonly FsError[];
      readonly unreadableMore: number;
    }
  | { readonly kind: 'cancelled' };

/** Longest side of each thumbnail step (Rust `thumbs::STEPS`). */
export const THUMB_STEPS = [160, 320, 640, 2048] as const;

/** Images listed at most (Rust `collect::MAX_FILES`). */
export const MAX_IMAGES = 20_000;
