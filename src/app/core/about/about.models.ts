/** Keep in sync with `AppInfo` in `src-tauri/src/about.rs` (design 017). */
export interface AppInfo {
  readonly name: string;
  /** From tauri.conf.json, which reads package.json (one source of truth). */
  readonly version: string;
  /** Cargo.toml – equal to `version` unless the versions drifted apart. */
  readonly crateVersion: string;
  readonly tauriVersion: string;
  /** `macos`, `windows`, `linux`, … */
  readonly os: string;
  /** `x86_64`, `aarch64`, … */
  readonly arch: string;
  readonly debug: boolean;
}
