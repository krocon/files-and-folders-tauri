import { Side } from '../../core/session/session.models';
import {
  DEFAULT_DOWNLOAD_OPTIONS,
  DEFAULT_DOWNLOAD_TEMPLATE,
  DOWNLOAD_AUDIO_FORMATS,
  DOWNLOAD_CONTAINERS,
  DOWNLOAD_CONTENTS,
  DOWNLOAD_HEIGHTS,
  DownloadOptions,
  DownloadTools,
} from '../../core/urldownload/url-download.models';
import { boolOr, oneOf, record, textOr } from '../../shared/restore-fields';

/** Pure logic of the download dialog (design 078) – no Angular, no texts. */

/** The fields a built-in preset sets (Rust builds the arguments from them). */
export type PresetFields = Pick<
  DownloadOptions,
  'content' | 'maxHeight' | 'container' | 'audioFormat'
>;

export type BuiltinPresetId = 'best' | 'video1080mp4' | 'audioMp3' | 'audioBest';

export const BUILTIN_PRESETS: readonly {
  readonly id: BuiltinPresetId;
  readonly fields: PresetFields;
}[] = [
  {
    id: 'best',
    fields: { content: 'video', maxHeight: null, container: 'auto', audioFormat: 'best' },
  },
  {
    id: 'video1080mp4',
    fields: { content: 'video', maxHeight: 1080, container: 'mp4', audioFormat: 'best' },
  },
  {
    id: 'audioMp3',
    fields: { content: 'audio', maxHeight: null, container: 'auto', audioFormat: 'mp3' },
  },
  {
    id: 'audioBest',
    fields: { content: 'audio', maxHeight: null, container: 'auto', audioFormat: 'best' },
  },
];

/** Value of the preset select for "none of the presets" (the fields were changed). */
export const CUSTOM_PRESET = 'custom';
/** Prefix of an own preset (`url-download.json`) in the preset select. */
export const OWN_PREFIX = 'own:';

/** The file name templates offered (the first one is yt-dlp's default). */
export const DOWNLOAD_TEMPLATES: readonly string[] = [
  DEFAULT_DOWNLOAD_TEMPLATE,
  '%(title)s.%(ext)s',
  '%(uploader)s - %(title)s.%(ext)s',
  '%(upload_date>%Y-%m-%d)s %(title)s.%(ext)s',
  '%(playlist_index)02d - %(title)s.%(ext)s',
];

/** The value of the preset select for a form. */
export function presetValue(o: DownloadOptions): string {
  if (o.preset !== null) {
    return `${OWN_PREFIX}${o.preset}`;
  }
  // fields that do not matter for the content are not compared (audio has no height)
  const hit = BUILTIN_PRESETS.find(({ fields: f }) =>
    f.content !== o.content
      ? false
      : o.content === 'audio'
        ? f.audioFormat === o.audioFormat
        : f.maxHeight === o.maxHeight && f.container === o.container,
  );
  return hit?.id ?? CUSTOM_PRESET;
}

/** The form after choosing `value` in the preset select. */
export function applyPreset(o: DownloadOptions, value: string): DownloadOptions {
  if (value.startsWith(OWN_PREFIX)) {
    return { ...o, preset: value.slice(OWN_PREFIX.length) };
  }
  const hit = BUILTIN_PRESETS.find((p) => p.id === value);
  return hit ? { ...o, ...hit.fields, preset: null } : { ...o, preset: null };
}

/** = Rust `DownloadOptions::needs_ffmpeg`. */
export function needsFfmpeg(o: DownloadOptions): boolean {
  return (
    o.embedThumbnail ||
    o.embedMetadata ||
    (o.preset === null && (o.content === 'audio' || o.container !== 'auto'))
  );
}

/** What the dialog locks because a program is missing. */
export interface ToolLocks {
  /** yt-dlp is not usable: no form at all. */
  readonly noYtDlp: boolean;
  /** ffmpeg is not usable: audio only, mp4/mkv and embedding are off. */
  readonly noFfmpeg: boolean;
  /** No (usable) JavaScript runtime: a hint, nothing is locked. */
  readonly noJsRuntime: boolean;
}

export function toolLocks(tools: DownloadTools | null): ToolLocks {
  return {
    noYtDlp: tools?.ytDlp.state !== 'ok',
    noFfmpeg: tools?.ffmpeg.state !== 'ok',
    noJsRuntime: tools?.jsRuntime.state !== 'ok',
  };
}

/** Takes back what cannot work without ffmpeg (the user sees the reason next to it). */
export function withoutFfmpeg(o: DownloadOptions): DownloadOptions {
  return {
    ...o,
    content: o.preset === null ? 'video' : o.content,
    container: o.preset === null ? 'auto' : o.container,
    embedThumbnail: false,
    embedMetadata: false,
  };
}

/** The form kept from the last run (design 027 E5) – field by field, nothing trusted. */
export function restoreDownloadForm(v: unknown): DownloadOptions {
  const r = record(v);
  const d = DEFAULT_DOWNLOAD_OPTIONS;
  const preset = r['preset'];
  const height = r['maxHeight'];
  return {
    preset: typeof preset === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(preset) ? preset : null,
    content: oneOf(r['content'], DOWNLOAD_CONTENTS, d.content),
    maxHeight: DOWNLOAD_HEIGHTS.includes(height as number) ? (height as number) : null,
    container: oneOf(r['container'], DOWNLOAD_CONTAINERS, d.container),
    audioFormat: oneOf(r['audioFormat'], DOWNLOAD_AUDIO_FORMATS, d.audioFormat),
    template: textOr(r['template'], d.template, 200) || d.template,
    playlist: boolOr(r['playlist'], d.playlist),
    playlistSubfolder: boolOr(r['playlistSubfolder'], d.playlistSubfolder),
    subtitles: boolOr(r['subtitles'], d.subtitles),
    subLangs: textOr(r['subLangs'], d.subLangs, 100),
    embedThumbnail: boolOr(r['embedThumbnail'], d.embedThumbnail),
    embedMetadata: boolOr(r['embedMetadata'], d.embedMetadata),
    // never kept: overwriting and reading the browser's cookies are chosen each time
    overwrite: false,
    cookiesBrowser: null,
  };
}

/** What is kept of a form: everything but `overwrite` and the cookies choice. */
export function rememberedForm(o: DownloadOptions): DownloadOptions {
  return { ...o, overwrite: false, cookiesBrowser: null };
}

/** `en`, `de,en`, `en.*,-live_chat` (= Rust `sub_langs_ok`). */
export function subLangsOk(s: string): boolean {
  return s !== '' && s.length <= 100 && !s.startsWith(',') && /^[A-Za-z0-9.*_,-]+$/.test(s);
}

// ---- target ----

/** Why a side cannot take a download. */
export type TargetBlock = 'noFolder' | 'result' | 'archive' | 'server';

/** What a side shows (read from its panel store). */
export interface SideView {
  readonly path: string | null;
  readonly result: boolean;
  readonly archive: boolean;
  readonly remote: boolean;
  readonly tabId: string;
}

export interface TargetChoice {
  readonly side: Side;
  /** The folder of the active tab; `null` when the side shows none. */
  readonly path: string | null;
  readonly tabId: string;
  readonly active: boolean;
  readonly blocked: TargetBlock | null;
}

export function targetBlock(v: SideView): TargetBlock | null {
  if (v.result) {
    return 'result';
  }
  if (v.archive) {
    return 'archive';
  }
  if (v.remote) {
    return 'server';
  }
  return v.path === null ? 'noFolder' : null;
}

/** The two entries of the target select: left, then right (design 078 E-b). */
export function targetChoices(
  views: Readonly<Record<Side, SideView | null>>,
  active: Side,
): readonly TargetChoice[] {
  return (['left', 'right'] as const).map((side) => {
    const v = views[side];
    const blocked = v ? targetBlock(v) : 'noFolder';
    return {
      side,
      path: v && blocked === null ? v.path : null,
      tabId: v?.tabId ?? '',
      active: side === active,
      blocked,
    };
  });
}

/** The side chosen when the dialog opens: the other panel (like F5), else the active one. */
export function defaultTarget(choices: readonly TargetChoice[]): Side | null {
  const free = choices.filter((c) => c.blocked === null);
  return (free.find((c) => !c.active) ?? free[0])?.side ?? null;
}

/** `/Users/…/Filme.nosync` – cut in the middle; the path stays opaque (never split). */
export function shortenMiddle(text: string, max = 56): string {
  const chars = [...text];
  if (chars.length <= max) {
    return text;
  }
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}

// ---- clipboard ----

export const MAX_PASTED_URLS = 200;

/** The lines of a clipboard text that look like http(s) addresses; nothing else is taken. */
export function clipboardUrls(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (
      line.length <= 2048 &&
      /^https?:\/\/\S+$/i.test(line) &&
      !out.includes(line) &&
      out.length < MAX_PASTED_URLS
    ) {
      out.push(line);
    }
  }
  return out;
}

/** `text` with `urls` appended, one per line, skipping the ones already there. */
export function appendUrls(text: string, urls: readonly string[]): { text: string; added: number } {
  const have = new Set(text.split('\n').map((l) => l.trim()));
  const fresh = urls.filter((u) => !have.has(u));
  if (fresh.length === 0) {
    return { text, added: 0 };
  }
  const base = text.trim() === '' ? '' : text.replace(/\s*$/, '\n');
  return { text: `${base}${fresh.join('\n')}\n`, added: fresh.length };
}
