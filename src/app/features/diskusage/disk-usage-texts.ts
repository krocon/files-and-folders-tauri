import { translatable } from '../../core/i18n/i18n';
import { formatCount } from '../../shared/format';
import { USAGE_DE } from './disk-usage-texts.de';

/** Texts of the disk-usage view (design 033); German in `disk-usage-texts.de.ts`. */
export const USAGE_EN = {
  header: 'Disk usage',
  tabLabel: (name: string) => `Disk usage: ${name}`,
  selection: 'Selection',
  headerTitle: 'Disk usage – Enter opens a folder, Backspace goes up, F8 removes',
  objects: (n: number) => (n === 1 ? '1 object' : `${formatCount(n)} objects`),
  scanning: (entries: number, size: string) => `scanning… ${formatCount(entries)} entries, ${size}`,
  scanned: (entries: number, seconds: string) => `${formatCount(entries)} entries in ${seconds} s`,
  asOf: (time: string) => `as of ${time}`,
  incomplete: 'incomplete (stopped)',
  unreadable: (n: number) => (n === 1 ? '1 not readable' : `${formatCount(n)} not readable`),
  simplified: 'simplified (very many entries)',
  stop: 'Stop',
  rescan: 'Scan again',
  rescanTitle: 'Scans the shown folder again (Ctrl/⌘+R)',
  everything: 'Everything',
  largest: 'Largest files',
  smallFiles: (n: number) => (n === 1 ? '1 smaller file' : `${formatCount(n)} smaller files`),
  rest: (n: number) => (n === 1 ? '1 smaller entry' : `${formatCount(n)} smaller entries`),
  shareColumn: 'Share',
  itemsColumn: 'Objects',
  // chart
  chartLabel: 'Chart',
  sunburst: 'Rings',
  treemap: 'Tiles',
  chartAria: (name: string, parts: string) => `Disk usage of ${name}: ${parts}`,
  up: 'Up one level',
  tipSize: (allocated: string, logical: string) => `${allocated} on disk · ${logical} size`,
  tipShare: (pct: string) => `${pct} of the shown folder`,
  tipObjects: (files: number, dirs: number) =>
    `${files === 1 ? '1 file' : `${formatCount(files)} files`}, ${dirs === 1 ? '1 folder' : `${formatCount(dirs)} folders`}`,
  mountNote: 'other drive – not scanned',
  unreadableNote: 'could not be read',
  // basket
  basketTitle: 'Marked for removal',
  basketEmpty: 'Mark entries with Space or Insert – across all folders – to collect them here.',
  basketSum: (n: number, size: string) =>
    `${n === 1 ? '1 entry' : `${formatCount(n)} entries`} · ${size}`,
  remove: 'Remove…',
  basketRemoving: (n: number) => (n === 1 ? '1 being removed' : `${formatCount(n)} being removed`),
  removeTitle: 'Moves the marked entries to the trash (F8; Shift+F8 deletes permanently)',
  clear: 'Unmark all',
  unmark: (name: string) => `Unmark ${name}`,
  inMarkedFolder: 'in a marked folder',
  // volume
  volumeUsed: 'scanned',
  volumeUncounted: 'not counted',
  volumeFree: 'free',
  volumeTitle: (scanned: string, uncounted: string, free: string, total: string) =>
    `${scanned} scanned · ${uncounted} not counted (no access, snapshots, system) · ${free} free of ${total}`,
  // messages
  noFolder: 'Mark folders or put the cursor on a folder.',
  filesIgnored: 'Marked files are left out – only folders are scanned.',
  notInArchive: 'Disk usage works on real folders, not inside an archive.',
  notInResult: 'Not in a result tab – open a folder first.',
  notHere: 'Not in the disk usage view.',
  network: 'Network drive – the scan may take a while.',
  tooManyTabs: 'Too many tabs – close one first.',
  mountNotScanned: 'This is another drive – it was not scanned. Scan it on its own.',
  unreadableFolder: 'This folder could not be read.',
  scanAge: (minutes: number) =>
    minutes < 1
      ? 'The scan is less than a minute old.'
      : `The scan is ${formatCount(minutes)} ${minutes === 1 ? 'minute' : 'minutes'} old – folders may have changed since.`,
  cancelled: 'The scan was stopped before it started.',
};

export const USAGE_TEXTS = translatable('diskUsage', USAGE_EN, { de: USAGE_DE });
