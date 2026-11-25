/**
 * What a scene release leaves behind next to the film (design 045 E4, 077 E4) – the one
 * source for "clean folders" (profile "release leftovers") and "group series by season".
 *
 * Deliberately not in here: images in general (`*.jpg`, `*.png` – photo folders),
 * subtitles, archive parts (`*.rar`, `*.r00` – large and not to be had again).
 */
export const RELEASE_EXTRAS: readonly string[] = [
  '*.nfo',
  '*.sfv',
  '*.srr',
  '*.md5',
  '*.url',
  '*-proof.*',
];

/** Sample patterns: samples are big, so they get the generous size limit. */
export const RELEASE_SAMPLES: readonly string[] = [
  '*-sample.*',
  '*.sample.*',
  'sample-*',
  'sample.*',
];
