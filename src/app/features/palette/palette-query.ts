import { isSameOrBelow } from '../../shared/path-prefix';

/**
 * The query language of the palette (design 043 E3) – the frontend half of Rust's
 * `palette/query.rs`, checked against the same catalog (`palette-query.cases.json`).
 * The frontend needs it for the mode (`>` = only actions, a path), for the known
 * folders it matches itself and to tell a plain word from a filter.
 */

export const MAX_QUERY_LEN = 512;
export const MAX_TERMS = 12;
export const MAX_NOT = 6;
export const MAX_IN = 6;
export const MAX_EXT = 16;

const DAY_MS = 86_400_000;

export type QueryMode = 'files' | 'actions' | 'path';

export interface ParsedQuery {
  readonly mode: QueryMode;
  readonly terms: readonly string[];
  readonly not: readonly string[];
  readonly ext: readonly string[];
  readonly inDirs: readonly string[];
  readonly inPaths: readonly string[];
  readonly sizeMin: number | null;
  readonly sizeMax: number | null;
  readonly modifiedFrom: number | null;
  readonly modifiedTo: number | null;
  readonly kind: 'file' | 'dir' | null;
  /** Path mode: the typed path. */
  readonly path: string | null;
  /** `>` mode: the text after `>` (the action search). */
  readonly actionText: string;
  /** The plain words as typed (for the fuzzy action search). */
  readonly plain: string;
}

interface Draft {
  mode: QueryMode;
  terms: string[];
  not: string[];
  ext: string[];
  inDirs: string[];
  inPaths: string[];
  sizeMin: number | null;
  sizeMax: number | null;
  modifiedFrom: number | null;
  modifiedTo: number | null;
  kind: 'file' | 'dir' | null;
  path: string | null;
  actionText: string;
  plain: string[];
}

/**
 * Lower case without accents – like the type-ahead and Rust's `fold`: NFD, marks (`\p{M}`)
 * removed, lower case **per character** (Rust: no final sigma).
 */
export function fold(text: string): string {
  let out = '';
  for (const c of text.normalize('NFD').replace(/\p{M}/gu, '')) {
    out += c.toLowerCase();
  }
  return out;
}

/** White space as Rust's `char::is_whitespace` (with U+0085, without U+FEFF). */
function isSpace(c: string): boolean {
  return c !== '\uFEFF' && (c === '\u0085' || /\s/u.test(c));
}

/** `/x`, `~`, `~/x`, `C:\x`, `C:/x`, `\\server\x`. */
export function isPathLike(text: string): boolean {
  return (
    text.startsWith('/') ||
    text === '~' ||
    text.startsWith('~/') ||
    text.startsWith('~\\') ||
    text.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(text)
  );
}

/** Something to search files for: a word or a filter (not only `is:`). */
export function searchesFiles(q: ParsedQuery): boolean {
  return (
    q.mode === 'files' &&
    (q.terms.length > 0 ||
      q.ext.length > 0 ||
      q.inDirs.length > 0 ||
      q.inPaths.length > 0 ||
      q.sizeMin !== null ||
      q.sizeMax !== null ||
      q.modifiedFrom !== null ||
      q.modifiedTo !== null)
  );
}

/** The query has a filter (`ext:`, `size>` …): actions do not match then. */
export function hasFilter(q: ParsedQuery): boolean {
  return (
    q.ext.length > 0 ||
    q.inDirs.length > 0 ||
    q.inPaths.length > 0 ||
    q.sizeMin !== null ||
    q.sizeMax !== null ||
    q.modifiedFrom !== null ||
    q.modifiedTo !== null ||
    q.kind !== null ||
    q.not.length > 0
  );
}

export function parseQuery(input: string, nowMs: number, tzOffsetMinutes: number): ParsedQuery {
  let text = trimSpace(input);
  // at most MAX_QUERY_LEN characters (code points, as Rust counts them)
  const chars = [...text];
  if (chars.length > MAX_QUERY_LEN) {
    text = chars.slice(0, MAX_QUERY_LEN).join('');
  }
  const d: Draft = {
    mode: 'files',
    terms: [],
    not: [],
    ext: [],
    inDirs: [],
    inPaths: [],
    sizeMin: null,
    sizeMax: null,
    modifiedFrom: null,
    modifiedTo: null,
    kind: null,
    path: null,
    actionText: '',
    plain: [],
  };
  if (text.startsWith('>')) {
    d.mode = 'actions';
    d.actionText = text.slice(1).trim();
  } else if (isPathLike(text)) {
    d.mode = 'path';
    d.path = text;
  } else {
    for (const word of words(text)) {
      applyWord(d, word, nowMs, tzOffsetMinutes);
    }
  }
  const { plain, ...rest } = d;
  return { ...rest, plain: plain.join(' ') };
}

function trimSpace(text: string): string {
  const chars = [...text];
  let a = 0;
  let b = chars.length;
  while (a < b && isSpace(chars[a])) {
    a++;
  }
  while (b > a && isSpace(chars[b - 1])) {
    b--;
  }
  return chars.slice(a, b).join('');
}

function words(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const c of text) {
    if (c === '"') {
      quoted = !quoted;
      continue;
    }
    if (isSpace(c) && !quoted) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += c;
    }
  }
  if (cur) {
    out.push(cur);
  }
  return out;
}

function pushLimited(list: string[], value: string, max: number): void {
  if (value && !list.includes(value) && list.length < max) {
    list.push(value);
  }
}

function pushTerms(d: Draft, word: string, negate: boolean): void {
  for (const part of word.split(/[/\\]/)) {
    pushLimited(negate ? d.not : d.terms, fold(part), negate ? MAX_NOT : MAX_TERMS);
  }
}

function applyWord(d: Draft, word: string, now: number, tz: number): void {
  const filter = /^([A-Za-z]+)(:[<>]?|[<>])(.*)$/s.exec(word);
  if (filter && applyFilter(d, filter[1].toLowerCase(), filter[2].slice(-1), filter[3], now, tz)) {
    return;
  }
  if (word.startsWith('-') && word.length > 1) {
    pushTerms(d, word.slice(1), true);
    return;
  }
  d.plain.push(word);
  pushTerms(d, word, false);
}

function applyFilter(
  d: Draft,
  key: string,
  op: string,
  value: string,
  now: number,
  tz: number,
): boolean {
  if (!value) {
    return false;
  }
  if (key === 'ext' && op === ':') {
    for (const e of value.split(',')) {
      pushLimited(d.ext, fold(e.trim().replace(/^\.+/, '')), MAX_EXT);
    }
    return true;
  }
  if (key === 'in' && op === ':') {
    if (isPathLike(value)) {
      pushLimited(d.inPaths, value, MAX_IN);
    } else {
      for (const part of value.split(/[/\\]/)) {
        pushLimited(d.inDirs, fold(part), MAX_IN);
      }
    }
    return true;
  }
  if (key === 'size' && (op === '>' || op === '<')) {
    const n = parseSize(value);
    if (n === null) {
      return false;
    }
    if (op === '>') {
      d.sizeMin = n;
    } else {
      d.sizeMax = n;
    }
    return true;
  }
  if (key === 'modified' || key === 'mod' || key === 'date') {
    const v = value.toLowerCase();
    const period = parsePeriod(v, now, tz);
    if (!period) {
      return false;
    }
    // `>X`: after the period, `<X`: before it; up to now (`7d`, `today`): newer / older
    const relative = !/\d$/.test(v);
    if (op === '>') {
      d.modifiedFrom = relative ? period[0] : period[1];
    } else if (op === '<') {
      d.modifiedTo = period[0];
    } else {
      d.modifiedFrom = period[0];
      d.modifiedTo = period[1];
    }
    return true;
  }
  if ((key === 'is' || key === 'type') && op === ':') {
    const v = value.toLowerCase();
    if (['file', 'files', 'datei'].includes(v)) {
      d.kind = 'file';
      return true;
    }
    if (['dir', 'dirs', 'folder', 'folders', 'ordner'].includes(v)) {
      d.kind = 'dir';
      return true;
    }
  }
  return false;
}

/** `10m`, `1.5g`, `500k`, `20mb`, `1024` – binary units. */
export function parseSize(value: string): number | null {
  let v = value.trim().toLowerCase();
  if (v.endsWith('b')) {
    v = v.slice(0, -1);
  }
  const units: Record<string, number> = { k: 2 ** 10, m: 2 ** 20, g: 2 ** 30, t: 2 ** 40 };
  let mul = 1;
  const last = v.slice(-1);
  if (last in units) {
    mul = units[last];
    v = v.slice(0, -1);
  }
  if (!/^[0-9.]+$/.test(v)) {
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return null;
  }
  const bytes = Math.floor(n * mul);
  return bytes >= 0 && bytes < 2 ** 64 ? bytes : null;
}

function parsePeriod(v: string, now: number, tz: number): [number, number] | null {
  const offset = tz * 60_000;
  const localDay = Math.floor((now + offset) / DAY_MS);
  const startOf = (day: number) => day * DAY_MS - offset;
  if (v === 'today' || v === 'heute') {
    return [startOf(localDay), startOf(localDay + 1)];
  }
  if (v === 'yesterday' || v === 'gestern') {
    return [startOf(localDay - 1), startOf(localDay)];
  }
  const rel = /^(\d+)([dtw])$/.exec(v);
  if (rel) {
    const n = Number(rel[1]);
    const days = rel[2] === 'w' ? n * 7 : n;
    if (n < 1 || (rel[2] === 'w' ? n > 5200 : n > 36_500)) {
      return null;
    }
    return [startOf(localDay + 1 - days), startOf(localDay + 1)];
  }
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(v);
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  if (m[2] === undefined) {
    return [startOf(daysFromCivil(y, 1, 1)), startOf(daysFromCivil(y + 1, 1, 1))];
  }
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) {
    return null;
  }
  if (m[3] === undefined) {
    const [ny, nm] = mo === 12 ? [y + 1, 1] : [y, mo + 1];
    return [startOf(daysFromCivil(y, mo, 1)), startOf(daysFromCivil(ny, nm, 1))];
  }
  const day = Number(m[3]);
  if (day < 1 || day > daysInMonth(y, mo)) {
    return null;
  }
  const n = daysFromCivil(y, mo, day);
  return [startOf(n), startOf(n + 1)];
}

/** `Date.UTC` maps the years 0–99 to 1900–1999: `setUTCFullYear` does not. */
function utc(y: number, m: number, d: number): number {
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getTime();
}

function daysInMonth(y: number, m: number): number {
  return new Date(utc(y, m + 1, 0)).getUTCDate();
}

function daysFromCivil(y: number, m: number, d: number): number {
  return Math.floor(utc(y, m, d) / DAY_MS);
}

/**
 * Matching for paths the frontend has as a whole (known folders): every word and every
 * `in:` word in the folded path below the longest root it starts with, no exclusion. Rust matches folder by folder – the same
 * for words without a separator. Other filters never match a folder by its path.
 */
export function matchesPath(q: ParsedQuery, path: string, roots: readonly string[] = []): boolean {
  if (q.mode !== 'files' || q.terms.length === 0) {
    return false;
  }
  if (q.ext.length || q.sizeMin !== null || q.sizeMax !== null || q.kind === 'file') {
    return false;
  }
  if (q.modifiedFrom !== null || q.modifiedTo !== null || q.inPaths.length) {
    return false;
  }
  // like Rust: the folders of a search root (the home folder) are not part of the path
  const root = roots
    .filter((r) => r && isSameOrBelow(path, r))
    .sort((a, b) => b.length - a.length)[0];
  const all = fold(root ? path.slice(root.length) : path);
  return (
    q.terms.every((t) => all.includes(t)) &&
    q.inDirs.every((t) => all.includes(t)) &&
    !q.not.some((t) => all.includes(t))
  );
}
