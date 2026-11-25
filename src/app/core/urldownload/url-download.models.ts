/**
 * DTOs of "Download from URLs" (design 078). Keep in sync with Rust `url_download/`
 * (`mod.rs`, `urls.rs`, `template.rs`, `tools.rs`, `presets.rs`) and
 * `commands/url_download.rs`.
 */

export type DownloadContent = 'video' | 'audio';
export const DOWNLOAD_CONTENTS: readonly DownloadContent[] = ['video', 'audio'];

export type DownloadContainer = 'auto' | 'mp4' | 'mkv';
export const DOWNLOAD_CONTAINERS: readonly DownloadContainer[] = ['auto', 'mp4', 'mkv'];

export type DownloadAudioFormat = 'best' | 'mp3' | 'm4a' | 'opus';
export const DOWNLOAD_AUDIO_FORMATS: readonly DownloadAudioFormat[] = [
  'best',
  'mp3',
  'm4a',
  'opus',
];

/** = Rust `HEIGHTS`. */
export const DOWNLOAD_HEIGHTS: readonly number[] = [2160, 1440, 1080, 720, 480, 360];

export type DownloadBrowser =
  'brave' | 'chrome' | 'chromium' | 'edge' | 'firefox' | 'opera' | 'safari' | 'vivaldi';
export const DOWNLOAD_BROWSERS: readonly DownloadBrowser[] = [
  'brave',
  'chrome',
  'chromium',
  'edge',
  'firefox',
  'opera',
  'safari',
  'vivaldi',
];

/**
 * What the dialog sends (Rust `DownloadOptions`, unknown fields are refused there).
 * There is no field for free yt-dlp options – Rust builds every argument.
 */
export interface DownloadOptions {
  /** Id of an own preset from `url-download.json`; replaces content/height/container/audio. */
  readonly preset: string | null;
  readonly content: DownloadContent;
  readonly maxHeight: number | null;
  readonly container: DownloadContainer;
  readonly audioFormat: DownloadAudioFormat;
  readonly template: string;
  readonly playlist: boolean;
  readonly playlistSubfolder: boolean;
  readonly subtitles: boolean;
  readonly subLangs: string;
  readonly embedThumbnail: boolean;
  readonly embedMetadata: boolean;
  readonly overwrite: boolean;
  readonly cookiesBrowser: DownloadBrowser | null;
}

/** = Rust `DEFAULT_TEMPLATE` (yt-dlp's own default). */
export const DEFAULT_DOWNLOAD_TEMPLATE = '%(title)s [%(id)s].%(ext)s';

export const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = {
  preset: null,
  content: 'video',
  maxHeight: null,
  container: 'auto',
  audioFormat: 'best',
  template: DEFAULT_DOWNLOAD_TEMPLATE,
  playlist: false,
  playlistSubfolder: false,
  subtitles: false,
  subLangs: 'en',
  embedThumbnail: false,
  embedMetadata: false,
  overwrite: false,
  cookiesBrowser: null,
};

export type ToolState = 'ok' | 'missing' | 'tooOld' | 'failed';

export interface ToolStatus {
  readonly state: ToolState;
  readonly version: string | null;
  readonly path: string | null;
  /** JavaScript runtime: `deno` | `node`. */
  readonly name: string | null;
  /** The path comes from the settings. */
  readonly configured: boolean;
}

export interface DownloadTools {
  readonly ytDlp: ToolStatus;
  readonly ffmpeg: ToolStatus;
  readonly jsRuntime: ToolStatus;
  /** yt-dlp's version date is older than 90 days. */
  readonly ytDlpOutdated: boolean;
}

export interface DownloadPresetInfo {
  readonly id: string;
  readonly label: string;
}

export interface DownloadPresetProblem {
  readonly id: string;
  /** `id` | `label` | `duplicate` | `tooManyArgs` | `notAllowed` | `missingValue` | `badValue` | `unexpectedValue` */
  readonly reason: string;
  readonly option: string | null;
}

export interface LoadedDownloadPresets {
  readonly presets: readonly DownloadPresetInfo[];
  readonly problems: readonly DownloadPresetProblem[];
  readonly warning: { readonly code: string; readonly path: string | null } | null;
  /** `url-download.json`. */
  readonly file: string;
}

export type UrlReason = 'invalid' | 'scheme' | 'noHost' | 'credentials' | 'tooLong';

export interface UrlProblem {
  /** 1-based line of the URL field. */
  readonly line: number;
  readonly reason: UrlReason;
}

export type TemplateReason =
  'empty' | 'tooLong' | 'separator' | 'escape' | 'character' | 'field' | 'extension';

export interface DownloadCheck {
  /** The valid URLs, normalised and without duplicates – what the job is started with. */
  readonly urls: readonly string[];
  readonly problems: readonly UrlProblem[];
  readonly duplicates: number;
  readonly tooMany: boolean;
  readonly template: TemplateReason | null;
  /** A sample file name (made-up values); empty for a refused template. */
  readonly example: string;
}

/** `Summary.download` of a finished job. */
export interface DownloadSummary {
  readonly files: readonly string[];
  readonly fileCount: number;
  /** Files that were there already. */
  readonly present: number;
}

export type DownloadPhase = 'downloading' | 'processing';
