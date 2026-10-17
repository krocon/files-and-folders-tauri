import { FsError } from '../../core/fs/fs.models';
import {
  DEFAULT_MAX_HITS,
  MAX_HITS,
  NameMode,
  SearchCriteria,
} from '../../core/search/search.models';
import PRESETS from './search-presets.json';
import { SEARCH_TEXTS } from './search-texts';

export type SizeUnit = 'B' | 'KB' | 'MB' | 'GB';
export type DateMode = 'any' | 'days' | 'range';

/** The find dialog's fields as typed (design 009 E5); templates and recent searches keep this form. */
export interface FindForm {
  readonly name: string;
  readonly nameMode: NameMode;
  readonly caseSensitive: boolean;
  readonly wholeName: boolean;
  readonly files: boolean;
  readonly dirs: boolean;
  readonly links: boolean;
  readonly minSize: string;
  readonly minUnit: SizeUnit;
  readonly maxSize: string;
  readonly maxUnit: SizeUnit;
  readonly dateMode: DateMode;
  readonly days: string;
  /** `yyyy-mm-dd` (input type="date"), local time. */
  readonly from: string;
  readonly to: string;
  readonly content: string;
  readonly contentCase: boolean;
  readonly maxFileSizeMb: string;
  readonly includeHidden: boolean;
  readonly followLinks: boolean;
  readonly maxDepth: string;
  readonly excludes: string;
  readonly maxHits: string;
}

export const DEFAULT_FORM: FindForm = {
  name: '',
  nameMode: 'glob',
  caseSensitive: false,
  wholeName: true,
  files: true,
  dirs: true,
  links: true,
  minSize: '',
  minUnit: 'KB',
  maxSize: '',
  maxUnit: 'MB',
  dateMode: 'any',
  days: '7',
  from: '',
  to: '',
  content: '',
  contentCase: false,
  maxFileSizeMb: '10',
  includeHidden: false,
  followLinks: false,
  maxDepth: '',
  excludes: '.git; node_modules',
  maxHits: String(DEFAULT_MAX_HITS),
};

export interface Preset {
  readonly label: string;
  readonly extensions: readonly string[];
}

/** Built-in templates (mr `search/defaults/data.json` format). */
export const PRESETS_BUILT_IN: readonly Preset[] = PRESETS;

/** `[".mp3", "flac"]` → `*.mp3;*.flac`. */
export function presetGlob(p: Preset): string {
  return p.extensions
    .map((e) => e.trim().replace(/^\*?\.?/, ''))
    .filter((e) => e !== '')
    .map((e) => `*.${e}`)
    .join(';');
}

const UNIT: Record<SizeUnit, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
const DAY_MS = 86_400_000;

export type FormField =
  | 'name'
  | 'minSize'
  | 'maxSize'
  | 'days'
  | 'from'
  | 'to'
  | 'maxFileSizeMb'
  | 'maxDepth'
  | 'maxHits'
  | 'kinds'
  | 'content';

export interface FormError {
  readonly field: FormField;
  readonly message: string;
}

function num(raw: string, field: FormField, min = 0): number | null | FormError {
  const t = raw.trim();
  if (t === '') {
    return null;
  }
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n >= min ? n : { field, message: SEARCH_TEXTS.invalidNumber };
}

function isError(v: unknown): v is FormError {
  return typeof v === 'object' && v !== null && 'field' in v;
}

/** Local midnight of `yyyy-mm-dd` (+ one day minus 1 ms for `endOfDay`). */
function dayMs(raw: string, endOfDay: boolean): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) {
    return null;
  }
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return endOfDay ? start + DAY_MS - 1 : start;
}

/** The criteria for Rust, or the first invalid field. `now` = ms (tests). */
export function formToCriteria(
  f: FindForm,
  roots: readonly string[],
  now = Date.now(),
): { criteria: SearchCriteria } | { error: FormError } {
  if (!f.files && !f.dirs && !f.links) {
    return { error: { field: 'kinds', message: SEARCH_TEXTS.noKind } };
  }
  const minSize = num(f.minSize, 'minSize');
  const maxSize = num(f.maxSize, 'maxSize');
  const days = f.dateMode === 'days' ? num(f.days, 'days') : null;
  const maxFileMb = num(f.maxFileSizeMb, 'maxFileSizeMb');
  const depth = num(f.maxDepth, 'maxDepth', 1);
  const hits = num(f.maxHits, 'maxHits', 1);
  for (const v of [minSize, maxSize, days, maxFileMb, depth, hits]) {
    if (isError(v)) {
      return { error: v };
    }
  }
  let fromMs: number | null = null;
  let toMs: number | null = null;
  if (f.dateMode === 'days' && days !== null) {
    fromMs = now - (days as number) * DAY_MS;
  } else if (f.dateMode === 'range') {
    fromMs = f.from ? dayMs(f.from, false) : null;
    toMs = f.to ? dayMs(f.to, true) : null;
    if (f.from && fromMs === null) {
      return { error: { field: 'from', message: SEARCH_TEXTS.invalidNumber } };
    }
    if (f.to && toMs === null) {
      return { error: { field: 'to', message: SEARCH_TEXTS.invalidNumber } };
    }
  }
  const content = f.content.trim() === '' ? null : f.content;
  return {
    criteria: {
      roots,
      name: f.name.trim(),
      nameMode: f.nameMode,
      caseSensitive: f.caseSensitive,
      wholeName: f.wholeName,
      kinds: { files: f.files, dirs: f.dirs, links: f.links },
      minSize: minSize === null ? null : Math.round((minSize as number) * UNIT[f.minUnit]),
      maxSize: maxSize === null ? null : Math.round((maxSize as number) * UNIT[f.maxUnit]),
      modifiedFromMs: fromMs,
      modifiedToMs: toMs,
      includeHidden: f.includeHidden,
      followLinks: f.followLinks,
      maxDepth: depth === null ? null : Math.floor(depth as number),
      excludes: f.excludes
        .split(';')
        .map((e) => e.trim())
        .filter((e) => e !== ''),
      content: content
        ? {
            text: content,
            caseSensitive: f.contentCase,
            maxFileSize: maxFileMb === null ? null : Math.round((maxFileMb as number) * UNIT.MB),
          }
        : null,
      maxHits: Math.min(MAX_HITS, Math.floor((hits as number | null) ?? DEFAULT_MAX_HITS)),
    },
  };
}

/** Field of a Rust error (an invalid pattern belongs to the name field). */
export function errorField(e: FsError): FormField | null {
  return e.code === 'invalid_pattern' ? 'name' : null;
}
