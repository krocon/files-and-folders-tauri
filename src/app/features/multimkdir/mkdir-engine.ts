/**
 * Multi-MkDir (design 008 E4, mr): folder names from a template with a
 * counter. Pure, no Angular.
 *
 * Tokens: `[C]` counter (padded to `digits`), `[L]` letter (`a` + counter mod 26),
 * `[P]` `[Q]` `[R]` parent, grandparent, great-grandparent folder name.
 */
import { checkGroupName } from '../groupfiles/group-engine';

export const MAX_FOLDERS = 1000;

export type LetterCase = 'none' | 'upper' | 'lower';

export interface MkdirTemplate {
  readonly template: string;
  readonly start: number;
  readonly end: number;
  readonly step: number;
  readonly digits: number;
  readonly letterCase: LetterCase;
}

export const DEFAULT_MKDIR: MkdirTemplate = {
  template: 'Folder [C]',
  start: 1,
  end: 5,
  step: 1,
  digits: 2,
  letterCase: 'none',
};

export interface FolderName {
  readonly name: string;
  readonly error: string | null;
}

export interface MkdirOutcome {
  readonly names: readonly FolderName[];
  /** Problem with the counter itself (step 0, too many names …). */
  readonly error: string | null;
}

const TOKEN = /\[([CLPQR])\]/g;

export function folderNames(
  t: MkdirTemplate,
  parents: readonly [string, string, string],
): MkdirOutcome {
  const { start, end, step, digits } = t;
  if (![start, end, step, digits].every(Number.isInteger) || step <= 0 || digits < 0) {
    return { names: [], error: 'Start, end, step and digits must be whole numbers, step > 0' };
  }
  if (end < start) {
    return { names: [], error: 'The end is smaller than the start' };
  }
  const count = Math.floor((end - start) / step) + 1;
  if (count > MAX_FOLDERS) {
    return { names: [], error: `At most ${MAX_FOLDERS} folders at once` };
  }
  if (!/\[C\]|\[L\]/.test(t.template) && count > 1) {
    return { names: [], error: 'The template needs [C] or [L] for more than one folder' };
  }
  const seen = new Set<string>();
  const names: FolderName[] = [];
  for (let c = start; c <= end; c += step) {
    let name = t.template.replace(TOKEN, (_, k: string) => {
      switch (k) {
        case 'C':
          return (c < 0 ? '-' : '') + String(Math.abs(c)).padStart(digits, '0');
        case 'L':
          return String.fromCharCode(97 + (((c % 26) + 26) % 26));
        case 'P':
          return parents[0];
        case 'Q':
          return parents[1];
        default:
          return parents[2];
      }
    });
    if (t.letterCase === 'upper') {
      name = name.toUpperCase();
    } else if (t.letterCase === 'lower') {
      name = name.toLowerCase();
    }
    name = name.normalize('NFC').trim();
    let error = name === '' ? 'empty name' : checkGroupName(name);
    if (error === null && seen.has(name)) {
      error = 'twice in the list';
    }
    seen.add(name);
    names.push({ name, error });
  }
  return { names, error: null };
}
