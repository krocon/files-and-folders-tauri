/**
 * What a scene release leaves behind next to the film (design 045 E4, 077 E4) – the one
 * source for "clean folders" (profile "release leftovers") and "group series by season".
 *
 * Narrow on purpose (review 077 #1): the profile is preselected-and-Enter away from the
 * trash, so every pattern must be something only a release produces. Deliberately not in
 * here: `*.url` (browser favourites), images in general (`*.jpg`, `*.png` – photo folders;
 * only `*-proof.*` pictures), subtitles (they are companions, see `RELEASE_SUBTITLES`), archive
 * parts (`*.rar`, `*.r00` – large and not to be had again), and "sample" in the name of
 * anything but a video (`sample-contract.docx`, `config.sample.json`). The folder name
 * `Sample` alone makes nothing an extra – and neither does `Subs`.
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

/**
 * Subtitles – **companions**, not extras (addendum 26.11.2026 of design 077): VobSub
 * (`.idx` + `.sub`), SubRip, SSA/ASS, PGS (`.sup`), WebVTT. On their own they are content
 * (a subtitle collection, a folder of `.idx` files), and next to a film they are content.
 * Rust (`CleanOptions.companionJunk`) takes them as extras only where a start folder goes as
 * a whole **and** holds at least one real extra from the lists above – then they are what
 * the release left behind with its sample and `.nfo`. Size limit: fixed in Rust
 * (`COMPANION_MAX_BYTES`, 64 MiB – a VobSub has some 10 MB per language), no form field.
 * Not in here: packed subtitles (`Subs/*.rar` – archives, see above).
 */
export const RELEASE_SUBTITLES: readonly string[] = [
  '*.idx',
  '*.sub',
  '*.srt',
  '*.ass',
  '*.ssa',
  '*.sup',
  '*.vtt',
];
