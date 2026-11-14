import { translatable } from '../../core/i18n/i18n';
import { formatCount } from '../../shared/format';
import { IMAGE_OVERVIEW_DE } from './image-overview-texts.de';

const images = (n: number) => (n === 1 ? '1 image' : `${formatCount(n)} images`);

/** Texts of the image overview (design 074). */
export const IMAGE_OVERVIEW_EN = {
  region: 'Image overview',
  gridLabel: (folder: string) => `Images in ${folder}`,
  back: 'Close',
  backTitle: 'Back to the panels (Mod+Shift+I or Esc)',
  tree: 'Folder tree',
  treeTitle: 'Show or hide the folder tree',
  treeLabel: 'Folders',
  treeResize: 'Width of the folder tree',
  up: 'Parent folder',
  subfolders: 'Include subfolders',
  sortLabel: 'Order',
  sorts: { name: 'Name', date: 'Date', size: 'Size', type: 'Type' } as Readonly<
    Record<string, string>
  >,
  filter: 'Filter',
  filterPlaceholder: 'Name contains…',
  clearFilter: 'Clear the filter',
  sizeLabel: 'Tile size',
  smaller: 'Smaller tiles (Mod+-)',
  larger: 'Larger tiles (Mod+=)',
  count: (shown: number, total: number, size: string) =>
    shown === total ? `${images(total)} (${size})` : `${formatCount(shown)} of ${images(total)}`,
  marked: (n: number, size: string) => `${formatCount(n)} marked (${size})`,
  focused: (name: string, i: number, n: number, marked: boolean) =>
    `${name}, ${formatCount(i)} of ${formatCount(n)}${marked ? ', marked' : ''}`,
  loading: 'Looking for images…',
  empty: 'No images in this folder.',
  emptyRecursive: 'No images in this folder or below it.',
  emptyFilter: 'No image matches the filter.',
  truncated: (n: number) => `only the first ${images(n)} – limit`,
  unreadable: (n: number) =>
    n === 1 ? '1 folder could not be read' : `${formatCount(n)} folders could not be read`,
  failed: (why: string) => `The folder cannot be shown: ${why}`,
  notLocal: 'The image overview works on local folders only.',
  notHere: 'Not available in the image overview',
  noPreview: 'no preview',
  largeLabel: (name: string) => `Image ${name}`,
  close: 'Close (Esc)',
  modeWindow: 'In the window',
  modeScreen: 'Whole screen',
  toggleMode: 'Window or whole screen (F)',
  fit: 'Fit (Z)',
  actual: '100 % (Z)',
  previous: 'Previous image (←)',
  next: 'Next image (→)',
  position: (i: number, n: number) => `${formatCount(i)} / ${formatCount(n)}`,
  cannotShow: 'This image cannot be shown.',
  dimensions: (w: number, h: number) => `${formatCount(w)} × ${formatCount(h)}`,
};

export const IMAGE_OVERVIEW_TEXTS = translatable('imageOverview', IMAGE_OVERVIEW_EN, {
  de: IMAGE_OVERVIEW_DE,
});
