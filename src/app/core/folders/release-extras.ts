/**
 * What a scene release leaves behind next to the film (design 045 E4, 077 E4) – the one
 * source for "clean folders" (profile "release leftovers") and "group series by season".
 *
 * Narrow on purpose (review 077 #1): the profile is preselected-and-Enter away from the
 * trash, so every pattern must be something only a release produces. Deliberately not in
 * here: `*.url` (browser favourites), images in general (`*.jpg`, `*.png` – photo folders;
 * only `*-proof.*` pictures), subtitles, archive parts (`*.rar`, `*.r00` – large and not to
 * be had again), and "sample" in the name of anything but a video (`sample-contract.docx`,
 * `config.sample.json`). The folder name `Sample` alone makes nothing an extra.
 */
export const RELEASE_EXTRAS: readonly string[] = [
  '*.nfo',
  '*.sfv',
  '*.srr',
  '*.md5',
  '*-proof.jpg',
  '*-proof.jpeg',
  '*-proof.png',
];

/** Video endings a sample may have. */
export const VIDEO_EXTENSIONS: readonly string[] = [
  'mkv',
  'mp4',
  'avi',
  'm4v',
  'mov',
  'wmv',
  'ts',
  'mpg',
  'mpeg',
  'webm',
];

/** How a sample is named, without the ending. */
export const SAMPLE_SHAPES: readonly string[] = ['*-sample', '*.sample', 'sample-*', 'sample'];

/**
 * Sample patterns: samples are big, so they get the generous size limit – one pattern per
 * shape and video ending (the pattern language knows only `*` and `?`).
 */
export const RELEASE_SAMPLES: readonly string[] = VIDEO_EXTENSIONS.flatMap((ext) =>
  SAMPLE_SHAPES.map((shape) => `${shape}.${ext}`),
);
