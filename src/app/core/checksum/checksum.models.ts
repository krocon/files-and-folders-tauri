/**
 * Checksums (design 039), Rust `checksum.rs` + `jobs/checksum.rs`. Jobs `checksum`
 * (create a list, one file per file, or only show) and `verifyChecksums`.
 */
export type ChecksumAlgo = 'md5' | 'sha1' | 'sha256' | 'sha512';

export const CHECKSUM_ALGOS: readonly ChecksumAlgo[] = ['sha256', 'sha512', 'sha1', 'md5'];

export type ChecksumOutput =
  | { readonly kind: 'list'; readonly name: string; readonly overwrite?: boolean }
  | { readonly kind: 'perFile'; readonly overwrite?: boolean }
  | { readonly kind: 'show' };

export type ChecksumProblemKind = 'mismatch' | 'missing' | 'unreadable' | 'invalid' | 'refused';

export interface ChecksumProblem {
  readonly name: string;
  readonly path: string | null;
  readonly kind: ChecksumProblemKind;
}

export interface ChecksumSummary {
  readonly algo: ChecksumAlgo | null;
  readonly file: string | null;
  readonly digests: readonly { readonly path: string; readonly hex: string }[];
  readonly ok: number;
  readonly mismatched: number;
  readonly missing: number;
  readonly unreadable: number;
  readonly invalid: number;
  readonly refused: number;
  readonly problems: readonly ChecksumProblem[];
}

/** The algorithm a checksum file's name stands for (as Rust `Algo::from_file_name`). */
export function checksumAlgoOfName(name: string): ChecksumAlgo | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : '';
  const byExt = CHECKSUM_ALGOS.find((a) => a === ext);
  if (byExt) {
    return byExt;
  }
  return CHECKSUM_ALGOS.find((a) => lower.startsWith(`${a}sum`)) ?? null;
}
