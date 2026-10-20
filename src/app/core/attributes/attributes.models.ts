/**
 * Change attributes (design 024): DTOs of the job `attributes`.
 * Keep in sync with `src-tauri/src/attributes.rs`.
 */

/** Which entries a change applies to – the selected ones and the contents of folders. */
export type ApplyTo = 'all' | 'files' | 'dirs';

/** A new time: "now" (fixed once when the job starts) or milliseconds since 1970. */
export type TimeValue = { readonly type: 'now' } | { readonly type: 'at'; readonly ms: number };

/** What to change; missing / `null` = unchanged (tri-state for many entries). */
export interface AttrChange {
  /** Unix: permission bits to set … */
  readonly modeSet?: number;
  /** … and to clear (disjoint). */
  readonly modeClear?: number;
  /** Windows; `hidden` also on macOS. */
  readonly readonly?: boolean | null;
  readonly hidden?: boolean | null;
  readonly system?: boolean | null;
  readonly archive?: boolean | null;
  readonly modified?: TimeValue | null;
  readonly accessed?: TimeValue | null;
  /** Windows and macOS only. */
  readonly created?: TimeValue | null;
}
