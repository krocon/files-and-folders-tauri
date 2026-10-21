import { translatable } from '../../core/i18n/i18n';
import { CS_DE } from './checksum-texts.de';

/** Texts of the checksum dialogs and reports (design 039). */
export const CS_EN = {
  title: (n: number) => `Create checksums – ${n === 1 ? '1 entry' : `${n} entries`}`,
  algo: 'Algorithm',
  output: 'Write',
  outputList: 'One checksum file for all',
  outputPerFile: 'One checksum file next to each file',
  name: 'File name',
  inFolder: 'In',
  exists: 'The file exists – replace it',
  perFileHelp: 'Existing checksum files are kept.',
  foldersHelp: 'Folders are included with all files inside; links are skipped.',
  cancel: 'Cancel',
  create: 'Create',
  close: 'Close',
  noFolder: 'This side shows no folder',
  nothingSelected: 'Nothing selected',
  noFile: 'The cursor is not on a file',
  noChecksumFile: 'The cursor is not on a checksum file (.md5, .sha1, .sha256, .sha512, *SUMS)',
  written: (n: number, file: string) =>
    `Checksums of ${n === 1 ? '1 file' : `${n} files`} written to ${file}`,
  writtenPerFile: (n: number, skipped: number) =>
    `${n === 1 ? '1 checksum file' : `${n} checksum files`} written` +
    (skipped > 0 ? `, ${skipped} kept` : ''),
  copied: (algo: string, name: string) => `${algo} of ${name} copied`,
  failed: (reason: string) => `Checksums failed: ${reason}`,
  // verify
  resultTitle: (name: string) => `Checksums of ${name}`,
  resultOk: (n: number) => (n === 1 ? '1 file OK' : `${n} files OK`),
  resultAllOk: (n: number) => `All ${n === 1 ? '1 file' : `${n} files`} OK.`,
  resultProblems: (n: number) => (n === 1 ? '1 problem' : `${n} problems`),
  moreProblems: (n: number) => `… and ${n} more (not listed)`,
  colName: 'Name',
  colStatus: 'Status',
  status: {
    mismatch: 'changed',
    missing: 'missing',
    unreadable: 'not readable',
    invalid: 'not a checksum line',
    refused: 'outside the folder – not read',
  },
  markChanged: 'Mark changed files',
  marked: (n: number) => (n === 1 ? '1 file marked' : `${n} files marked`),
  cancelled: 'Checking the checksums was cancelled',
};

export const CS_TEXTS = translatable('checksum', CS_EN, { de: CS_DE });
