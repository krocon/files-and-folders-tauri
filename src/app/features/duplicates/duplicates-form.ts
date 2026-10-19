import { DuplicateCriteria } from '../../core/search/search.models';
import { DUP_TEXTS } from './duplicates-texts';

export type DupUnit = 'B' | 'KB' | 'MB';

/** Fields of the duplicates dialog (kept for the session). */
export interface DuplicatesForm {
  readonly compare: 'content' | 'size';
  readonly sameName: boolean;
  readonly minSize: string;
  readonly minUnit: DupUnit;
  readonly includeHidden: boolean;
  readonly excludes: string;
  readonly maxFiles: string;
}

export const DEFAULT_DUP_FORM: DuplicatesForm = {
  compare: 'content',
  sameName: false,
  minSize: '1',
  minUnit: 'B',
  includeHidden: false,
  excludes: '.git; node_modules',
  maxFiles: '500000',
};

/** Rust `duplicates::MAX_FILES`. */
export const MAX_DUP_FILES = 2_000_000;
const UNIT: Readonly<Record<DupUnit, number>> = { B: 1, KB: 1024, MB: 1024 * 1024 };

export type DupField = 'minSize' | 'maxFiles';

function whole(raw: string): number | null {
  const t = raw.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** The criteria for Rust, or the field with an error. */
export function formToDuplicateCriteria(
  f: DuplicatesForm,
  roots: readonly string[],
): { criteria: DuplicateCriteria } | { error: { field: DupField; message: string } } {
  const min = whole(f.minSize === '' ? '0' : f.minSize);
  if (min === null) {
    return { error: { field: 'minSize', message: DUP_TEXTS.invalidNumber } };
  }
  const max = whole(f.maxFiles);
  if (max === null || max < 1) {
    return { error: { field: 'maxFiles', message: DUP_TEXTS.invalidNumber } };
  }
  if (max > MAX_DUP_FILES) {
    return { error: { field: 'maxFiles', message: DUP_TEXTS.tooLarge(MAX_DUP_FILES) } };
  }
  const bytes = min * UNIT[f.minUnit];
  if (!Number.isSafeInteger(bytes)) {
    return { error: { field: 'minSize', message: DUP_TEXTS.invalidNumber } };
  }
  return {
    criteria: {
      roots,
      compare: f.compare,
      sameName: f.sameName,
      // empty files are all "equal": at least 1 byte
      minSize: Math.max(1, bytes),
      includeHidden: f.includeHidden,
      excludes: f.excludes
        .split(';')
        .map((x) => x.trim())
        .filter((x) => x !== ''),
      maxFiles: max,
    },
  };
}
