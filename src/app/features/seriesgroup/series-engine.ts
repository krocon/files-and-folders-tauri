import { TreeFile } from '../../core/folders/folders.models';
import { boolOr, record, textOr } from '../../shared/restore-fields';
import { checkGroupName } from '../groupfiles/group-engine';

/**
 * Group series by season (design 045 E2): which files are episodes, their season
 * and episode, the season folder and the status of every file. Pure, no Angular –
 * the dialog previews without IPC; Rust checks the folder names and runs the
 * `group` job.
 */

export interface SeriesOptions {
  /** Season folder name: `{n}` = number, `{nn}` = at least two digits (design 045 E5). */
  readonly template: string;
  /** Video endings, `;`-separated (`.mkv; .mp4` – the dot is optional). */
  readonly videos: string;
  /** Name patterns (`*`, `?`) of extras that are ignored, `;`-separated. */
  readonly junk: string;
  /** Folder names (or patterns) whose files are ignored (`Sample`). */
  readonly junkDirs: string;
  /** Subtitles go along with the episodes. */
  readonly subtitles: boolean;
  /** The other side's folder is the root (default: the source folder). */
  readonly otherSide: boolean;
  /** The preview lists the ignored files, too. */
  readonly showIgnored: boolean;
  /** After a move: open "clean folders" for the release folders (design 045 E4). */
  readonly cleanup: boolean;
}

export const TEMPLATES: readonly string[] = ['S{nn}', 'Staffel {n}', 'Season {nn}', 'Season {n}'];

export const DEFAULT_VIDEOS =
  '.mkv; .mp4; .avi; .m4v; .mov; .wmv; .ts; .m2ts; .mpg; .mpeg; .webm; .flv; .divx; .ogm';
export const SUBTITLES: readonly string[] = ['.srt', '.sub', '.idx', '.ass', '.ssa', '.vtt'];
export const DEFAULT_JUNK =
  '*.nfo; *.sfv; *.srr; *.md5; *.txt; *.url; *.jpg; *.jpeg; *.png; *-sample.*; *.sample.*; sample-*; sample.*';
export const DEFAULT_JUNK_DIRS = 'Sample; Samples; Proof';

export const DEFAULT_SERIES_OPTIONS: SeriesOptions = {
  template: 'S{nn}',
  videos: DEFAULT_VIDEOS,
  junk: DEFAULT_JUNK,
  junkDirs: DEFAULT_JUNK_DIRS,
  subtitles: false,
  otherSide: false,
  showIgnored: true,
  cleanup: false,
};

/** Options kept from the last run (design 027 E5): every field checked, else the default. */
export function restoreSeriesOptions(v: unknown): SeriesOptions {
  const r = record(v);
  const d = DEFAULT_SERIES_OPTIONS;
  return {
    template: textOr(r['template'], d.template, 255),
    videos: textOr(r['videos'], d.videos),
    junk: textOr(r['junk'], d.junk),
    junkDirs: textOr(r['junkDirs'], d.junkDirs),
    subtitles: boolOr(r['subtitles'], d.subtitles),
    otherSide: boolOr(r['otherSide'], d.otherSide),
    showIgnored: boolOr(r['showIgnored'], d.showIgnored),
    cleanup: boolOr(r['cleanup'], d.cleanup),
  };
}

export interface Episode {
  readonly season: number;
  readonly first: number;
  /** = `first`, or the last episode of a double episode (`S01E01E02`). */
  readonly last: number;
  /** Normalized text before the match (`die kirche bleibt im dorf`), may be empty. */
  readonly series: string;
}

const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const PATTERNS: readonly RegExp[] = [
  // S01E01, s1e1, S01.E01, S01_E01, S01 E01; double: S01E01E02, S01E01-E02, S01E01-02
  new RegExp(`${B}s(\\d{1,4})[ ._-]?e(\\d{1,4})(?:(?:[ ._-]?e|-)(\\d{1,4}))?${E}`, 'iu'),
  // 1x01
  new RegExp(`${B}(\\d{1,2})x(\\d{2,3})${E}`, 'iu'),
  // Staffel 2 Folge 5, Season 1 Episode 10 (up to three words between)
  new RegExp(
    `${B}(?:staffel|season)[ ._-]*(\\d{1,4})(?:[ ._-]+\\p{L}+){0,3}?[ ._-]+(?:folge|episode|ep\\.?)[ ._-]*(\\d{1,4})(?!\\p{N})`,
    'iu',
  ),
];

function seriesName(prefix: string): string {
  return prefix
    .replace(/[._]+/g, ' ')
    .replace(/[\s-]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Season and episode in a name – the earliest match of all patterns wins. */
export function parseEpisode(name: string): Episode | null {
  let best: RegExpExecArray | null = null;
  for (const re of PATTERNS) {
    const m = re.exec(name);
    if (m && (best === null || m.index < best.index)) {
      best = m;
    }
  }
  if (best === null) {
    return null;
  }
  const season = Number(best[1]);
  const first = Number(best[2]);
  const end = best[3] !== undefined ? Number(best[3]) : first;
  // `S01E05-2019` is no double episode: only a short run upwards counts
  const last = end > first && end - first <= 9 ? end : first;
  return { season, first, last, series: seriesName(name.slice(0, best.index)) };
}

/** The season folder for `template`, `null` without `{n}`/`{nn}` (design 045 E5). */
export function seasonFolder(template: string, season: number): string | null {
  if (!template.includes('{n}') && !template.includes('{nn}')) {
    return null;
  }
  return template
    .replaceAll('{nn}', String(season).padStart(2, '0'))
    .replaceAll('{n}', String(season))
    .trim();
}

/** `a; b ;; c` → `['a', 'b', 'c']`. */
export function splitList(text: string): string[] {
  return text
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** Name patterns as in Rust `clean.rs`: `*`, `?`, else exact; without case. */
export function nameMatcher(list: string): (name: string) => boolean {
  const res = splitList(list).map(
    (p) => new RegExp(`^${escapeRe(p).replaceAll('*', '.*').replaceAll('?', '.')}$`, 'iu'),
  );
  return (name) => res.some((re) => re.test(name));
}

function extensions(list: string): Set<string> {
  return new Set(splitList(list).map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase()));
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}

export type SeriesStatus = 'ok' | 'inPlace' | 'ignored' | 'unrecognized' | 'invalid';
export type IgnoreReason = 'junkDir' | 'junk' | 'notVideo';

export interface SeriesRow {
  readonly file: TreeFile;
  readonly status: SeriesStatus;
  readonly reason: IgnoreReason | null;
  /** The folder that made the file an extra (`junkDir`). */
  readonly reasonName: string | null;
  readonly episode: Episode | null;
  /** The season folder (ok, inPlace, invalid). */
  readonly folder: string | null;
  readonly subtitle: boolean;
  /** Another video row has the same season and episode. */
  readonly duplicate: boolean;
  /** Why the folder name is invalid. */
  readonly error: string | null;
}

export interface SeasonCount {
  readonly season: number;
  readonly folder: string;
  readonly count: number;
}

export interface SeriesPlan {
  readonly rows: readonly SeriesRow[];
  /** Rows to run (status ok), per season folder, by season. */
  readonly seasons: readonly SeasonCount[];
  /** Missing episodes per season (only between 1 and the highest one found). */
  readonly gaps: readonly { readonly folder: string; readonly missing: readonly number[] }[];
  /** More than one name → the folder holds several series (a hint). */
  readonly seriesNames: readonly string[];
  /** The template has no `{n}`/`{nn}`. */
  readonly templateInvalid: boolean;
}

function episodeOf(file: TreeFile): Episode | null {
  const own = parseEpisode(file.name);
  if (own) {
    return own;
  }
  // from the folders, innermost first (the release folder)
  for (let i = file.dirs.length - 1; i >= 0; i--) {
    const e = parseEpisode(file.dirs[i]);
    if (e) {
      return e;
    }
  }
  return null;
}

/**
 * The plan for `files` (design 045 E2). `sameRoot` = the season folders go into
 * the folder that was scanned (then a file in its season folder is `inPlace`).
 */
export function planSeries(
  files: readonly TreeFile[],
  o: SeriesOptions,
  sameRoot: boolean,
): SeriesPlan {
  const isJunkDir = nameMatcher(o.junkDirs);
  const isJunk = nameMatcher(o.junk);
  const videos = extensions(o.videos);
  const subtitles = new Set(SUBTITLES);
  const templateInvalid = seasonFolder(o.template, 1) === null;
  const rows: SeriesRow[] = files.map((file) => {
    const base = {
      file,
      reasonName: null,
      episode: null,
      folder: null,
      subtitle: false,
      duplicate: false,
      error: null,
    };
    const junkDir = file.dirs.find(isJunkDir);
    if (junkDir !== undefined) {
      return { ...base, status: 'ignored', reason: 'junkDir', reasonName: junkDir };
    }
    if (isJunk(file.name)) {
      return { ...base, status: 'ignored', reason: 'junk' };
    }
    const ext = extOf(file.name);
    const subtitle = !videos.has(ext) && o.subtitles && subtitles.has(ext);
    if (!videos.has(ext) && !subtitle) {
      return { ...base, status: 'ignored', reason: 'notVideo' };
    }
    const episode = episodeOf(file);
    if (episode === null) {
      return { ...base, subtitle, status: 'unrecognized', reason: null };
    }
    const folder = seasonFolder(o.template, episode.season);
    const error = folder === null ? null : checkGroupName(folder);
    if (folder === null || folder === '' || error !== null) {
      return { ...base, subtitle, episode, folder, status: 'invalid', reason: null, error };
    }
    const inPlace =
      sameRoot &&
      file.dirs.length === 1 &&
      file.dirs[0].toLocaleLowerCase() === folder.toLocaleLowerCase();
    return { ...base, subtitle, episode, folder, status: inPlace ? 'inPlace' : 'ok', reason: null };
  });

  // duplicates: the same episode twice among the videos to run or already in place
  const seen = new Map<string, number>();
  const key = (r: SeriesRow, ep: number) => `${r.episode!.season}:${ep}`;
  const videoRows = rows.filter(
    (r) => (r.status === 'ok' || r.status === 'inPlace') && !r.subtitle,
  );
  for (const r of videoRows) {
    for (let ep = r.episode!.first; ep <= r.episode!.last; ep++) {
      seen.set(key(r, ep), (seen.get(key(r, ep)) ?? 0) + 1);
    }
  }
  const marked = rows.map((r) => {
    if (!videoRows.includes(r)) {
      return r;
    }
    let dup = false;
    for (let ep = r.episode!.first; ep <= r.episode!.last; ep++) {
      dup ||= (seen.get(key(r, ep)) ?? 0) > 1;
    }
    return dup ? { ...r, duplicate: true } : r;
  });

  const bySeason = new Map<number, SeasonCount>();
  for (const r of marked) {
    if (r.status === 'ok') {
      const s = r.episode!.season;
      const c = bySeason.get(s);
      bySeason.set(s, { season: s, folder: r.folder!, count: (c?.count ?? 0) + 1 });
    }
  }
  const seasons = [...bySeason.values()].sort((a, b) => a.season - b.season);

  const episodesBySeason = new Map<number, Set<number>>();
  for (const r of videoRows) {
    const set = episodesBySeason.get(r.episode!.season) ?? new Set<number>();
    for (let ep = r.episode!.first; ep <= r.episode!.last; ep++) {
      set.add(ep);
    }
    episodesBySeason.set(r.episode!.season, set);
  }
  const gaps = [...episodesBySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, eps]) => {
      const max = Math.max(...eps);
      const missing: number[] = [];
      for (let ep = 1; ep < max && missing.length < 20; ep++) {
        if (!eps.has(ep)) {
          missing.push(ep);
        }
      }
      return { folder: seasonFolder(o.template, season) ?? String(season), missing };
    })
    .filter((g) => g.missing.length > 0);

  const seriesNames = [
    ...new Set(videoRows.map((r) => r.episode!.series).filter((n) => n !== '')),
  ].sort();

  return { rows: marked, seasons, gaps, seriesNames, templateInvalid };
}

/** Matches every folder name the template can produce (`S{nn}` → `S01`, `S100`). */
export function templateMatcher(template: string): (name: string) => boolean {
  const t = template.trim();
  if (seasonFolder(t, 1) === null) {
    return () => false;
  }
  const re = new RegExp(
    `^${t
      .split(/(\{nn\}|\{n\})/)
      .map((part) =>
        part === '{n}' || part === '{nn}' ? '\\d+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      )
      .join('')}$`,
    'iu',
  );
  return (name) => re.test(name);
}

/**
 * Start folders for "clean folders" after a move (design 045 E4): the distinct
 * first folders below the root of the rows that really moved – never a season
 * folder (any name the template can produce), never the root itself.
 */
export function cleanupRoots(
  rows: readonly SeriesRow[],
  failed: ReadonlySet<string>,
  template: string,
): string[] {
  const isSeason = templateMatcher(template);
  const tops = new Set<string>();
  for (const r of rows) {
    const f = r.file;
    if (
      r.status === 'ok' &&
      !failed.has(f.path) &&
      f.top !== null &&
      f.dirs.length > 0 &&
      !isSeason(f.dirs[0])
    ) {
      tops.add(f.top);
    }
  }
  return [...tops];
}
