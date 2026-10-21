import { translatable } from '../../core/i18n/i18n';
import { DIFF_DE } from './diff-texts.de';

/** Texts of "Compare files" (design 037). */
export const DIFF_EN = {
  title: (left: string, right: string) => `Compare: ${left} ↔ ${right}`,
  loading: 'Comparing …',
  ignoreWhitespace: 'Ignore white space',
  ignoreCase: 'Ignore case',
  wholeFile: 'Whole file',
  previous: 'Previous',
  next: 'Next',
  external: (tool: string) => `Open in ${tool}`,
  close: 'Close',
  colLine: '#',
  identical: 'The contents are identical.',
  identicalWith: 'The contents are identical (with the chosen options).',
  changes: (n: number) => (n === 1 ? '1 difference' : `${n} differences`),
  position: (i: number, n: number) => `difference ${i} of ${n}`,
  skipped: (n: number) => (n === 1 ? '… 1 equal line …' : `… ${n} equal lines …`),
  truncated: 'The view is cut off – use the external tool for the rest.',
  side: (size: string, encoding: string | null, eol: string | null) =>
    [size, encoding, eol ? eol.toUpperCase() : null].filter(Boolean).join(' · '),
  binaryIdentical: 'The files are identical (byte by byte).',
  binaryDiffer: (bytes: number, ranges: number) =>
    `${bytes === 1 ? '1 byte differs' : `${bytes} bytes differ`} in ${ranges === 1 ? '1 range' : `${ranges} ranges`}`,
  binarySizes: 'The sizes differ.',
  firstAt: (offset: string) => `First difference at offset ${offset}`,
  needTwo: 'Mark exactly two files, or put the cursor on a file on each side',
  noOtherFile: 'The other side has no file under the cursor',
  notFiles: 'Only files can be compared',
  same: 'That is the same file',
};

export const DIFF_TEXTS = translatable('diff', DIFF_EN, { de: DIFF_DE });
