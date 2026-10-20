import { formatCount, formatSize } from '../../shared/format';
import { translatable } from '../../core/i18n/i18n';
import { PV_DE } from './preview-texts.de';

/** Texts of the viewer, quick view and properties (central, i18n in 015). */
export const PV_EN = {
  viewTitle: (name: string) => `View – ${name}`,
  propertiesTitle: (name: string) => `Properties – ${name}`,
  position: (i: number, n: number) => `${i} / ${n}`,
  previous: 'Previous file (←)',
  next: 'Next file (→)',
  encoding: 'Encoding',
  auto: (detected: string | null) => (detected ? `Auto (${detected})` : 'Auto'),
  mode: 'Show as',
  modes: { auto: 'Automatic', text: 'Text', hex: 'Hex' } as const,
  wrap: 'Wrap lines',
  find: 'Find',
  findPlaceholder: 'Find in text',
  findPrev: 'Previous match (Shift+Enter)',
  findNext: 'Next match (Enter)',
  matches: (current: number, count: number, capped: boolean) =>
    count === 0 ? 'No matches' : `${current} / ${count}${capped ? '+' : ''}`,
  fit: 'Fit',
  actual: '100 %',
  zoomIn: 'Zoom in (+)',
  zoomOut: 'Zoom out (−)',
  close: 'Close',
  loading: 'Loading…',
  noFile: 'Place the cursor on a file to view it.',
  noFolder: 'Folders cannot be viewed – use Properties (Alt+Enter).',
  folder: 'Folder',
  other: 'Special file (device, pipe or socket) – not opened.',
  quickViewLabel: 'Quick view',
  quickViewEmpty: 'No file under the cursor.',
  mismatch: (label: string, ext: string | null) =>
    ext ? `Content is ${label}, although the extension says .${ext}` : `Content is ${label}`,
  truncated: (shown: number, total: number) =>
    `Showing the first ${formatSize(shown)} of ${formatSize(total)}`,
  lossy: 'Some bytes are not valid in this encoding (shown as �).',
  imageSize: (w: number, h: number) => `${w} × ${h} px`,
  imageFailed: 'The image could not be shown.',
  // properties
  name: 'Name',
  path: 'Path',
  type: 'Type',
  size: 'Size',
  bytes: (n: number) => `${formatCount(n)} bytes`,
  created: 'Created',
  modified: 'Modified',
  accessed: 'Accessed',
  permissions: 'Permissions',
  owner: 'Owner',
  attributes: 'Attributes',
  linkTarget: 'Link target',
  dangling: '(target missing)',
  readonly: 'Read-only',
  hidden: 'Hidden',
  system: 'System',
  archive: 'Archive',
  yes: 'yes',
  no: 'no',
  unknown: '–',
  calcSize: 'Calculate',
  calculating: 'Calculating…',
  cancel: 'Cancel',
  dirSize: (bytes: number, files: number, dirs: number, unreadable: number) =>
    `${formatSize(bytes)} (${formatCount(bytes)} bytes) in ${files} files, ${dirs} folders` +
    (unreadable ? `, ${unreadable} unreadable` : ''),
  kinds: {
    file: 'File',
    directory: 'Folder',
    symlink: 'Symbolic link',
    unknown: 'Unknown',
  } as const,
  changeAttributes: 'Change…',
  changeAttributesHint: 'Change permissions, attributes and times (design 024)',
} as const;

export const PV_TEXTS = translatable('preview', PV_EN, { de: PV_DE });
