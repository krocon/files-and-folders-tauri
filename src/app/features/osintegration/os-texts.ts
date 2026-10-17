import { formatSize } from '../../shared/format';
import { Volume } from '../../core/os/os.models';

/** Texts of design 011 (central for prompt 015). */
export const OS_TEXTS = {
  drives: 'Drives',
  readingDrives: 'Reading drives…',
  noDrives: '(none found)',
  notReachable: 'not reachable',
  nothingSelected: 'Nothing selected – mark entries or put the cursor on one.',
  noFolder: 'This panel shows no folder.',
  noEditTool: 'No tool "edit" is configured (tools.json).',
  copied: (n: number, what: 'names' | 'paths', json: boolean) =>
    `${n} ${what === 'names' ? (n === 1 ? 'name' : 'names') : n === 1 ? 'path' : 'paths'} copied${json ? ' as JSON' : ''}.`,
  toolStarted: (label: string, n: number) =>
    n === 1 ? `${label} started.` : `${label} started ${n} times.`,
  toolsHeading: 'Tools',
  toolsPalette: 'Open with tool',
  configTitle: 'Tool configuration',
  configIntro:
    'Tools are configured in a JSON file (program + argument list, placeholders {file}, {files}, {name}, {dir}, {targetDir} per argument; nothing goes through a shell). Entries in the old files-and-folders format (cmd, para, $file, $dir) are converted when loading.',
  configFile: 'File',
  configNoFile: '(app config folder not available)',
  openFile: 'Open tools.json',
  reload: 'Reload',
  close: 'Close',
  warnings: 'Problems',
  perFile: (limit: number) => `one start per entry, max. ${limit}`,
  allFiles: (limit: number) => `all entries in one start, max. ${limit}`,
  noFiles: 'no entries needed',
  reloaded: (n: number) => `${n} ${n === 1 ? 'tool' : 'tools'} loaded.`,
};

/** `ext4 · 12.0 GB free of 252 GB` / `nfs4 · not reachable`. */
export function volumeDetail(v: Volume): string {
  const parts: string[] = [];
  if (v.fsType) {
    parts.push(v.fsType);
  }
  if (!v.reachable) {
    parts.push(OS_TEXTS.notReachable);
  } else if (v.total !== null && v.free !== null) {
    parts.push(`${formatSize(v.free)} free of ${formatSize(v.total)}`);
  }
  return parts.join(' · ');
}

/** One line of the folder menu: label, path when it differs, details. */
export function volumeLabel(v: Volume): string {
  const detail = volumeDetail(v);
  const name = v.label === v.path ? v.label : `${v.label} – ${v.path}`;
  return detail ? `${name}  (${detail})` : name;
}
