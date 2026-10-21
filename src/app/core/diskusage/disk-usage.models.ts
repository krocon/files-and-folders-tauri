/**
 * Disk usage (design 033) – keep in sync with Rust `disk_usage/{mod,tree}.rs`.
 * A scan runs as job `diskUsage`; its id is the scan id. The tree stays in Rust,
 * the frontend asks for the levels it shows.
 */

/** `files` = the small files of a folder not kept one by one, `rest` = entries below the view's threshold. */
export type UsageKind = 'dir' | 'file' | 'link' | 'mount' | 'files' | 'rest';

export type SizeMode = 'allocated' | 'logical';

export interface UsageNode {
  readonly id: number;
  readonly name: string;
  /** `null`: the virtual root of several roots and the aggregates. */
  readonly path: string | null;
  readonly kind: UsageKind;
  readonly allocated: number;
  readonly logical: number;
  /** Files (and links) in the subtree; for `files`/`rest` the number of entries. */
  readonly files: number;
  readonly dirs: number;
  readonly unreadable: number;
  readonly modifiedMs: number | null;
  readonly lossyName: boolean;
  readonly children?: readonly UsageNode[];
}

export interface Crumb {
  readonly id: number;
  readonly name: string;
}

export interface VolumeSpace {
  readonly total: number;
  readonly free: number;
}

export interface DiskUsageView {
  readonly node: UsageNode;
  readonly crumbs: readonly Crumb[];
  readonly virtualTop: boolean;
  readonly running: boolean;
  readonly complete: boolean;
  readonly simplified: boolean;
  readonly scannedAtMs: number;
  readonly version: number;
  readonly sizeMode: SizeMode;
  readonly volume: VolumeSpace | null;
  /** Allocated bytes of the whole scan ("not counted" of a volume). */
  readonly scannedAllocated: number;
}

/** A kept file of a subtree ("largest files"). */
export interface UsageFile {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  /** Folder relative to the asked node (`''` = the node itself) – display only. */
  readonly dir: string;
  readonly dirId: number;
  readonly allocated: number;
  readonly logical: number;
  readonly modifiedMs: number | null;
  readonly lossyName: boolean;
}

export interface DiskUsageOptions {
  readonly crossFilesystems?: boolean;
  readonly sizeMode?: SizeMode;
}

/** `Summary.diskUsage` of a finished scan. */
export interface DiskUsageSummary {
  readonly complete: boolean;
  readonly entries: number;
  readonly unreadable: number;
  readonly simplified: boolean;
  readonly elapsedMs: number;
}

export function sizeOf(n: { allocated: number; logical: number }, mode: SizeMode): number {
  return mode === 'allocated' ? n.allocated : n.logical;
}
