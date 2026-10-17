/**
 * Multi-rename rule engine (design 007 E1–E4, E8): pure functions, no Angular.
 * Computes new names only – Rust checks them against each other and the disk
 * (`plan_rename`) and runs them. Rules are compiled once per input
 * ({@link compileRules}); {@link newName} is then called for every entry.
 */

export type CapitalizeMode = 'none' | 'upper' | 'lower' | 'firstLetter' | 'words' | 'chicago';

export interface Replacement {
  readonly enabled: boolean;
  readonly find: string;
  readonly replace: string;
  /** `find` is a regular expression (`/re/flags` or a bare expression with flag `g`). */
  readonly regex: boolean;
  /** Only replace if the name matches `condition` (`/re/flags` or a substring). */
  readonly onlyIf: boolean;
  readonly condition: string;
}

export interface RenameRules {
  readonly pattern: string;
  readonly counter: { readonly start: number; readonly step: number; readonly digits: number };
  readonly capitalize: CapitalizeMode;
  /** Case, options and replacements act on the name only, not the extension (mr `ignoreExtension`). */
  readonly protectExtension: boolean;
  /** `tar.gz`, `tar.bz2`, `tar.xz`, `tar.zst` count as one extension. */
  readonly compoundExtensions: boolean;
  readonly umlauts: boolean;
  readonly riskyChars: boolean;
  readonly spaceToUnderscore: boolean;
  readonly removeParent: boolean;
  readonly replaceEnabled: boolean;
  readonly replacements: readonly Replacement[];
}

export const REPLACEMENT_ROWS = 4;

export const EMPTY_REPLACEMENT: Replacement = {
  enabled: false,
  find: '',
  replace: '',
  regex: false,
  onlyIf: false,
  condition: '',
};

export const DEFAULT_RULES: RenameRules = {
  pattern: '[N].[E]',
  counter: { start: 1, step: 1, digits: 4 },
  capitalize: 'none',
  protectExtension: true,
  compoundExtensions: true,
  umlauts: false,
  riskyChars: false,
  spaceToUnderscore: false,
  removeParent: false,
  replaceEnabled: false,
  replacements: Array.from({ length: REPLACEMENT_ROWS }, () => EMPTY_REPLACEMENT),
};

/** One entry to rename. `parents` = names of parent, grandparent, great-grandparent ('' above the root). */
export interface RenameSource {
  readonly name: string;
  readonly isDir: boolean;
  readonly modifiedMs: number | null;
  readonly parents: readonly [string, string, string];
}

/** Where a rule problem is shown. */
export type RuleField = 'pattern' | `find${number}` | `condition${number}`;

export interface RuleError {
  readonly field: RuleField;
  readonly message: string;
}

type Letter = 'N' | 'E' | 'P' | 'Q' | 'R';
type Token =
  | { readonly t: 'text'; readonly v: string }
  | {
      readonly t: 'field';
      readonly letter: Letter;
      readonly from: number;
      readonly to: number | null;
    }
  | { readonly t: 'counter' }
  | { readonly t: 'date' }
  | { readonly t: 'time' };

interface CompiledReplacement {
  readonly apply: (s: string) => string;
  readonly test: ((s: string) => boolean) | null;
}

export interface CompiledRules {
  readonly rules: RenameRules;
  readonly tokens: readonly Token[];
  readonly replacements: readonly CompiledReplacement[];
  /** Tokens the pattern does not know (`[X]`) – kept as text, shown as a hint. */
  readonly unknown: readonly string[];
}

export function isRuleErrors(c: CompiledRules | readonly RuleError[]): c is readonly RuleError[] {
  return Array.isArray(c);
}

// ---- pattern ----

const FIELD = /^([NEPQR])(?:(\d*)-(\d*))?$/;

/** Splits the pattern once into tokens (no chained `String.replace`, design 007 E3). */
export function parsePattern(pattern: string): { tokens: Token[]; unknown: string[] } | RuleError {
  const tokens: Token[] = [];
  const unknown: string[] = [];
  let text = '';
  const flush = () => {
    if (text !== '') {
      tokens.push({ t: 'text', v: text });
      text = '';
    }
  };
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '[' && pattern[i + 1] === '[') {
      text += '[';
      i++;
      continue;
    }
    if (c === ']' && pattern[i + 1] === ']') {
      text += ']';
      i++;
      continue;
    }
    if (c !== '[') {
      text += c;
      continue;
    }
    const end = pattern.indexOf(']', i + 1);
    if (end < 0) {
      text += pattern.slice(i);
      unknown.push(pattern.slice(i));
      break;
    }
    const body = pattern.slice(i + 1, end);
    const m = FIELD.exec(body);
    let token: Token | null = null;
    if (m) {
      const letter = m[1] as Letter;
      if (m[2] === undefined) {
        token = { t: 'field', letter, from: 0, to: null };
      } else {
        const from = m[2] === '' ? 0 : Number(m[2]);
        const to = m[3] === '' ? null : Number(m[3]);
        if (to !== null && to < from) {
          return {
            field: 'pattern',
            message: `[${body}]: the end of the range is before its start`,
          };
        }
        token = { t: 'field', letter, from, to };
      }
    } else if (body === 'C') {
      token = { t: 'counter' };
    } else if (body === 'D') {
      token = { t: 'date' };
    } else if (body === 'T') {
      token = { t: 'time' };
    }
    if (token) {
      flush();
      tokens.push(token);
    } else {
      text += `[${body}]`;
      unknown.push(`[${body}]`);
    }
    i = end;
  }
  flush();
  return { tokens, unknown };
}

// ---- name and extension (design 007 E2) ----

const COMPOUND = ['tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst'];

/**
 * Name and extension: folders, `README`, `.gitignore` and `datei.` have no
 * extension; `.config.json` → `.config` + `json`; `a.tar.gz` → `a` + `tar.gz`
 * with `compound`.
 */
export function splitName(
  name: string,
  isDir: boolean,
  compound: boolean,
): { stem: string; ext: string } {
  if (isDir) {
    return { stem: name, ext: '' };
  }
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return { stem: name, ext: '' };
  }
  if (compound) {
    const lower = name.toLowerCase();
    for (const c of COMPOUND) {
      const cut = name.length - c.length - 1;
      if (cut > 0 && lower.endsWith(`.${c}`)) {
        return { stem: name.slice(0, cut), ext: name.slice(cut + 1) };
      }
    }
  }
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
}

// ---- case ----

const SMALL = '(a|an|and|as|at|but|by|en|for|if|in|of|on|or|the|to|v[.]?|via|vs[.]?)';
const PUNCT = '([!"#$%&\'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]*)';
/** Unicode word boundaries (`\b` in JavaScript only knows ASCII letters). */
const B0 = '(?<![\\p{L}\\p{N}_])';
const B1 = '(?![\\p{L}\\p{N}_])';
const RE_WORD = new RegExp(`${B0}\\p{L}[\\p{Ll}.'’]*${B1}`, 'gu');
const RE_DOTTED = /\p{L}\.\p{L}/u;
const RE_SMALL = new RegExp(`${B0}${SMALL}${B1}`, 'giu');
const RE_SMALL_FIRST = new RegExp(`^${PUNCT}${SMALL}${B1}`, 'iu');
const RE_SMALL_LAST = new RegExp(`${B0}${SMALL}${PUNCT}$`, 'iu');

function upperFirst(word: string): string {
  const first = String.fromCodePoint(word.codePointAt(0) ?? 0);
  return word === '' ? '' : first.toUpperCase() + word.slice(first.length);
}

/**
 * Title case after the Chicago Manual of Style – the rules of John Resig's
 * `titleCaps` (MIT, as in the old version), extended to Unicode letters.
 */
export function titleCaps(title: string): string {
  const parts: string[] = [];
  const split = /[:.;?!] |(?: |^)["“]/gu;
  let index = 0;
  for (;;) {
    const m = split.exec(title);
    parts.push(
      title
        .substring(index, m ? m.index : title.length)
        .replace(RE_WORD, (all) => (RE_DOTTED.test(all) ? all : upperFirst(all)))
        .replace(RE_SMALL, (all) => all.toLowerCase())
        .replace(RE_SMALL_FIRST, (_all, punct: string, word: string) => punct + upperFirst(word))
        .replace(RE_SMALL_LAST, (_all, word: string, punct: string) => upperFirst(word) + punct),
    );
    index = split.lastIndex;
    if (m) {
      parts.push(m[0]);
    } else {
      break;
    }
  }
  return parts
    .join('')
    .replace(/ V(s?)\. /gi, ' v$1. ')
    .replace(/(['’])S\b/gi, '$1s')
    .replace(/\b(AT&T|Q&A)\b/gi, (all) => all.toUpperCase());
}

export function capitalize(s: string, mode: CapitalizeMode): string {
  switch (mode) {
    case 'upper':
      return s.toUpperCase();
    case 'lower':
      return s.toLowerCase();
    case 'firstLetter':
      return upperFirst(s);
    case 'words':
      return s.replace(/(^|\s)(\S)/gu, (_m, space: string, c: string) => space + c.toUpperCase());
    case 'chicago':
      return titleCaps(s);
    case 'none':
      return s;
  }
}

// ---- options (fixed order, design 007 E4) ----

const UMLAUTS: Readonly<Record<string, string>> = {
  Ä: 'Ae',
  ä: 'ae',
  Ö: 'Oe',
  ö: 'oe',
  Ü: 'Ue',
  ü: 'ue',
  ß: 'ss',
  Â: 'A',
  À: 'A',
  Å: 'A',
  Ã: 'A',
  Á: 'A',
  â: 'a',
  à: 'a',
  å: 'a',
  ã: 'a',
  á: 'a',
  Ç: 'C',
  ç: 'c',
  É: 'E',
  Ê: 'E',
  È: 'E',
  Ë: 'E',
  é: 'e',
  ê: 'e',
  è: 'e',
  ë: 'e',
  Í: 'I',
  Î: 'I',
  Ì: 'I',
  Ï: 'I',
  í: 'i',
  î: 'i',
  ì: 'i',
  ï: 'i',
  Ñ: 'N',
  ñ: 'n',
  Ó: 'O',
  Ô: 'O',
  Ò: 'O',
  Õ: 'O',
  Ø: 'O',
  ó: 'o',
  ô: 'o',
  ò: 'o',
  õ: 'o',
  ø: 'o',
  Š: 'S',
  š: 's',
  Ú: 'U',
  Û: 'U',
  Ù: 'U',
  ú: 'u',
  û: 'u',
  ù: 'u',
  Ý: 'Y',
  Ÿ: 'Y',
  ý: 'y',
  ÿ: 'y',
  Ž: 'Z',
  ž: 'z',
};
const RE_UMLAUTS = new RegExp(`[${Object.keys(UMLAUTS).join('')}]`, 'g');
const RE_RISKY = /[^a-zA-Z0-9_ [\]()\-.]/g;

export function replaceUmlauts(s: string): string {
  return s.replace(RE_UMLAUTS, (c) => UMLAUTS[c] ?? c);
}

function applyOptions(s: string, r: RenameRules, parent: string): string {
  let out = capitalize(s, r.capitalize);
  if (r.umlauts) {
    out = replaceUmlauts(out);
  }
  if (r.riskyChars) {
    out = out.replace(RE_RISKY, '');
  }
  if (r.spaceToUnderscore) {
    out = out.replace(/ /g, '_');
  }
  if (r.removeParent && parent !== '') {
    out = out.replace(parent, () => '');
  }
  return out;
}

// ---- replacements ----

const SLASHED = /^\/(.*)\/([dgimsuvy]*)$/s;

function compileRegex(text: string, defaultFlags: string): RegExp | string {
  const m = SLASHED.exec(text);
  try {
    return m ? new RegExp(m[1], m[2]) : new RegExp(text, defaultFlags);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function compileReplacement(
  rep: Replacement,
  index: number,
): CompiledReplacement | RuleError | null {
  if (!rep.enabled || rep.find === '') {
    return null;
  }
  const find = rep.find.normalize('NFC');
  const to = rep.replace.normalize('NFC');
  let test: CompiledReplacement['test'] = null;
  if (rep.onlyIf && rep.condition !== '') {
    const cond = rep.condition.normalize('NFC');
    if (SLASHED.test(cond)) {
      const re = compileRegex(cond, '');
      if (typeof re === 'string') {
        return { field: `condition${index}`, message: `Invalid expression: ${re}` };
      }
      // without g/y: test() must not remember a position between names
      const plain = new RegExp(re.source, re.flags.replace(/[gy]/g, ''));
      test = (s) => plain.test(s);
    } else {
      test = (s) => s.includes(cond);
    }
  }
  if (rep.regex) {
    const re = compileRegex(find, 'g');
    if (typeof re === 'string') {
      return { field: `find${index}`, message: `Invalid expression: ${re}` };
    }
    return { test, apply: (s) => s.replace(re, to) };
  }
  // plain text: every occurrence, `$` in the replacement is literal
  return { test, apply: (s) => s.split(find).join(to) };
}

/** Compiles pattern and expressions once per input. Errors per field. */
export function compileRules(rules: RenameRules): CompiledRules | readonly RuleError[] {
  const errors: RuleError[] = [];
  const parsed = parsePattern(rules.pattern.normalize('NFC'));
  if ('field' in parsed) {
    errors.push(parsed);
  }
  const replacements: CompiledReplacement[] = [];
  if (rules.replaceEnabled) {
    rules.replacements.forEach((rep, i) => {
      const c = compileReplacement(rep, i);
      if (c && 'field' in c) {
        errors.push(c);
      } else if (c) {
        replacements.push(c);
      }
    });
  }
  if (errors.length > 0 || 'field' in parsed) {
    return errors;
  }
  return { rules, tokens: parsed.tokens, unknown: parsed.unknown, replacements };
}

// ---- one name ----

function range(s: string, from: number, to: number | null): string {
  if (from === 0 && to === null) {
    return s;
  }
  // code points, not UTF-16 units: an emoji stays whole
  return Array.from(s)
    .slice(from, to ?? undefined)
    .join('');
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatDate(ms: number | null): string {
  if (ms === null) {
    return '';
  }
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `20-52-07` – no `:` (not allowed on Windows, shown as `/` in the Finder). */
export function formatTime(ms: number | null): string {
  if (ms === null) {
    return '';
  }
  const d = new Date(ms);
  return `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

export function counterValue(c: RenameRules['counter'], index: number): string {
  const n = c.start + index * c.step;
  return String(n).padStart(Math.max(1, c.digits), '0');
}

/**
 * The new name of `source` (NFC). `index` = position in the display order
 * (counter). Returns the old name unchanged if only its normalisation differs.
 */
export function newName(c: CompiledRules, source: RenameSource, index: number): string {
  const r = c.rules;
  const original = source.name.normalize('NFC');
  const parent = source.parents[0].normalize('NFC');
  let stem: string;
  let ext: string;
  if (r.protectExtension) {
    const parts = splitName(original, source.isDir, r.compoundExtensions);
    stem = applyOptions(parts.stem, r, parent);
    ext = parts.ext;
  } else {
    const parts = splitName(applyOptions(original, r, parent), source.isDir, r.compoundExtensions);
    stem = parts.stem;
    ext = parts.ext;
  }
  let out = '';
  for (const tok of c.tokens) {
    switch (tok.t) {
      case 'text':
        out += tok.v;
        break;
      case 'counter':
        out += counterValue(r.counter, index);
        break;
      case 'date':
        out += formatDate(source.modifiedMs);
        break;
      case 'time':
        out += formatTime(source.modifiedMs);
        break;
      case 'field': {
        const value =
          tok.letter === 'N'
            ? stem
            : tok.letter === 'E'
              ? ext
              : source.parents['PQR'.indexOf(tok.letter)].normalize('NFC');
        const part = range(value, tok.from, tok.to);
        if (tok.letter === 'E' && part === '' && out.endsWith('.')) {
          out = out.slice(0, -1); // `[N].[E]` keeps `README` and folders as they are
        }
        out += part;
        break;
      }
    }
  }
  if (c.replacements.length > 0) {
    out = out.replace(/\s+/g, ' ');
    if (r.protectExtension) {
      const parts = splitName(out, source.isDir, r.compoundExtensions);
      out = replaceAll(c.replacements, parts.stem) + (parts.ext === '' ? '' : `.${parts.ext}`);
    } else {
      out = replaceAll(c.replacements, out);
    }
  }
  out = out.normalize('NFC');
  return out === original ? source.name : out;
}

function replaceAll(reps: readonly CompiledReplacement[], s: string): string {
  let out = s;
  for (const rep of reps) {
    if (!rep.test || rep.test(out)) {
      out = rep.apply(out);
    }
  }
  return out;
}

// ---- macros (legacy + mr, rewritten for the name part – design 007 E4) ----

export interface Macro {
  readonly category: string;
  readonly title: string;
  readonly example: string;
  readonly find: string;
  readonly replace: string;
  readonly condition: string;
}

export const MACROS: readonly Macro[] = [
  {
    category: 'Replace characters',
    title: 'Pseudo delimiters ._- → space',
    example: '"Das-Joshua-Profil.epub" → "Das Joshua Profil.epub"',
    find: '/[._-]/g',
    replace: ' ',
    condition: '',
  },
  {
    category: 'Extract words',
    title: 'Movies with a year',
    example: '"white snow 1959 german 1080p.mkv" → "white snow (1959).mkv"',
    find: '/([\\D]*)[ [.\\-(](\\d{4}).*/g',
    replace: '$1 ($2)',
    condition: '/\\d{4}/',
  },
  {
    category: 'Reorder words',
    title: 'first last - title → last, first - title',
    example:
      '"Sebastian Fitzek - Das Joshua-Profil.epub" → "Fitzek, Sebastian - Das Joshua-Profil.epub"',
    find: '/([^.\\s-]+)\\s([^.\\s-]+)\\s-\\s(.+)/g',
    replace: '$2, $1 - $3',
    condition: '/([^,]) - ([^,]+)/',
  },
  {
    category: 'Reorder words',
    title: 'title - first last → last, first - title',
    example:
      '"Das Joshua-Profil - Sebastian Fitzek.epub" → "Fitzek, Sebastian - Das Joshua-Profil.epub"',
    find: '/(.+)\\s-\\s([^.\\s]+)\\s([^.,]+)$/g',
    replace: '$3, $2 - $1',
    condition: '/([^,]) - ([^,]+)/',
  },
  {
    category: 'Reorder words',
    title: 'title - last, first → last, first - title',
    example:
      '"Das Joshua-Profil - Fitzek, Sebastian.epub" → "Fitzek, Sebastian - Das Joshua-Profil.epub"',
    find: '/(.+)\\s-\\s([^.\\s,]+),\\s*([^.]+)$/g',
    replace: '$2, $3 - $1',
    condition: '/ - ([^.\\s,]+),/',
  },
];

/** The replacement row a macro fills (switched on). */
export function macroReplacement(m: Macro): Replacement {
  return {
    enabled: true,
    find: m.find,
    replace: m.replace,
    regex: true,
    onlyIf: m.condition !== '',
    condition: m.condition,
  };
}

// ---- stored rules ----

const MODES: readonly CapitalizeMode[] = [
  'none',
  'upper',
  'lower',
  'firstLetter',
  'words',
  'chicago',
];

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length <= 2000 ? v : fallback;
}

/** Rules from a presets file (any shape) – unknown or broken values fall back to the defaults. */
export function sanitizeRules(value: unknown): RenameRules {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_RULES;
  const counter = (
    typeof v['counter'] === 'object' && v['counter'] !== null ? v['counter'] : {}
  ) as Record<string, unknown>;
  const reps = Array.isArray(v['replacements']) ? (v['replacements'] as unknown[]) : [];
  return {
    pattern: str(v['pattern'], d.pattern),
    counter: {
      start: num(counter['start'], d.counter.start, 0, 1_000_000_000),
      step: num(counter['step'], d.counter.step, 1, 1_000_000),
      digits: num(counter['digits'], d.counter.digits, 1, 10),
    },
    capitalize: MODES.includes(v['capitalize'] as CapitalizeMode)
      ? (v['capitalize'] as CapitalizeMode)
      : d.capitalize,
    protectExtension: bool(v['protectExtension'], d.protectExtension),
    compoundExtensions: bool(v['compoundExtensions'], d.compoundExtensions),
    umlauts: bool(v['umlauts'], d.umlauts),
    riskyChars: bool(v['riskyChars'], d.riskyChars),
    spaceToUnderscore: bool(v['spaceToUnderscore'], d.spaceToUnderscore),
    removeParent: bool(v['removeParent'], d.removeParent),
    replaceEnabled: bool(v['replaceEnabled'], d.replaceEnabled),
    replacements: Array.from({ length: REPLACEMENT_ROWS }, (_, i) => {
      const r = (typeof reps[i] === 'object' && reps[i] !== null ? reps[i] : {}) as Record<
        string,
        unknown
      >;
      return {
        enabled: bool(r['enabled'], false),
        find: str(r['find'], ''),
        replace: str(r['replace'], ''),
        regex: bool(r['regex'], false),
        onlyIf: bool(r['onlyIf'], false),
        condition: str(r['condition'], ''),
      };
    }),
  };
}
