import { GroupMode } from './group-engine';
import { translatable } from '../../core/i18n/i18n';
import { GF_DE } from './groupfiles-texts.de';

/** Texts of the group-files dialog (central for prompt 015). */
export const GF_EN = {
  title: (n: number, groups: number) =>
    `Group files – ${n === 1 ? '1 entry' : `${n} entries`} → ${groups === 1 ? '1 group' : `${groups} groups`}`,
  mode: 'Mode',
  modes: {
    runningNumber: 'Running number',
    newFolder: 'New folder (manually)',
    minusSeparator: 'Minus separator',
    firstWord: 'First word',
    firstLetter: 'First letter',
    firstLetterLower: 'First letter lowercase',
    firstLetterUpper: 'First letter uppercase',
    twoLetters: 'Two letters',
    twoLettersLower: 'Two letters lowercase',
    twoLettersUpper: 'Two letters uppercase',
  } satisfies Record<GroupMode, string>,
  newFolder: 'New folder',
  minSize: 'Min. group size',
  minSizeNone: 'none',
  ignoreBrackets: 'Ignore [ ] and ( )',
  useSourceDir: 'Source folder as root',
  root: 'Root',
  noOtherPanel: '(the other side shows no folder)',
  preview: 'Preview',
  colNr: 'Nr.',
  colName: 'Source',
  colGroup: 'Group',
  colInfo: 'Info',
  infoOk: 'OK',
  infoNone: 'no group',
  infoSmall: (min: number) => `group smaller than ${min}`,
  summary: (groups: number, ok: number, rest: number) =>
    `${groups === 1 ? '1 group' : `${groups} groups`} · ${ok} to group · ${rest} without group`,
  cancel: 'Cancel',
  copy: 'Copy',
  move: 'Move',
  noFolder: 'This side shows no folder',
  nothingSelected: 'Nothing to group in this folder',
  failed: (msg: string) => `Grouping failed: ${msg}`,
  withErrors: (n: number) => `Grouping finished – ${n === 1 ? '1 entry' : `${n} entries`} failed`,
  done: (n: number) => `Grouped ${n === 1 ? '1 entry' : `${n} entries`}`,
  nameInvalid: 'not a valid folder name',
  nameChars: 'contains / \\ : * ? " < > | or control characters',
  nameEnd: 'ends with a dot or space',
  nameLong: 'too long',
};

export const GF_TEXTS = translatable('groupfiles', GF_EN, { de: GF_DE });
