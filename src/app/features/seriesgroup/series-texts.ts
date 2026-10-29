import { translatable } from '../../core/i18n/i18n';
import type { SeriesTarget } from './series-engine';
import { SG_DE } from './series-texts.de';

const files = (n: number) => (n === 1 ? '1 file' : `${n} files`);
const episodes = (n: number) => (n === 1 ? '1 episode' : `${n} episodes`);
const seasons = (n: number) => (n === 1 ? '1 season' : `${n} seasons`);

/** Texts of the dialog "Group series by season" (design 045). */
export const SG_EN = {
  title: (n: number, s: number) => `Group series by season – ${episodes(n)} in ${seasons(s)}`,
  titleScanning: 'Group series by season',
  template: 'Folder name',
  custom: 'Own template…',
  customTemplate: 'Template ({n} = 1, {nn} = 01)',
  target: 'Target',
  targets: {
    other: 'Folder of the other side',
    source: 'The series folder itself',
    otherSeries: 'Other side + a folder named like the series',
  } satisfies Record<SeriesTarget, string>,
  blockedMixed:
    'Several series would mix in the same season folders – choose "Other side + a folder named like the series" or "The series folder itself".',
  blockedSeriesName: (name: string, why: string) => `"${name}" cannot be a folder name: ${why}`,
  seriesCount: (n: number) => `${n} series folders`,
  noOtherPanel: '(the other side shows no folder)',
  subtitles: 'Subtitles go along',
  showIgnored: 'Show ignored files',
  videos: 'Videos',
  junk: 'Extras (ignored)',
  junkDirs: 'Folders',
  cleanup: 'After moving, clean the release folders (trash, with preview)',
  preview: 'Preview',
  scanning: 'Collecting files …',
  colNr: 'Nr.',
  colSource: 'Source',
  colSeason: 'Season',
  colEpisode: 'Episode',
  colTarget: 'Target',
  colInfo: 'Info',
  infoOk: 'OK',
  infoSubtitle: 'subtitle',
  infoInPlace: 'already in its season folder',
  infoCopied: (folder: string) => `already in ${folder}`,
  infoUnrecognized: 'no season/episode found',
  infoJunkDir: (name: string) => `in folder ${name}`,
  infoJunk: 'extra',
  infoNotVideo: 'no video',
  infoDuplicate: 'episode twice',
  infoInvalid: (why: string) => `invalid folder name: ${why}`,
  templateInvalid: 'The template needs {n} or {nn}.',
  summary: (perSeason: string, ok: number, ignored: number, other: number) =>
    `${perSeason}${perSeason ? ' — ' : ''}${ok} to group, ${ignored} ignored, ${other} other`,
  hintGaps: (list: string) => `Missing episodes: ${list}`,
  hintSeries: (names: string) => `Several series in this folder: ${names}`,
  hintDuplicates: (n: number) => `${episodes(n)} found twice (all are taken along)`,
  hintTruncated: 'Not everything was read (too many files or folders).',
  hintUnreadable: (n: number) => `${n === 1 ? '1 folder' : `${n} folders`} could not be read.`,
  cancel: 'Cancel',
  copy: 'Copy',
  move: 'Move',
  noFolder: 'This side shows no local folder',
  failed: (msg: string) => `Grouping the series failed: ${msg}`,
  withErrors: (n: number) => `Series grouped – ${files(n)} failed`,
  done: (n: number) => `Series grouped: ${files(n)}`,
};

export const SG_TEXTS = translatable('seriesgroup', SG_EN, { de: SG_DE });
