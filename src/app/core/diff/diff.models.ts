/** Comparing two files (design 037), Rust `diff.rs`. */
export interface DiffOptions {
  readonly ignoreWhitespace?: boolean;
  readonly ignoreCase?: boolean;
  /** Equal lines around a change; `null` = the whole file. */
  readonly context?: number | null;
  /** Compare bytes even if both look like text. */
  readonly binary?: boolean;
}

export interface DiffSide {
  readonly size: number;
  readonly encoding: string | null;
  readonly eol: 'lf' | 'crlf' | 'cr' | 'mixed' | 'none' | null;
}

export type DiffRowKind = 'equal' | 'removed' | 'added' | 'changed' | 'skip';

export interface DiffRow {
  readonly kind: DiffRowKind;
  /** [line number from 1, text] */
  readonly left: readonly [number, string] | null;
  readonly right: readonly [number, string] | null;
  readonly skipped?: number;
}

export type DiffResult =
  | {
      readonly kind: 'text';
      readonly left: DiffSide;
      readonly right: DiffSide;
      readonly rows: readonly DiffRow[];
      readonly changes: number;
      readonly truncated: boolean;
    }
  | {
      readonly kind: 'binary';
      readonly left: DiffSide;
      readonly right: DiffSide;
      readonly identical: boolean;
      readonly ranges: readonly { readonly offset: number; readonly len: number }[];
      readonly differingBytes: number;
      readonly windowOffset: number;
      readonly leftWindow: readonly number[];
      readonly rightWindow: readonly number[];
    };
