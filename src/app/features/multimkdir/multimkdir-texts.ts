import { translatable } from '../../core/i18n/i18n';
import { MM_DE } from './multimkdir-texts.de';
/** Texts of the multi-mkdir dialog (central for prompt 015). */
export const MM_EN = {
  title: (n: number) => `Create several folders – ${n === 1 ? '1 folder' : `${n} folders`}`,
  template: 'Folder name',
  templateHelp: '[C] counter · [L] letter (a, b, …) · [P] [Q] [R] parent folders',
  start: 'From',
  end: 'To',
  step: 'Step',
  digits: 'Digits',
  letterCase: 'Case',
  cases: { none: 'unchanged', upper: 'UPPER CASE', lower: 'lower case' },
  preview: 'Preview',
  colNr: 'Nr.',
  colName: 'Name',
  colInfo: 'Info',
  ok: 'OK',
  inFolder: 'In',
  cancel: 'Cancel',
  create: 'Create',
  noFolder: 'This side shows no folder',
  notCreated: (list: string) => `Not created: ${list}`,
  created: (n: number) => `Created ${n === 1 ? '1 folder' : `${n} folders`}`,
  errWhole: 'Start, end, step and digits must be whole numbers, step > 0',
  errEnd: 'The end is smaller than the start',
  errMax: (max: number) => `At most ${max} folders at once`,
  errToken: 'The template needs [C] or [L] for more than one folder',
  errEmpty: 'empty name',
  errTwice: 'twice in the list',
};

export const MM_TEXTS = translatable('multimkdir', MM_EN, { de: MM_DE });
