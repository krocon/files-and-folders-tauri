import { ExpectedEntry, DedupeGroup } from '../../core/jobs/jobs.models';
import { SearchHit } from '../../core/search/search.models';

/**
 * "Which file stays?" (design 042 E2) – pure, no Angular, no I/O.
 *
 * A group consists of **units** (one physical file: a primary name plus its hard links,
 * `sameAs`). Rules run in order on the units that are still candidates; a rule
 * *separates* when some but not all candidates are best by it – then only those stay
 * candidates. One candidate left → it is kept, every other unit is marked for deletion;
 * more than one left after the last rule → the group stays **undecided** (nothing
 * marked). A whole group is never marked.
 *
 * Before the user's rules, units whose file has other names (`links > 1`) are
 * preferred: deleting one of their names frees nothing. Such units are never marked.
 */

export type RuleKind =
  | 'oldest'
  | 'newest'
  | 'shortestName'
  | 'longestName'
  | 'shortestPath'
  | 'longestPath'
  | 'pathPattern'
  | 'inFolder'
  | 'noCopySuffix'
  | 'largerResolution'
  | 'largerFile'
  | 'firstFound';

export const RULE_KINDS: readonly RuleKind[] = [
  'oldest',
  'newest',
  'shortestName',
  'longestName',
  'shortestPath',
  'longestPath',
  'pathPattern',
  'inFolder',
  'noCopySuffix',
  'largerResolution',
  'largerFile',
  'firstFound',
];

/** Pattern and folder rules: prefer keeping the matching files, or deleting them. */
export type Prefer = 'keep' | 'delete';

export interface Rule {
  readonly kind: RuleKind;
  /** `pathPattern`: glob (`*`, `**`, `?`; anywhere in the path) or a regular expression. */
  readonly pattern?: string;
  readonly syntax?: 'glob' | 'regex';
  readonly caseSensitive?: boolean;
  /** `pathPattern`, `inFolder`. Default `keep`. */
  readonly prefer?: Prefer;
  /** `inFolder`: an opaque folder path (from Rust). */
  readonly folder?: string;
}

export interface RuleSet {
  readonly rules: readonly Rule[];
}

/** Why a unit stays: a rule (its index), the hard-link preference, or the user. */
export type Reason = number | 'links' | 'manual';

export type Decision =
  /** This file stays. */
  | 'keep'
  /** A copy to delete. */
  | 'delete'
  /** Another name of a file in the group (hard link) – the same file. */
  | 'same'
  /** Not deleted: the file has other names, deleting this one frees nothing. */
  | 'spare'
  /** No rule separated the files of this group. */
  | 'undecided';

export interface RowDecision {
  readonly decision: Decision;
  /** Why (for `keep`/`delete`), else null. */
  readonly reason: Reason | null;
}

export interface DecideContext {
  /** `inFolder`: whether `path` lies in the folder of rule `rule` (Rust `classify_paths`). */
  readonly inFolder?: (path: string, rule: number) => boolean;
}

export interface DecideResult {
  /** Paths to mark (= delete). */
  readonly marks: readonly string[];
  readonly decisions: ReadonlyMap<string, RowDecision>;
  /** Groups no rule separated. */
  readonly undecided: readonly number[];
}

export interface RuleError {
  readonly rule: number;
  readonly reason: 'emptyPattern' | 'badRegex' | 'noFolder';
}

/** One physical file of a group. */
export interface Unit {
  readonly primary: SearchHit;
  readonly aliases: readonly SearchHit[];
}

// ---------------------------------------------------------------- matching

/** The path with `\` as `/` – only for matching patterns (no path is computed from it). */
function forMatching(path: string): string {
  return path.replaceAll('\\', '/');
}

function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** Glob → regex source: `**` any characters, `*` any but `/`, `?` one but `/`; unanchored. */
export function globSource(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i++;
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '\\') {
      out += '/';
    } else {
      out += escapeRe(c);
    }
  }
  return out;
}

function compilePattern(r: Rule): RegExp | 'empty' | 'bad' {
  const p = r.pattern ?? '';
  if (p.trim() === '') {
    return 'empty';
  }
  const source = r.syntax === 'regex' ? p : globSource(p);
  try {
    return new RegExp(source, r.caseSensitive ? 'u' : 'iu');
  } catch {
    return 'bad';
  }
}

/** The first problem of a rule set (null = usable). */
export function validateRuleSet(set: RuleSet): RuleError | null {
  for (const [i, r] of set.rules.entries()) {
    if (r.kind === 'pathPattern') {
      const re = compilePattern(r);
      if (re === 'empty') {
        return { rule: i, reason: 'emptyPattern' };
      }
      if (re === 'bad') {
        return { rule: i, reason: 'badRegex' };
      }
    }
    if (r.kind === 'inFolder' && !r.folder) {
      return { rule: i, reason: 'noFolder' };
    }
  }
  return null;
}

// ---------------------------------------------------------------- copy names

const COPY_PREFIX = /^(?:kopie von|copy of|copie de|copia de)\s+/iu;
const COPY_SUFFIX = /(?:^|[\s_-])(?:kopie|copy|copie|copia)(?:\s*\(?\d+\)?)?$/iu;
const NUMBER_SUFFIX = /\s*\(\d+\)$/u;

/** Name without its extension (a leading dot is part of the name). */
function stemOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** Looks like a copy made by a file manager: `Kopie von a`, `a - Copy (2)`, `a copy 2`, `a (1)`. */
export function isCopyName(name: string): boolean {
  const stem = stemOf(name).trim();
  return COPY_PREFIX.test(stem) || COPY_SUFFIX.test(stem) || NUMBER_SUFFIX.test(stem);
}

// ---------------------------------------------------------------- groups and units

/** The rows of each group, in the given order (rows without a group left out). */
export function groupRows(rows: readonly SearchHit[]): Map<number, SearchHit[]> {
  const groups = new Map<number, SearchHit[]>();
  for (const r of rows) {
    if (r.group === undefined) {
      continue;
    }
    const list = groups.get(r.group);
    if (list) {
      list.push(r);
    } else {
      groups.set(r.group, [r]);
    }
  }
  return groups;
}

/** Units of a group: rows with the same `sameAs ?? path`; the row without `sameAs` leads. */
export function unitsOf(group: readonly SearchHit[]): Unit[] {
  const by = new Map<string, SearchHit[]>();
  for (const r of group) {
    const key = r.sameAs ?? r.path;
    const list = by.get(key);
    if (list) {
      list.push(r);
    } else {
      by.set(key, [r]);
    }
  }
  return [...by.values()].map((list) => {
    const primary = list.find((r) => r.sameAs === undefined) ?? list[0];
    return { primary, aliases: list.filter((r) => r !== primary) };
  });
}

const linked = (u: Unit) => (u.primary.links ?? 1) > 1;

// ---------------------------------------------------------------- rules

/** Value of a unit by a rule – higher is better; null = unknown (the rule does not separate). */
function value(r: Rule, i: number, u: Unit, re: RegExp | null, ctx: DecideContext): number | null {
  const h = u.primary;
  const prefer = (yes: boolean) => ((r.prefer ?? 'keep') === 'keep' ? (yes ? 1 : 0) : yes ? 0 : 1);
  switch (r.kind) {
    case 'oldest':
      return h.modifiedMs == null ? null : -h.modifiedMs;
    case 'newest':
      return h.modifiedMs ?? null;
    case 'shortestName':
      return -[...h.name].length;
    case 'longestName':
      return [...h.name].length;
    case 'shortestPath':
      return -[...h.path].length;
    case 'longestPath':
      return [...h.path].length;
    case 'pathPattern':
      return re ? prefer(re.test(forMatching(h.path))) : null;
    case 'inFolder':
      return ctx.inFolder ? prefer(ctx.inFolder(h.path, i)) : null;
    case 'noCopySuffix':
      return isCopyName(h.name) ? 0 : 1;
    case 'largerResolution':
      return h.width == null || h.height == null ? null : h.width * h.height;
    case 'largerFile':
      return h.size ?? null;
    case 'firstFound':
      return h.order == null ? null : -h.order;
  }
}

/** Keeps the best candidates by `score`; `separated` = some but not all stayed. */
function narrow(
  candidates: Unit[],
  score: (u: Unit) => number | null,
): { candidates: Unit[]; separated: boolean } {
  const values = candidates.map(score);
  if (values.some((v) => v === null)) {
    return { candidates, separated: false };
  }
  const best = Math.max(...(values as number[]));
  const kept = candidates.filter((_, k) => values[k] === best);
  return { candidates: kept, separated: kept.length < candidates.length };
}

/**
 * Applies `set` to every group of `rows`. An invalid set (see {@link validateRuleSet})
 * marks nothing – every group is undecided.
 */
export function decide(
  rows: readonly SearchHit[],
  set: RuleSet,
  ctx: DecideContext = {},
): DecideResult {
  const marks: string[] = [];
  const decisions = new Map<string, RowDecision>();
  const undecided: number[] = [];
  const invalid = validateRuleSet(set) !== null;
  const patterns = set.rules.map((r) => {
    const re = r.kind === 'pathPattern' ? compilePattern(r) : null;
    return re instanceof RegExp ? re : null;
  });
  for (const [g, group] of groupRows(rows)) {
    const units = unitsOf(group);
    for (const u of units) {
      for (const a of u.aliases) {
        decisions.set(a.path, { decision: 'same', reason: null });
      }
    }
    if (units.length < 2) {
      // the other files were deleted or filtered: nothing to decide
      decisions.set(units[0]?.primary.path ?? '', { decision: 'keep', reason: null });
      continue;
    }
    let candidates = units;
    let reason: Reason | null = null;
    const pre = narrow(candidates, (u) => (linked(u) ? 1 : 0));
    if (pre.separated) {
      candidates = pre.candidates;
      reason = 'links';
    }
    if (!invalid) {
      for (const [i, r] of set.rules.entries()) {
        if (candidates.length === 1) {
          break;
        }
        const step = narrow(candidates, (u) => value(r, i, u, patterns[i], ctx));
        if (step.separated) {
          candidates = step.candidates;
          reason = i;
        }
      }
    }
    if (candidates.length !== 1 || invalid) {
      undecided.push(g);
      for (const u of units) {
        decisions.set(u.primary.path, { decision: 'undecided', reason: null });
      }
      continue;
    }
    const keep = candidates[0];
    for (const u of units) {
      if (u === keep) {
        decisions.set(u.primary.path, { decision: 'keep', reason });
      } else if (linked(u)) {
        decisions.set(u.primary.path, { decision: 'spare', reason: null });
      } else {
        decisions.set(u.primary.path, { decision: 'delete', reason });
        marks.push(u.primary.path);
      }
    }
  }
  return { marks, decisions, undecided };
}

// ---------------------------------------------------------------- summary and job

export interface DedupePlan {
  readonly groups: readonly DedupeGroup[];
  /** The same groups as rows (names for the confirmation – paths are not split here). */
  readonly rows: readonly { readonly keep: SearchHit; readonly remove: readonly SearchHit[] }[];
  /** Copies to remove and the bytes that become free. */
  readonly files: number;
  readonly bytes: number;
  /** Groups with marks but no unmarked file left – nothing of them is deleted. */
  readonly withoutKeep: readonly number[];
}

function expected(h: SearchHit): ExpectedEntry {
  return { path: h.path, kind: 'file', size: h.size ?? null, modifiedMs: h.modifiedMs ?? null };
}

/**
 * The `dedupe` job's groups from the marks: per group the marked units (their primary
 * names; aliases and linked units are never removed) and one unmarked unit to keep
 * (the one decided `keep`, else the first). A group whose every unit is marked is left out.
 */
export function dedupePlan(
  rows: readonly SearchHit[],
  marked: ReadonlySet<string>,
  decisions?: ReadonlyMap<string, RowDecision>,
): DedupePlan {
  const groups: DedupeGroup[] = [];
  const shown: { keep: SearchHit; remove: SearchHit[] }[] = [];
  const withoutKeep: number[] = [];
  let files = 0;
  let bytes = 0;
  for (const [g, group] of groupRows(rows)) {
    const units = unitsOf(group);
    const remove = units.filter((u) => marked.has(u.primary.path) && !linked(u));
    if (remove.length === 0) {
      continue;
    }
    const rest = units.filter((u) => !remove.includes(u));
    if (rest.length === 0) {
      withoutKeep.push(g);
      continue;
    }
    const keep = rest.find((u) => decisions?.get(u.primary.path)?.decision === 'keep') ?? rest[0];
    groups.push({ keep: expected(keep.primary), remove: remove.map((u) => expected(u.primary)) });
    shown.push({ keep: keep.primary, remove: remove.map((u) => u.primary) });
    files += remove.length;
    bytes += remove.reduce((sum, u) => sum + (u.primary.size ?? 0), 0);
  }
  return { groups, rows: shown, files, bytes, withoutKeep };
}

/** Marks for "keep this one": every other unit of its group (not linked ones), none of this. */
export function keepOnly(
  rows: readonly SearchHit[],
  path: string,
): { mark: string[]; unmark: string[] } | null {
  const row = rows.find((r) => r.path === path);
  if (!row || row.group === undefined) {
    return null;
  }
  const units = unitsOf(rows.filter((r) => r.group === row.group));
  const own = units.find((u) => u.primary.path === path || u.aliases.some((a) => a.path === path));
  if (!own || units.length < 2) {
    return null;
  }
  const mark: string[] = [];
  const unmark: string[] = [own.primary.path, ...own.aliases.map((a) => a.path)];
  for (const u of units) {
    if (u === own) {
      continue;
    }
    if (linked(u)) {
      unmark.push(u.primary.path);
    } else {
      mark.push(u.primary.path);
    }
    unmark.push(...u.aliases.map((a) => a.path));
  }
  return { mark, unmark };
}

/** Group numbers in the order of `rows` (for next/previous group). */
export function groupOrder(rows: readonly SearchHit[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of rows) {
    if (r.group !== undefined && !seen.has(r.group)) {
      seen.add(r.group);
      out.push(r.group);
    }
  }
  return out;
}

/** Built-in rule sets (design 042 E2) – their names come from the texts. */
export type BuiltInSet =
  'copyNamesThenOldest' | 'oldest' | 'newest' | 'shortestPath' | 'resolution';

export const BUILT_IN_SETS: Readonly<Record<BuiltInSet, RuleSet>> = {
  copyNamesThenOldest: {
    rules: [{ kind: 'noCopySuffix' }, { kind: 'oldest' }, { kind: 'shortestPath' }],
  },
  oldest: { rules: [{ kind: 'oldest' }, { kind: 'shortestPath' }, { kind: 'firstFound' }] },
  newest: { rules: [{ kind: 'newest' }, { kind: 'shortestPath' }, { kind: 'firstFound' }] },
  shortestPath: { rules: [{ kind: 'shortestPath' }, { kind: 'firstFound' }] },
  resolution: {
    rules: [
      { kind: 'largerResolution' },
      { kind: 'largerFile' },
      { kind: 'noCopySuffix' },
      { kind: 'oldest' },
    ],
  },
};

/**
 * What the "Decision" column shows for a row: the marks are the truth (marked =
 * delete), the rule result only explains them. `groupMarked`: some row of the row's
 * group is marked. Null = nothing to show (no rules applied, nothing marked).
 */
export function shownDecision(
  row: SearchHit,
  marked: boolean,
  groupMarked: boolean,
  engine: RowDecision | undefined,
): RowDecision | null {
  if (row.sameAs !== undefined) {
    return { decision: 'same', reason: null };
  }
  if (marked) {
    return {
      decision: 'delete',
      reason: engine?.decision === 'delete' ? engine.reason : 'manual',
    };
  }
  if ((row.links ?? 1) > 1 && engine?.decision !== 'keep') {
    return { decision: 'spare', reason: null };
  }
  if (engine?.decision === 'keep') {
    return engine;
  }
  if (groupMarked) {
    return { decision: 'keep', reason: 'manual' };
  }
  if (engine?.decision === 'undecided') {
    return engine;
  }
  return null;
}

/** Groups with at least one marked row. */
export function markedGroups(rows: readonly SearchHit[], marked: ReadonlySet<string>): Set<number> {
  const out = new Set<number>();
  if (marked.size === 0) {
    return out;
  }
  for (const r of rows) {
    if (r.group !== undefined && marked.has(r.path)) {
      out.add(r.group);
    }
  }
  return out;
}
