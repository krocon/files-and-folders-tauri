import { FileType } from '../../core/config/config.models';
import { DirEntry, isNavigableDir, isParentRow, isVirtualPath } from '../../core/fs/fs.models';
import { SearchHit } from '../../core/search/search.models';
import { boolOr, oneOf, record, textOr } from '../../shared/restore-fields';
import { compilePattern } from '../actions/pattern';
import { stemLength } from '../ops/ops-logic';

/**
 * Pure rule model and evaluation engine for "Select if…" (OPEN_SELECT_IF_DLG, design 046 E2).
 *
 * Works exclusively in memory on already listed `DirEntry` / `SearchHit` objects:
 * - paths remain opaque (`SearchHit.dir ?? ''` isolates subfolders in flat/search tabs);
 * - file names and stems are compared Unicode-NFC-normalised and case-insensitively;
 * - `exact` companions and `otherPanel` run in O(N), `prefix` companions in O(N log N)
 *   via UTF-16 code-unit sorted partner stems and binary search per folder.
 */

export const MAX_CONDITIONS = 8;
export const MAX_TEMPLATES = 50;
export const MAX_TEMPLATE_LABEL = 100;

export type EntryKindFilter = 'files' | 'dirs' | 'both';
export type MatcherKind = 'any' | 'category' | 'glob' | 'regex';
export type ConditionKind = 'companion' | 'otherPanel' | 'size' | 'modified' | 'name';
export type StemMatchMode = 'exact' | 'prefix';
export type ConditionJoin = 'all' | 'any';
export type CombineMode = 'replace' | 'add' | 'remove' | 'intersect';
export type SizeUnit = 'B' | 'KB' | 'MB' | 'GB';
export type AgeUnit = 'hours' | 'days';
export type ExistenceOperator = 'exists' | 'missing';
export type OtherPanelCompare = 'sameName' | 'sameStem' | 'sameNameAndSize' | 'newer' | 'older';
export type SizeOperator = 'gt' | 'lt' | 'between' | 'empty';
export type ModifiedOperator = 'withinLast' | 'olderThan' | 'after' | 'before' | 'between';
export type NameOperator = 'matches' | 'notMatches';

export const ENTRY_KINDS: readonly EntryKindFilter[] = ['files', 'dirs', 'both'];
export const MATCHER_KINDS: readonly MatcherKind[] = ['any', 'category', 'glob', 'regex'];
export const CONDITION_KINDS: readonly ConditionKind[] = [
  'companion',
  'otherPanel',
  'size',
  'modified',
  'name',
];
export const STEM_MATCH_MODES: readonly StemMatchMode[] = ['exact', 'prefix'];
export const CONDITION_JOINS: readonly ConditionJoin[] = ['all', 'any'];
export const COMBINE_MODES: readonly CombineMode[] = ['replace', 'add', 'remove', 'intersect'];
export const SIZE_UNITS: readonly SizeUnit[] = ['B', 'KB', 'MB', 'GB'];
export const AGE_UNITS: readonly AgeUnit[] = ['hours', 'days'];
export const EXISTENCE_OPERATORS: readonly ExistenceOperator[] = ['exists', 'missing'];
export const OTHER_PANEL_COMPARES: readonly OtherPanelCompare[] = [
  'sameName',
  'sameStem',
  'sameNameAndSize',
  'newer',
  'older',
];
export const SIZE_OPERATORS: readonly SizeOperator[] = ['gt', 'lt', 'between', 'empty'];
export const MODIFIED_OPERATORS: readonly ModifiedOperator[] = [
  'withinLast',
  'olderThan',
  'after',
  'before',
  'between',
];
export const NAME_OPERATORS: readonly NameOperator[] = ['matches', 'notMatches'];
export const NAME_MODES: readonly ('glob' | 'regex')[] = ['glob', 'regex'];

export type MatcherSpec =
  | { readonly kind: 'any' }
  | { readonly kind: 'category'; readonly category: string }
  | { readonly kind: 'glob'; readonly pattern: string }
  | { readonly kind: 'regex'; readonly pattern: string };

export interface CompanionCondition {
  readonly id: string;
  readonly kind: 'companion';
  readonly operator: ExistenceOperator;
  readonly partnerKind: EntryKindFilter;
  readonly partnerMatcher: MatcherSpec;
  readonly stemMatch: StemMatchMode;
  readonly includeCompanions: boolean;
}

export interface OtherPanelCondition {
  readonly id: string;
  readonly kind: 'otherPanel';
  readonly operator: ExistenceOperator;
  readonly compare: OtherPanelCompare;
}

export interface SizeCondition {
  readonly id: string;
  readonly kind: 'size';
  readonly operator: SizeOperator;
  readonly min: string;
  readonly max: string;
  readonly unit: SizeUnit;
}

export interface ModifiedCondition {
  readonly id: string;
  readonly kind: 'modified';
  readonly operator: ModifiedOperator;
  readonly amount: string;
  readonly ageUnit: AgeUnit;
  readonly dateFrom: string;
  readonly dateTo: string;
}

export interface NameCondition {
  readonly id: string;
  readonly kind: 'name';
  readonly operator: NameOperator;
  readonly mode: 'glob' | 'regex';
  readonly pattern: string;
}

export type ConditionSpec =
  CompanionCondition | OtherPanelCondition | SizeCondition | ModifiedCondition | NameCondition;

export interface SelectIfRule {
  readonly targetKind: EntryKindFilter;
  readonly targetMatcher: MatcherSpec;
  readonly matchMode: ConditionJoin;
  readonly conditions: readonly ConditionSpec[];
  readonly combineMode: CombineMode;
}

export interface SelectIfTemplate {
  readonly label: string;
  readonly rule: SelectIfRule;
}

export type SelectIfProblemCode =
  | 'unknownCategory'
  | 'emptyPattern'
  | 'invalidRegex'
  | 'invalidNumber'
  | 'invalidDate'
  | 'invalidRange'
  | 'noConditions';

export interface SelectIfProblem {
  /** Field key (`'targetMatcher'` or `'cond:<id>:<subField>'`) for targeted `aria-invalid`. */
  readonly field: string;
  readonly code: SelectIfProblemCode;
  readonly detail?: string;
}

export type PreviewRole = 'primary' | 'companion' | 'excluded';

export interface SelectIfPreviewItem {
  readonly entry: DirEntry;
  readonly role: PreviewRole;
}

export interface SelectIfContext {
  readonly categories: readonly FileType[];
  readonly otherEntries?: readonly DirEntry[];
  readonly currentMarks?: ReadonlySet<string>;
  readonly unmarkablePaths?: ReadonlySet<string>;
  /** `1000` for decimal (`view.sizeFormat === 'decimal'`), `1024` otherwise (default). */
  readonly sizeBase?: 1000 | 1024;
  /** Current timestamp in ms for relative `modified` rules (`withinLast`, `olderThan`). */
  readonly nowMs?: number;
}

export interface SelectIfEvaluation {
  readonly problems: readonly SelectIfProblem[];
  /** Number of markable entries in `entries` (excludes `..`, virtual rows, `unmarkablePaths`). */
  readonly totalEntries: number;
  /** Primary candidates matching the rule `H` (before `combineMode`). */
  readonly rulePrimaryPaths: ReadonlySet<string>;
  /** Companion entries pulled in by `includeCompanions` (disjoint from `rulePrimaryPaths`). */
  readonly ruleCompanionPaths: ReadonlySet<string>;
  /** `rulePrimaryPaths ∪ ruleCompanionPaths`. */
  readonly ruleHitPaths: ReadonlySet<string>;
  /** Sum of `size ?? 0` over `ruleHitPaths`. */
  readonly ruleBytes: number;
  /** Resulting marked paths among `markableEntries` after applying `combineMode`. */
  readonly nextMarkedPaths: ReadonlySet<string>;
  /** Sum of `size ?? 0` over `nextMarkedPaths`. */
  readonly nextMarkedBytes: number;
  /** Paths newly added compared to `currentMarks ∩ markableEntries`. */
  readonly addedCount: number;
  /** Paths removed compared to `currentMarks ∩ markableEntries`. */
  readonly removedCount: number;
  /** Candidates (`targetKind` + `targetMatcher`) that failed the `conditions` (or `intersect`). */
  readonly excludedCandidatePaths: ReadonlySet<string>;
  /** Preview items in the panel's display order (hits + excluded candidates). */
  readonly previewItems: readonly SelectIfPreviewItem[];
}

export function defaultCondition(kind: ConditionKind, id = 'c1'): ConditionSpec {
  switch (kind) {
    case 'companion':
      return {
        id,
        kind: 'companion',
        operator: 'exists',
        partnerKind: 'files',
        partnerMatcher: { kind: 'category', category: 'images' },
        stemMatch: 'exact',
        includeCompanions: true,
      };
    case 'otherPanel':
      return {
        id,
        kind: 'otherPanel',
        operator: 'missing',
        compare: 'sameName',
      };
    case 'size':
      return {
        id,
        kind: 'size',
        operator: 'gt',
        min: '100',
        max: '',
        unit: 'MB',
      };
    case 'modified':
      return {
        id,
        kind: 'modified',
        operator: 'withinLast',
        amount: '7',
        ageUnit: 'days',
        dateFrom: '',
        dateTo: '',
      };
    case 'name':
      return {
        id,
        kind: 'name',
        operator: 'notMatches',
        mode: 'glob',
        pattern: '*sample* *trailer*',
      };
  }
}

export function defaultMatcher(kind: MatcherKind, fallbackCategory = 'movies'): MatcherSpec {
  switch (kind) {
    case 'any':
      return { kind: 'any' };
    case 'category':
      return { kind: 'category', category: fallbackCategory };
    case 'glob':
      return { kind: 'glob', pattern: '*' };
    case 'regex':
      return { kind: 'regex', pattern: '' };
  }
}

/** Default initial rule (= Preset 1: Movies with cover image, incl. cover; design 046 E3). */
export const DEFAULT_SELECT_IF_RULE: SelectIfRule = {
  targetKind: 'files',
  targetMatcher: { kind: 'category', category: 'movies' },
  matchMode: 'all',
  conditions: [defaultCondition('companion', 'c1')],
  combineMode: 'replace',
};

// ---- Fast NFC + indexing helpers ----

function nfc(s: string): string {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) >= 128) {
      return s.normalize('NFC');
    }
  }
  return s;
}

interface IndexedEntry {
  readonly entry: DirEntry;
  readonly isDir: boolean;
  readonly isFileLike: boolean;
  readonly folderKey: string;
  readonly normName: string;
  readonly lowerName: string;
  readonly lowerStem: string;
  readonly lowerExt: string;
}

function indexEntry(entry: DirEntry): IndexedEntry {
  const isDir = isNavigableDir(entry);
  const isFileLike =
    entry.kind === 'file' || (entry.kind === 'symlink' && entry.targetKind === 'file');
  const folderKey = (entry as Partial<SearchHit>).dir ?? '';
  const normName = nfc(entry.name);
  const lowerName = normName.toLowerCase();
  const sLen = stemLength(lowerName, isDir);
  const lowerStem = lowerName.slice(0, sLen);
  const lowerExt = lowerName.slice(sLen);
  return { entry, isDir, isFileLike, folderKey, normName, lowerName, lowerStem, lowerExt };
}

function matchesEntryKind(item: IndexedEntry, filter: EntryKindFilter): boolean {
  switch (filter) {
    case 'files':
      return item.isFileLike;
    case 'dirs':
      return item.isDir;
    case 'both':
      return true;
  }
}

type CompiledMatcher = (item: IndexedEntry) => boolean;

function compileMatcher(
  spec: MatcherSpec,
  field: string,
  categories: readonly FileType[],
  problems: SelectIfProblem[],
): CompiledMatcher | null {
  switch (spec.kind) {
    case 'any':
      return () => true;
    case 'category': {
      const wanted = nfc(spec.category.trim()).toLowerCase();
      const found = categories.find((c) => nfc(c.label.trim()).toLowerCase() === wanted);
      if (!found) {
        problems.push({ field, code: 'unknownCategory', detail: spec.category });
        return null;
      }
      const exts = new Set<string>();
      for (const raw of found.extensions) {
        const clean = nfc(raw.trim()).toLowerCase();
        if (clean) {
          exts.add(clean.startsWith('.') ? clean : `.${clean}`);
        }
      }
      return (item) =>
        (item.lowerExt !== '' && exts.has(item.lowerExt)) ||
        (item.lowerName.startsWith('.') && exts.has(item.lowerName));
    }
    case 'glob':
    case 'regex': {
      const pat = nfc(spec.pattern.trim());
      if (!pat) {
        problems.push({ field, code: 'emptyPattern' });
        return null;
      }
      if (spec.kind === 'glob') {
        // Fast path for space-separated plain extension globs (`*.srt *.ass`, `*.jpg *.jpeg`)
        const terms = pat.split(/\s+/);
        if (terms.every((t) => /^\*\.[a-z0-9_+-]+$/i.test(t))) {
          const exts = new Set(terms.map((t) => t.slice(1).toLowerCase()));
          return (item) =>
            (item.lowerExt !== '' && exts.has(item.lowerExt)) ||
            (item.lowerName.startsWith('.') && exts.has(item.lowerName));
        }
      }
      const compiled = compilePattern(pat, spec.kind);
      if (compiled.error !== null) {
        problems.push({ field, code: 'invalidRegex', detail: compiled.error });
        return null;
      }
      const fn = compiled.matches;
      return fn ? (item) => fn(item.normName) : () => false;
    }
  }
}

const PREFIX_SEPARATORS: readonly string[] = ['.', '-', '_'];

/** UTF-16 code-unit binary search: first index `i` in `sorted` with `sorted[i] >= target`. */
function lowerBound(sorted: readonly string[], target: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

interface ConditionResult {
  readonly matched: boolean;
  readonly companions: readonly DirEntry[];
}

type CompiledCondition = (candidate: IndexedEntry) => ConditionResult;

const NO_COMPANIONS: readonly DirEntry[] = [];
const MATCH_NO_COMPANIONS: ConditionResult = { matched: true, companions: NO_COMPANIONS };
const MISS_NO_COMPANIONS: ConditionResult = { matched: false, companions: NO_COMPANIONS };

function compileCompanionCondition(
  cond: CompanionCondition,
  allItems: readonly IndexedEntry[],
  categories: readonly FileType[],
  problems: SelectIfProblem[],
): CompiledCondition | null {
  const matcher = compileMatcher(
    cond.partnerMatcher,
    `cond:${cond.id}:partnerMatcher`,
    categories,
    problems,
  );
  if (!matcher) {
    return null;
  }

  // Folder -> stem -> partner entries
  const byFolderAndStem = new Map<string, Map<string, DirEntry[]>>();
  for (const item of allItems) {
    if (!matchesEntryKind(item, cond.partnerKind) || !matcher(item)) {
      continue;
    }
    let stemMap = byFolderAndStem.get(item.folderKey);
    if (!stemMap) {
      stemMap = new Map<string, DirEntry[]>();
      byFolderAndStem.set(item.folderKey, stemMap);
    }
    let list = stemMap.get(item.lowerStem);
    if (!list) {
      list = [];
      stemMap.set(item.lowerStem, list);
    }
    list.push(item.entry);
  }

  // For `prefix` mode, pre-sort unique stems per folder in UTF-16 code-unit order: O(U log U)
  let sortedStemsByFolder: Map<string, readonly string[]> | null = null;
  if (cond.stemMatch === 'prefix') {
    sortedStemsByFolder = new Map<string, readonly string[]>();
    for (const [folderKey, stemMap] of byFolderAndStem) {
      const stems = [...stemMap.keys()];
      stems.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      sortedStemsByFolder.set(folderKey, stems);
    }
  }

  const wantExists = cond.operator === 'exists';
  const collectCompanions = wantExists && cond.includeCompanions;

  return (candidate) => {
    const stemMap = byFolderAndStem.get(candidate.folderKey);
    if (!stemMap) {
      return wantExists ? MISS_NO_COMPANIONS : MATCH_NO_COMPANIONS;
    }

    const candPath = candidate.entry.path;
    const candStem = candidate.lowerStem;

    if (!collectCompanions) {
      // Fast existence check without allocating companion arrays
      const exact = stemMap.get(candStem);
      let hasPartner = exact !== undefined && exact.some((p) => p.path !== candPath);
      if (!hasPartner && sortedStemsByFolder !== null) {
        const sorted = sortedStemsByFolder.get(candidate.folderKey)!;
        outer: for (const sep of PREFIX_SEPARATORS) {
          const loKey = candStem + sep;
          const hiKey = candStem + String.fromCharCode(sep.charCodeAt(0) + 1);
          for (let i = lowerBound(sorted, loKey); i < sorted.length && sorted[i] < hiKey; i++) {
            const list = stemMap.get(sorted[i])!;
            if (list.some((p) => p.path !== candPath)) {
              hasPartner = true;
              break outer;
            }
          }
        }
      }
      return hasPartner === wantExists ? MATCH_NO_COMPANIONS : MISS_NO_COMPANIONS;
    }

    // Collect matching companions (only when operator === 'exists' && includeCompanions)
    const companions: DirEntry[] = [];
    const exact = stemMap.get(candStem);
    if (exact) {
      for (const p of exact) {
        if (p.path !== candPath) {
          companions.push(p);
        }
      }
    }
    if (sortedStemsByFolder !== null) {
      const sorted = sortedStemsByFolder.get(candidate.folderKey)!;
      for (const sep of PREFIX_SEPARATORS) {
        const loKey = candStem + sep;
        const hiKey = candStem + String.fromCharCode(sep.charCodeAt(0) + 1);
        for (let i = lowerBound(sorted, loKey); i < sorted.length && sorted[i] < hiKey; i++) {
          const list = stemMap.get(sorted[i])!;
          for (const p of list) {
            if (p.path !== candPath) {
              companions.push(p);
            }
          }
        }
      }
    }
    return companions.length > 0 ? { matched: true, companions } : MISS_NO_COMPANIONS;
  };
}

function compileOtherPanelCondition(
  cond: OtherPanelCondition,
  otherEntries: readonly DirEntry[],
): CompiledCondition {
  const realOther = otherEntries.filter((e) => !isParentRow(e) && !isVirtualPath(e.path));
  const wantExists = cond.operator === 'exists';

  if (cond.compare === 'sameStem') {
    const stems = new Set<string>();
    for (const e of realOther) {
      const lower = nfc(e.name).toLowerCase();
      stems.add(lower.slice(0, stemLength(lower, isNavigableDir(e))));
    }
    return (cand) =>
      stems.has(cand.lowerStem) === wantExists ? MATCH_NO_COMPANIONS : MISS_NO_COMPANIONS;
  }

  const byName = new Map<string, DirEntry[]>();
  for (const e of realOther) {
    const key = nfc(e.name).toLowerCase();
    let list = byName.get(key);
    if (!list) {
      list = [];
      byName.set(key, list);
    }
    list.push(e);
  }

  return (cand) => {
    const peers = byName.get(cand.lowerName);
    let exists = false;
    if (peers !== undefined) {
      switch (cond.compare) {
        case 'sameName':
          exists = peers.length > 0;
          break;
        case 'sameNameAndSize':
          exists =
            cand.entry.size !== null &&
            peers.some((p) => p.size !== null && p.size === cand.entry.size);
          break;
        case 'newer':
          exists =
            cand.entry.modifiedMs !== null &&
            peers.some((p) => p.modifiedMs !== null && cand.entry.modifiedMs! > p.modifiedMs);
          break;
        case 'older':
          exists =
            cand.entry.modifiedMs !== null &&
            peers.some((p) => p.modifiedMs !== null && cand.entry.modifiedMs! < p.modifiedMs);
          break;
      }
    }
    return exists === wantExists ? MATCH_NO_COMPANIONS : MISS_NO_COMPANIONS;
  };
}

function parseNonNegativeNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) {
    return null;
  }
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function unitFactor(unit: SizeUnit, base: 1000 | 1024): number {
  switch (unit) {
    case 'B':
      return 1;
    case 'KB':
      return base;
    case 'MB':
      return base * base;
    case 'GB':
      return base * base * base;
  }
}

function compileSizeCondition(
  cond: SizeCondition,
  sizeBase: 1000 | 1024,
  problems: SelectIfProblem[],
): CompiledCondition | null {
  if (cond.operator === 'empty') {
    return (cand) => (cand.entry.size === 0 ? MATCH_NO_COMPANIONS : MISS_NO_COMPANIONS);
  }
  const factor = unitFactor(cond.unit, sizeBase);
  const minVal = parseNonNegativeNumber(cond.min);
  if (minVal === null) {
    problems.push({ field: `cond:${cond.id}:min`, code: 'invalidNumber' });
    return null;
  }
  const minBytes = minVal * factor;

  if (cond.operator === 'gt') {
    return (cand) =>
      cand.entry.size !== null && cand.entry.size > minBytes
        ? MATCH_NO_COMPANIONS
        : MISS_NO_COMPANIONS;
  }
  if (cond.operator === 'lt') {
    return (cand) =>
      cand.entry.size !== null && cand.entry.size < minBytes
        ? MATCH_NO_COMPANIONS
        : MISS_NO_COMPANIONS;
  }

  const maxVal = parseNonNegativeNumber(cond.max);
  if (maxVal === null) {
    problems.push({ field: `cond:${cond.id}:max`, code: 'invalidNumber' });
    return null;
  }
  const maxBytes = maxVal * factor;
  if (minBytes > maxBytes) {
    problems.push({ field: `cond:${cond.id}:max`, code: 'invalidRange' });
    return null;
  }
  return (cand) =>
    cand.entry.size !== null && cand.entry.size >= minBytes && cand.entry.size <= maxBytes
      ? MATCH_NO_COMPANIONS
      : MISS_NO_COMPANIONS;
}

/** Local midnight of `yyyy-mm-dd` (or end of that calendar day when `endOfDay === true`). */
function parseLocalDayMs(raw: string, endOfDay: boolean): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) {
    return null;
  }
  return endOfDay ? new Date(y, mo, d + 1).getTime() - 1 : dt.getTime();
}

function compileModifiedCondition(
  cond: ModifiedCondition,
  nowMs: number,
  problems: SelectIfProblem[],
): CompiledCondition | null {
  if (cond.operator === 'withinLast' || cond.operator === 'olderThan') {
    const n = parseNonNegativeNumber(cond.amount);
    if (n === null || n <= 0) {
      problems.push({ field: `cond:${cond.id}:amount`, code: 'invalidNumber' });
      return null;
    }
    const unitMs = cond.ageUnit === 'hours' ? 3_600_000 : 86_400_000;
    const cutoff = nowMs - n * unitMs;
    return cond.operator === 'withinLast'
      ? (cand) =>
          cand.entry.modifiedMs !== null && cand.entry.modifiedMs >= cutoff
            ? MATCH_NO_COMPANIONS
            : MISS_NO_COMPANIONS
      : (cand) =>
          cand.entry.modifiedMs !== null && cand.entry.modifiedMs < cutoff
            ? MATCH_NO_COMPANIONS
            : MISS_NO_COMPANIONS;
  }

  const fromStart = parseLocalDayMs(cond.dateFrom, false);
  if (fromStart === null) {
    problems.push({ field: `cond:${cond.id}:dateFrom`, code: 'invalidDate' });
    return null;
  }
  if (cond.operator === 'after') {
    return (cand) =>
      cand.entry.modifiedMs !== null && cand.entry.modifiedMs >= fromStart
        ? MATCH_NO_COMPANIONS
        : MISS_NO_COMPANIONS;
  }
  if (cond.operator === 'before') {
    return (cand) =>
      cand.entry.modifiedMs !== null && cand.entry.modifiedMs < fromStart
        ? MATCH_NO_COMPANIONS
        : MISS_NO_COMPANIONS;
  }

  const toEnd = parseLocalDayMs(cond.dateTo, true);
  if (toEnd === null) {
    problems.push({ field: `cond:${cond.id}:dateTo`, code: 'invalidDate' });
    return null;
  }
  if (fromStart > toEnd) {
    problems.push({ field: `cond:${cond.id}:dateTo`, code: 'invalidRange' });
    return null;
  }
  return (cand) =>
    cand.entry.modifiedMs !== null &&
    cand.entry.modifiedMs >= fromStart &&
    cand.entry.modifiedMs <= toEnd
      ? MATCH_NO_COMPANIONS
      : MISS_NO_COMPANIONS;
}

function compileNameCondition(
  cond: NameCondition,
  problems: SelectIfProblem[],
): CompiledCondition | null {
  const pat = nfc(cond.pattern.trim());
  if (!pat) {
    problems.push({ field: `cond:${cond.id}:pattern`, code: 'emptyPattern' });
    return null;
  }
  const compiled = compilePattern(pat, cond.mode);
  if (compiled.error !== null) {
    problems.push({
      field: `cond:${cond.id}:pattern`,
      code: 'invalidRegex',
      detail: compiled.error,
    });
    return null;
  }
  const fn = compiled.matches;
  const wantMatch = cond.operator === 'matches';
  return (cand) =>
    (fn ? fn(cand.normName) : false) === wantMatch ? MATCH_NO_COMPANIONS : MISS_NO_COMPANIONS;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

export function evaluateSelectIf(
  entries: readonly DirEntry[],
  rule: SelectIfRule,
  ctx: SelectIfContext,
): SelectIfEvaluation {
  const unmarkable = ctx.unmarkablePaths;
  const items: IndexedEntry[] = [];
  for (const e of entries) {
    if (isParentRow(e) || isVirtualPath(e.path) || unmarkable?.has(e.path)) {
      continue;
    }
    items.push(indexEntry(e));
  }

  const problems: SelectIfProblem[] = [];
  const targetMatcher = compileMatcher(
    rule.targetMatcher,
    'targetMatcher',
    ctx.categories,
    problems,
  );
  if (rule.conditions.length === 0) {
    problems.push({ field: 'conditions', code: 'noConditions' });
  }

  const sizeBase = ctx.sizeBase ?? 1024;
  const nowMs = ctx.nowMs ?? Date.now();
  const otherEntries = ctx.otherEntries ?? [];
  const compiledConditions: CompiledCondition[] = [];

  for (const cond of rule.conditions) {
    let fn: CompiledCondition | null = null;
    switch (cond.kind) {
      case 'companion':
        fn = compileCompanionCondition(cond, items, ctx.categories, problems);
        break;
      case 'otherPanel':
        fn = compileOtherPanelCondition(cond, otherEntries);
        break;
      case 'size':
        fn = compileSizeCondition(cond, sizeBase, problems);
        break;
      case 'modified':
        fn = compileModifiedCondition(cond, nowMs, problems);
        break;
      case 'name':
        fn = compileNameCondition(cond, problems);
        break;
    }
    if (fn) {
      compiledConditions.push(fn);
    }
  }

  const currentMarks = ctx.currentMarks ?? EMPTY_SET;
  if (problems.length > 0 || !targetMatcher) {
    // Keep existing marks untouched when the rule has validation errors
    const kept = new Set<string>();
    let keptBytes = 0;
    for (const item of items) {
      if (currentMarks.has(item.entry.path)) {
        kept.add(item.entry.path);
        keptBytes += item.entry.size ?? 0;
      }
    }
    return {
      problems,
      totalEntries: items.length,
      rulePrimaryPaths: EMPTY_SET,
      ruleCompanionPaths: EMPTY_SET,
      ruleHitPaths: EMPTY_SET,
      ruleBytes: 0,
      nextMarkedPaths: kept,
      nextMarkedBytes: keptBytes,
      addedCount: 0,
      removedCount: 0,
      excludedCandidatePaths: EMPTY_SET,
      previewItems: [],
    };
  }

  const primaryPaths = new Set<string>();
  const rawCompanionPaths = new Set<string>();
  const candidatePaths = new Set<string>();
  const requireAll = rule.matchMode === 'all';

  for (const item of items) {
    if (!matchesEntryKind(item, rule.targetKind) || !targetMatcher(item)) {
      continue;
    }
    candidatePaths.add(item.entry.path);

    let overall = requireAll;
    let pendingCompanions: DirEntry[] | null = null;

    for (const condFn of compiledConditions) {
      const r = condFn(item);
      if (requireAll) {
        if (!r.matched) {
          overall = false;
          pendingCompanions = null;
          break;
        }
        if (r.companions.length > 0) {
          (pendingCompanions ??= []).push(...r.companions);
        }
      } else if (r.matched) {
        overall = true;
        if (r.companions.length > 0) {
          (pendingCompanions ??= []).push(...r.companions);
        }
      }
    }

    if (overall) {
      primaryPaths.add(item.entry.path);
      if (pendingCompanions !== null) {
        for (const comp of pendingCompanions) {
          rawCompanionPaths.add(comp.path);
        }
      }
    }
  }

  const companionPaths = new Set<string>();
  for (const p of rawCompanionPaths) {
    if (!primaryPaths.has(p)) {
      companionPaths.add(p);
    }
  }

  const ruleHitPaths = new Set<string>(primaryPaths);
  for (const p of companionPaths) {
    ruleHitPaths.add(p);
  }

  // Apply combineMode against existing marks on markable entries
  const existingMarked = new Set<string>();
  for (const item of items) {
    if (currentMarks.has(item.entry.path)) {
      existingMarked.add(item.entry.path);
    }
  }

  const nextMarkedPaths = new Set<string>();
  switch (rule.combineMode) {
    case 'replace':
      for (const p of ruleHitPaths) {
        nextMarkedPaths.add(p);
      }
      break;
    case 'add':
      for (const p of existingMarked) {
        nextMarkedPaths.add(p);
      }
      for (const p of ruleHitPaths) {
        nextMarkedPaths.add(p);
      }
      break;
    case 'remove':
      for (const p of existingMarked) {
        if (!ruleHitPaths.has(p)) {
          nextMarkedPaths.add(p);
        }
      }
      break;
    case 'intersect':
      for (const p of existingMarked) {
        if (ruleHitPaths.has(p)) {
          nextMarkedPaths.add(p);
        }
      }
      break;
  }

  let ruleBytes = 0;
  let nextMarkedBytes = 0;
  let addedCount = 0;
  let removedCount = 0;
  const excludedCandidatePaths = new Set<string>();
  const previewItems: SelectIfPreviewItem[] = [];

  for (const item of items) {
    const p = item.entry.path;
    const size = item.entry.size ?? 0;
    const inRule = ruleHitPaths.has(p);
    const inNext = nextMarkedPaths.has(p);
    const wasMarked = existingMarked.has(p);

    if (inRule) {
      ruleBytes += size;
    }
    if (inNext) {
      nextMarkedBytes += size;
      if (!wasMarked) {
        addedCount++;
      }
    } else if (wasMarked) {
      removedCount++;
    }

    const activeHit =
      rule.combineMode === 'remove'
        ? inRule && wasMarked
        : rule.combineMode === 'intersect'
          ? inNext
          : inRule;

    if (activeHit) {
      previewItems.push({
        entry: item.entry,
        role: primaryPaths.has(p) ? 'primary' : 'companion',
      });
    } else if (candidatePaths.has(p)) {
      excludedCandidatePaths.add(p);
      previewItems.push({ entry: item.entry, role: 'excluded' });
    }
  }

  return {
    problems,
    totalEntries: items.length,
    rulePrimaryPaths: primaryPaths,
    ruleCompanionPaths: companionPaths,
    ruleHitPaths,
    ruleBytes,
    nextMarkedPaths,
    nextMarkedBytes,
    addedCount,
    removedCount,
    excludedCandidatePaths,
    previewItems,
  };
}

// ---- Defensive restore from settings / dialogs.recent ----

function restoreMatcher(raw: unknown, fallback: MatcherSpec): MatcherSpec {
  const r = record(raw);
  const kind = oneOf(r['kind'], MATCHER_KINDS, fallback.kind);
  switch (kind) {
    case 'any':
      return { kind: 'any' };
    case 'category':
      return {
        kind: 'category',
        category: textOr(
          r['category'],
          fallback.kind === 'category' ? fallback.category : 'movies',
          100,
        ),
      };
    case 'glob':
      return {
        kind: 'glob',
        pattern: textOr(r['pattern'], fallback.kind === 'glob' ? fallback.pattern : '*', 500),
      };
    case 'regex':
      return {
        kind: 'regex',
        pattern: textOr(r['pattern'], fallback.kind === 'regex' ? fallback.pattern : '', 500),
      };
  }
}

function restoreCondition(raw: unknown, index: number): ConditionSpec | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const r = record(raw);
  const kind = oneOf(r['kind'], CONDITION_KINDS, 'companion');
  const id = textOr(r['id'], `c${index + 1}`, 32).trim() || `c${index + 1}`;
  switch (kind) {
    case 'companion': {
      const def = defaultCondition('companion', id) as CompanionCondition;
      return {
        id,
        kind: 'companion',
        operator: oneOf(r['operator'], EXISTENCE_OPERATORS, def.operator),
        partnerKind: oneOf(r['partnerKind'], ENTRY_KINDS, def.partnerKind),
        partnerMatcher: restoreMatcher(r['partnerMatcher'], def.partnerMatcher),
        stemMatch: oneOf(r['stemMatch'], STEM_MATCH_MODES, def.stemMatch),
        includeCompanions: boolOr(r['includeCompanions'], def.includeCompanions),
      };
    }
    case 'otherPanel': {
      const def = defaultCondition('otherPanel', id) as OtherPanelCondition;
      return {
        id,
        kind: 'otherPanel',
        operator: oneOf(r['operator'], EXISTENCE_OPERATORS, def.operator),
        compare: oneOf(r['compare'], OTHER_PANEL_COMPARES, def.compare),
      };
    }
    case 'size': {
      const def = defaultCondition('size', id) as SizeCondition;
      return {
        id,
        kind: 'size',
        operator: oneOf(r['operator'], SIZE_OPERATORS, def.operator),
        min: textOr(r['min'], def.min, 32),
        max: textOr(r['max'], def.max, 32),
        unit: oneOf(r['unit'], SIZE_UNITS, def.unit),
      };
    }
    case 'modified': {
      const def = defaultCondition('modified', id) as ModifiedCondition;
      return {
        id,
        kind: 'modified',
        operator: oneOf(r['operator'], MODIFIED_OPERATORS, def.operator),
        amount: textOr(r['amount'], def.amount, 32),
        ageUnit: oneOf(r['ageUnit'], AGE_UNITS, def.ageUnit),
        dateFrom: textOr(r['dateFrom'], def.dateFrom, 16),
        dateTo: textOr(r['dateTo'], def.dateTo, 16),
      };
    }
    case 'name': {
      const def = defaultCondition('name', id) as NameCondition;
      return {
        id,
        kind: 'name',
        operator: oneOf(r['operator'], NAME_OPERATORS, def.operator),
        mode: oneOf(r['mode'], NAME_MODES, def.mode),
        pattern: textOr(r['pattern'], def.pattern, 500),
      };
    }
  }
}

export function restoreSelectIfRule(raw: unknown): SelectIfRule {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return DEFAULT_SELECT_IF_RULE;
  }
  const r = record(raw);
  const d = DEFAULT_SELECT_IF_RULE;
  const rawConds = Array.isArray(r['conditions']) ? r['conditions'] : [];
  const restored: ConditionSpec[] = [];
  const usedIds = new Set<string>();
  for (let i = 0; i < rawConds.length && restored.length < MAX_CONDITIONS; i++) {
    const c = restoreCondition(rawConds[i], i);
    if (c) {
      const uniqueId = usedIds.has(c.id) ? `c${i + 1}_${restored.length}` : c.id;
      usedIds.add(uniqueId);
      restored.push(uniqueId === c.id ? c : { ...c, id: uniqueId });
    }
  }
  return {
    targetKind: oneOf(r['targetKind'], ENTRY_KINDS, d.targetKind),
    targetMatcher: restoreMatcher(r['targetMatcher'], d.targetMatcher),
    matchMode: oneOf(r['matchMode'], CONDITION_JOINS, d.matchMode),
    conditions: restored.length > 0 ? restored : d.conditions,
    combineMode: oneOf(r['combineMode'], COMBINE_MODES, d.combineMode),
  };
}

/** Templates read back from `selectIf.templates`: unique non-empty labels, up to `MAX_TEMPLATES`. */
export function restoreSelectIfTemplates(raw: readonly unknown[]): SelectIfTemplate[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: SelectIfTemplate[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }
    const r = record(item);
    const label = textOr(r['label'], '', MAX_TEMPLATE_LABEL).trim();
    if (!label || typeof r['rule'] !== 'object' || r['rule'] === null) {
      continue;
    }
    if (!out.some((t) => t.label === label)) {
      out.push({ label, rule: restoreSelectIfRule(r['rule']) });
    }
    if (out.length >= MAX_TEMPLATES) {
      break;
    }
  }
  return out;
}
