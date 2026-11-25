import { translatable } from '../../core/i18n/i18n';
import { TemplateReason, ToolState, UrlReason } from '../../core/urldownload/url-download.models';
import { BuiltinPresetId, TargetBlock } from './url-download-logic';
import { URL_DOWNLOAD_DE } from './urldownload-texts.de';

/** Texts of "Download from URLs" (078); German in `urldownload-texts.de.ts`. */
export const URL_DOWNLOAD_EN = {
  title: 'Download from URLs',
  searching: 'Looking for yt-dlp, ffmpeg and a JavaScript runtime…',
  target: 'Target',
  left: 'Left',
  right: 'Right',
  activePanel: 'active panel',
  targetEntry: (side: string, path: string) => `${side} · ${path}`,
  targetBlocked: (side: string, reason: string) => `${side} · ${reason}`,
  blocked: {
    noFolder: 'no folder',
    result: 'a result tab – not a folder',
    archive: 'inside an archive – not possible',
    server: 'on a server – not possible',
  } satisfies Record<TargetBlock, string>,
  noTarget: 'Neither side shows a local folder.',
  urls: 'URLs (one per line)',
  paste: 'Paste from clipboard',
  pasted: (n: number) =>
    n === 0
      ? 'The clipboard holds no new http(s) address.'
      : n === 1
        ? '1 address added from the clipboard.'
        : `${n} addresses added from the clipboard.`,
  pasteFailed: 'The clipboard could not be read – paste into the field instead.',
  startHint: (key: string) => `Enter starts a new line here; ${key} starts the download.`,
  count: (n: number) => (n === 1 ? '1 URL' : `${n} URLs`),
  invalid: (n: number) => `${n} invalid`,
  duplicates: (n: number) => (n === 1 ? '1 repeated' : `${n} repeated`),
  tooMany: (max: number) => `more than ${max} – the rest is left out`,
  line: (n: number, reason: string) => `line ${n}: ${reason}`,
  moreLines: (n: number) => `and ${n} more`,
  urlReason: {
    invalid: 'not an address',
    scheme: 'only http and https',
    noHost: 'no host name',
    credentials: 'user name or password in the address',
    tooLong: 'too long',
  } satisfies Record<UrlReason, string>,
  preset: 'Preset',
  presets: {
    best: 'Best video',
    video1080mp4: 'Video up to 1080p (mp4)',
    audioMp3: 'Audio only (mp3)',
    audioBest: 'Audio only (original, m4a/opus)',
  } satisfies Record<BuiltinPresetId, string>,
  presetCustom: '(own choice)',
  ownPreset: (label: string) => `${label} (url-download.json)`,
  ownPresetNote: 'This preset sets format and quality itself.',
  presetGone: 'The preset is no longer in url-download.json.',
  presetProblems: (n: number, file: string) =>
    n === 1 ? `1 preset in ${file} was refused:` : `${n} presets in ${file} were refused:`,
  presetReason: (id: string, reason: string, option: string) =>
    `${id || '?'}: ${reason}${option ? ` (${option})` : ''}`,
  presetReasons: {
    id: 'invalid id',
    label: 'no label',
    duplicate: 'id used twice',
    tooManyArgs: 'too many arguments',
    notAllowed: 'option not allowed',
    missingValue: 'value missing',
    badValue: 'value not allowed',
    unexpectedValue: 'takes no value',
  } as Readonly<Record<string, string>>,
  presetFileBroken: 'url-download.json could not be read; it was set aside.',
  content: 'Content',
  video: 'Video',
  audioOnly: 'audio only',
  maxHeight: 'At most',
  anyHeight: 'any',
  height: (h: number) => `${h}p`,
  container: 'Container',
  containerAuto: 'as delivered',
  containerPrefer: (name: string) => `${name} (preferred)`,
  audio: 'Audio',
  audioBest: 'original',
  template: 'File name',
  templateFields: 'Fields for the name',
  templateHelp:
    'Fields: %(title)s, %(id)s, %(uploader)s, %(upload_date>%Y-%m-%d)s, %(playlist_index)02d, %(ext)s. Cut a long title with %(title).100B.',
  example: (name: string) => `e.g. “${name}”`,
  templateReason: {
    empty: 'The template is empty.',
    tooLong: 'The template is too long.',
    separator: 'No “/” or “\\” – files always go into the target folder.',
    escape: 'No “..”, “~”, “$”, “:” or a leading “-” – the file must stay in the target folder.',
    character: 'A character that file names cannot have.',
    field: 'A “%” that is no field like %(title)s.',
    extension: 'The template must end with .%(ext)s (and have a name before it).',
  } satisfies Record<TemplateReason, string>,
  playlist: 'Playlist',
  playlistNo: 'only the video of the URL',
  playlistYes: 'the whole playlist',
  playlistSubfolder: 'a folder per playlist',
  extras: 'Extras',
  subtitles: 'Subtitles',
  subLangs: 'Subtitle languages',
  subLangsBad: 'Languages like “en” or “de,en”.',
  embedThumbnail: 'Embed thumbnail',
  embedMetadata: 'Embed metadata',
  overwrite: 'Overwrite existing files',
  login: 'Sign-in',
  cookies: 'Cookies from browser',
  cookiesNone: 'none',
  cookiesHint:
    'yt-dlp reads the cookies of this browser to load what needs your sign-in. The system may ask for access to the keychain.',
  needsFfmpeg: 'needs ffmpeg',
  noFfmpeg: 'ffmpeg was not found: audio only, mp4/mkv and embedding are off.',
  noJsRuntime: 'No JavaScript runtime (deno or node) was found – YouTube needs one.',
  jsTooOld: (name: string, version: string) =>
    `${name} ${version} is too old for yt-dlp – YouTube needs a newer one.`,
  outdated: (version: string) =>
    `yt-dlp ${version} is more than 90 days old – sites change, update it with your package manager.`,
  toolState: {
    ok: 'found',
    missing: 'not found',
    tooOld: 'too old',
    failed: 'does not start',
  } satisfies Record<ToolState, string>,
  tool: (name: string, version: string, state: string) =>
    version ? `${name} ${version} – ${state}` : `${name} – ${state}`,
  jsRuntime: 'JavaScript runtime',
  rescan: 'Search again',
  copyCommand: 'Copy command',
  commandCopied: (shell: string) => `The command for ${shell} is in the clipboard.`,
  commandNotForShell:
    'cmd.exe cannot take this command safely (it expands “%…%” even inside quotes). Choose PowerShell under Settings → Shell and copy again – nothing was copied.',
  yourShell: 'your shell (sh, zsh, bash)',
  targetByMcp: (client: string) =>
    `“${client}” opened this folder over MCP – check the target before you download.`,
  missingTitle: 'yt-dlp was not found',
  missingIntro:
    'This dialog uses the program yt-dlp, which is not part of Files and Folders. Install it and choose “Search again”:',
  missingFailed: (path: string) => `yt-dlp was found but does not start: ${path}`,
  missingConfigured: 'The path set for yt-dlp in the settings does not lead to a program.',
  installMac: 'macOS (Homebrew)',
  installWindows: 'Windows (winget)',
  installLinux: 'Linux / any system (pipx)',
  projectPage: 'Project page',
  missingSetting:
    'Installed somewhere else? Set the full path under Settings → Tools → “yt-dlp (Download from URLs)”.',
  rights: 'You are responsible for having the right to download the content.',
  cancel: 'Cancel',
  start: 'Download',
  started: (n: number) =>
    n === 1 ? 'Download of 1 URL started.' : `Download of ${n} URLs started.`,
  done: (files: number, present: number) =>
    `Download finished: ${files === 1 ? '1 file' : `${files} files`}${
      present > 0 ? ` (${present} already there)` : ''
    }.`,
  doneWithErrors: (failed: number) =>
    failed === 1
      ? 'Download finished – 1 URL failed (see Tasks).'
      : `Download finished – ${failed} URLs failed (see Tasks).`,
  failed: (reason: string) => `Download failed: ${reason}`,
  cancelled: 'Download cancelled – started files stay as .part and are resumed next time.',
};

export const URL_DOWNLOAD_TEXTS = translatable('urlDownload', URL_DOWNLOAD_EN, {
  de: URL_DOWNLOAD_DE,
});
