import { DirEntry, EntryKind, VIRTUAL_PATH_PREFIX } from '../../core/fs/fs.models';
import {
  DiskUsageView,
  SizeMode,
  sizeOf,
  UsageFile,
  UsageKind,
  UsageNode,
} from '../../core/diskusage/disk-usage.models';

/**
 * Rows of the disk-usage tab (design 033 E1): the children of the shown node as
 * entries of the normal file list, with what the share/objects columns need.
 * Aggregates ("12 smaller files") are display-only rows with a virtual path.
 */

/** Prefix of the result key of a disk-usage tab (`usage:<scanId>`). */
export const USAGE_KEY_PREFIX = 'usage:';

export function usageKey(scanId: string): string {
  return `${USAGE_KEY_PREFIX}${scanId}`;
}

export function isUsageKey(key: string | null | undefined): key is string {
  return key != null && key.startsWith(USAGE_KEY_PREFIX);
}

export function scanIdOf(key: string): string {
  return key.slice(USAGE_KEY_PREFIX.length);
}

/** Virtual paths begin with NUL – never a real path, never sent to Rust (`isVirtualPath`). */
const VIRTUAL = `${VIRTUAL_PATH_PREFIX}usage:`;

/** Path of the ".." row of a disk-usage tab. */
export function upPath(scanId: string): string {
  return `${VIRTUAL}${scanId}:up`;
}

export interface UsageInfo {
  readonly id: number;
  readonly kind: UsageKind;
  /** Part of the shown node's size (0…1). */
  readonly share: number;
  readonly allocated: number;
  readonly logical: number;
  readonly files: number;
  readonly dirs: number;
  readonly unreadable: number;
  /** An aggregate: not markable, not an entry of the file system. */
  readonly virtual: boolean;
  /** Ancestors from the top node down to the parent (nesting in the basket). */
  readonly ancestors: readonly number[];
}

/** A row of the disk-usage tab; `dir` is set in "largest files" (relative folder). */
export type UsageRow = DirEntry & { readonly usage: UsageInfo; readonly dir?: string };

export function usageOf(entry: DirEntry | null | undefined): UsageInfo | null {
  return (entry as UsageRow | null | undefined)?.usage ?? null;
}

export interface RowTexts {
  smallFiles(n: number): string;
  rest(n: number): string;
}

function entryKind(kind: UsageKind): EntryKind {
  switch (kind) {
    case 'dir':
    case 'mount':
      return 'directory';
    case 'file':
      return 'file';
    case 'link':
      return 'symlink';
    default:
      return 'unknown';
  }
}

function share(part: number, whole: number): number {
  return whole > 0 ? Math.min(1, part / whole) : 0;
}

/** One child of the shown node as a row. */
export function nodeRow(
  n: UsageNode,
  parent: UsageNode,
  ancestors: readonly number[],
  scanId: string,
  mode: SizeMode,
  t: RowTexts,
): UsageRow {
  const virtual = n.kind === 'files' || n.kind === 'rest' || n.path === null;
  const name =
    n.kind === 'files' ? t.smallFiles(n.files) : n.kind === 'rest' ? t.rest(n.files) : n.name;
  const size = sizeOf(n, mode);
  return {
    name,
    path: virtual ? `${VIRTUAL}${scanId}:${n.kind}:${n.id}` : (n.path as string),
    kind: entryKind(n.kind),
    targetKind: null,
    size,
    modifiedMs: n.modifiedMs,
    hidden: false,
    lossyName: n.lossyName,
    usage: {
      id: n.id,
      kind: n.kind,
      share: share(size, sizeOf(parent, mode)),
      allocated: n.allocated,
      logical: n.logical,
      files: n.files,
      dirs: n.dirs,
      unreadable: n.unreadable,
      virtual,
      ancestors,
    },
  };
}

/** The rows of a view: its children (largest first, as Rust sorted them). */
export function viewRows(view: DiskUsageView, scanId: string, t: RowTexts): UsageRow[] {
  const ancestors = view.crumbs.map((c) => c.id);
  return (view.node.children ?? []).map((c) =>
    nodeRow(c, view.node, ancestors, scanId, view.sizeMode, t),
  );
}

/**
 * Rows of "largest files" below the shown node. Their ancestors are not known
 * exactly – the folder (`dirId`) and the shown node's path are enough for nesting:
 * a marked folder above is only detected while it is on that path.
 */
export function largestRows(
  files: readonly UsageFile[],
  view: DiskUsageView,
  mode: SizeMode,
): UsageRow[] {
  const ancestors = view.crumbs.map((c) => c.id);
  const whole = sizeOf(view.node, mode);
  return files.map((f) => {
    const size = sizeOf(f, mode);
    return {
      name: f.name,
      path: f.path,
      kind: 'file',
      targetKind: null,
      size,
      modifiedMs: f.modifiedMs,
      hidden: false,
      lossyName: f.lossyName,
      dir: f.dir,
      usage: {
        id: f.id,
        kind: 'file',
        share: share(size, whole),
        allocated: f.allocated,
        logical: f.logical,
        files: 1,
        dirs: 0,
        unreadable: 0,
        virtual: false,
        ancestors: f.dirId === view.node.id ? ancestors : [...ancestors, f.dirId],
      },
    };
  });
}

/** Percent text of a share (`< 1 %`, `12 %`, `12.5 %` below 20). */
export function shareText(s: number, locale?: string): string {
  if (s <= 0) {
    return '0 %';
  }
  if (s < 0.01) {
    return '< 1 %';
  }
  const pct = s * 100;
  const digits = pct < 20 ? 1 : 0;
  return `${pct.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 })} %`;
}
