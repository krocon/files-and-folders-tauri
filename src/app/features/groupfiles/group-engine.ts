import { GF_TEXTS } from './groupfiles-texts';
/**
 * Group files (design 008 E1): which sub-folder an entry goes to. Pure, no
 * Angular. The rules follow the old program (legacy §3.2) with Unicode words
 * and digits instead of ASCII `\w`/`\d`, one bracket rule for all modes, the
 * minimum group size for all modes except "new folder" and checked group names.
 */

export type GroupMode =
  | 'runningNumber'
  | 'newFolder'
  | 'minusSeparator'
  | 'firstWord'
  | 'firstLetter'
  | 'firstLetterLower'
  | 'firstLetterUpper'
  | 'twoLetters'
  | 'twoLettersLower'
  | 'twoLettersUpper';

export const GROUP_MODES: readonly GroupMode[] = [
  'runningNumber',
  'newFolder',
  'minusSeparator',
  'firstWord',
  'firstLetter',
  'firstLetterLower',
  'firstLetterUpper',
  'twoLetters',
  'twoLettersLower',
  'twoLettersUpper',
];

export const MIN_SIZES: readonly number[] = [0, 2, 3, 4, 5, 10];

export interface GroupOptions {
  readonly mode: GroupMode;
  /** Folder name of mode "new folder". */
  readonly newFolder: string;
  /** Remove `[…]` and `(…)` before looking at the name (default on). */
  readonly ignoreBrackets: boolean;
  /** Groups with fewer entries are left out (0 = none; not for "new folder"). */
  readonly minSize: number;
  /** The source folder instead of the other panel's folder is the root. */
  readonly useSourceDir: boolean;
}

export const DEFAULT_GROUP_OPTIONS: GroupOptions = {
  mode: 'runningNumber',
  newFolder: '',
  ignoreBrackets: true,
  minSize: 2,
  useSourceDir: false,
};

const BRACKETS_SQUARE = /\[[^\]]*\]/g;
const BRACKETS_ROUND = /\([^)]*\)/g;
const TRIM_SEPARATORS = /^[.\s_-]+|[.\s_-]+$/gu;
const TRIM_LETTERS = /^[\s_-]+|[\s_-]+$/gu;
const DIGIT_RUNS = /\p{Nd}+/gu;
const NON_DIGIT_RUNS = /\P{Nd}+/gu;
const FIRST_WORD = /([\p{L}\p{N}\p{M}_]+)[^\p{L}\p{N}\p{M}_](.+)/u;
const MINUS_SPACED = /(.+) - (.+)/u;
const MINUS = /(.+)-(.+)/u;
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[/\\:*?"<>|\u0000-\u001f\u007f]/u;

function stripBrackets(name: string): string {
  return name.replace(BRACKETS_SQUARE, '').replace(BRACKETS_ROUND, '');
}

/** The raw group of one name (`null` = no group), before the minimum size. */
export function groupOf(rawName: string, o: GroupOptions): string | null {
  const name0 = rawName.normalize('NFC');
  if (o.mode === 'newFolder') {
    const g = o.newFolder.normalize('NFC').trim();
    return g === '' ? null : g;
  }
  const name = o.ignoreBrackets ? stripBrackets(name0) : name0;
  let group: string | null = null;
  switch (o.mode) {
    case 'runningNumber': {
      const digits = name.match(DIGIT_RUNS);
      const words = name.match(NON_DIGIT_RUNS);
      if (digits && digits.length >= 1 && words && words.length >= 2) {
        group = words[0]
          .replace(/#/g, '')
          .replace(/ Band /g, '')
          .replace(/'/g, '')
          .replace(TRIM_SEPARATORS, '');
      }
      break;
    }
    case 'minusSeparator': {
      // greedy: the part before the *last* " - ", else before the last "-"
      const m = MINUS_SPACED.exec(name) ?? MINUS.exec(name);
      group = m ? m[1].replace(TRIM_SEPARATORS, '') : null;
      break;
    }
    case 'firstWord': {
      const m = FIRST_WORD.exec(name);
      group = m ? m[1].replace(TRIM_SEPARATORS, '') : null;
      break;
    }
    default: {
      const count = o.mode.startsWith('two') ? 2 : 1;
      // code points, not UTF-16 units: an emoji stays whole
      group = Array.from(name.replace(TRIM_LETTERS, '')).slice(0, count).join('');
      if (o.mode.endsWith('Lower')) {
        group = group.toLowerCase();
      } else if (o.mode.endsWith('Upper')) {
        group = group.toUpperCase();
      }
    }
  }
  const g = group?.trim() ?? '';
  return g === '' ? null : g;
}

/** Why `name` cannot be a folder name on every platform, or `null`. */
export function checkGroupName(name: string): string | null {
  if (name === '.' || name === '..') {
    return GF_TEXTS.nameInvalid;
  }
  if (INVALID_CHARS.test(name)) {
    return GF_TEXTS.nameChars;
  }
  if (/[. ]$/.test(name)) {
    return GF_TEXTS.nameEnd;
  }
  if (new TextEncoder().encode(name).length > 255) {
    return GF_TEXTS.nameLong;
  }
  return null;
}

export type GroupStatus = 'ok' | 'none' | 'small' | 'error';

export interface GroupResult {
  readonly group: string | null;
  readonly status: GroupStatus;
  /** Why the entry is not grouped (`error`). */
  readonly error: string | null;
}

export interface GroupOutcome {
  readonly results: readonly GroupResult[];
  /** Groups that will be created or filled. */
  readonly groupCount: number;
}

/** Groups all names: raw group, minimum size, name check. */
export function groupEntries(names: readonly string[], o: GroupOptions): GroupOutcome {
  const raw = names.map((n) => groupOf(n, o));
  const sizes = new Map<string, number>();
  raw.forEach((g) => {
    if (g !== null) {
      sizes.set(g, (sizes.get(g) ?? 0) + 1);
    }
  });
  const min = o.mode === 'newFolder' ? 0 : o.minSize;
  const groups = new Set<string>();
  const results = raw.map((g): GroupResult => {
    if (g === null) {
      return { group: null, status: 'none', error: null };
    }
    if ((sizes.get(g) ?? 0) < min) {
      return { group: g, status: 'small', error: null };
    }
    const error = checkGroupName(g);
    if (error !== null) {
      return { group: g, status: 'error', error };
    }
    groups.add(g);
    return { group: g, status: 'ok', error: null };
  });
  return { results, groupCount: groups.size };
}
