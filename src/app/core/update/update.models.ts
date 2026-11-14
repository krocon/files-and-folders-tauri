/** Keep in sync with `UpdateInfo` / `UpdateState` in `src-tauri/src/update_check.rs` (design 075). */
export interface UpdateInfo {
  /** The running version (SemVer, without `v`). */
  readonly current: string;
  /** The latest published release on GitHub. */
  readonly latest: string;
  /** `latest` is newer than `current`. */
  readonly newer: boolean;
  /** A page of our GitHub releases (checked in Rust). */
  readonly releaseUrl: string;
  readonly name: string | null;
  /** ISO time as GitHub sends it. */
  readonly publishedAt: string | null;
  /** Release notes as plain text (never HTML), at most 4 KiB. */
  readonly notes: string | null;
  readonly notesTruncated: boolean;
  /** ms since 1970. */
  readonly checkedAt: number;
}

/** `update-check.json`: last attempt (ms since 1970) and the version the user skips. */
export interface UpdateState {
  readonly lastCheck?: number;
  readonly skipped?: string;
}
