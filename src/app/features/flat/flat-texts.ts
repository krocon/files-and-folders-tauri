import { formatCount } from '../../shared/format';
import { translatable } from '../../core/i18n/i18n';
import { FLAT_DE } from './flat-texts.de';

/** Texts of the flat view (design 038). */
export const FLAT_EN = {
  header: (folder: string) => `Flat view: ${folder}`,
  headerTitle: (root: string) => `All files below ${root} – Mod+B: back to the normal view`,
  tabTitle: (path: string) => `Flat view: ${path}`,
  entries: (n: number) => (n === 1 ? '1 entry' : `${formatCount(n)} entries`),
  listing: 'Listing…',
  refreshing: 'Updating…',
  truncated: (n: number) => `limit ${formatCount(n)} – incomplete`,
  cancelled: 'stopped – incomplete',
  showDirs: 'Show folders',
  normalView: 'Normal view',
  finished: (n: number) => `Flat view: ${n === 1 ? '1 entry' : `${formatCount(n)} entries`}`,
  finishedTruncated: (n: number) =>
    `Flat view: ${n === 1 ? '1 entry' : `${formatCount(n)} entries`} – list incomplete (limit)`,
  pathColumn: 'Path',
  notHere: 'The flat view needs a local folder',
};

export const FLAT_TEXTS = translatable('flat', FLAT_EN, { de: FLAT_DE });
