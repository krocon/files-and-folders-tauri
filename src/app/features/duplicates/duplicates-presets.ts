import { RenamePresets } from '../../core/rename/rename.models';
import {
  BUILT_IN_SETS,
  BuiltInSet,
  Prefer,
  Rule,
  RULE_KINDS,
  RuleKind,
  RuleSet,
} from './duplicates-rules';

/**
 * Rule sets of the duplicate search (design 042 E2): the built-in ones plus the user's,
 * stored in `duplicate-rules.json` with the shape of the multi-rename presets
 * (`{ version, last, presets: [{ name, rules }] }`). `last` = the set chosen last.
 * Pure – loading and saving is the store's job.
 */

/** A chosen set: built-in (`b:<id>`), the user's (`u:<name>`) or none. */
export type SetId = 'none' | `b:${BuiltInSet}` | `u:${string}`;

export interface UserSet {
  readonly name: string;
  readonly set: RuleSet;
}

export const MAX_RULES = 12;
export const MAX_SET_NAME = 100;

const PREFERS: readonly Prefer[] = ['keep', 'delete'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A rule read from a file – unknown kinds and wrong field types are dropped. */
export function readRule(v: unknown): Rule | null {
  if (!isRecord(v) || !RULE_KINDS.includes(v['kind'] as RuleKind)) {
    return null;
  }
  const kind = v['kind'] as RuleKind;
  const str = (k: string) =>
    typeof v[k] === 'string' ? (v[k] as string).slice(0, 2000) : undefined;
  const prefer = PREFERS.includes(v['prefer'] as Prefer) ? (v['prefer'] as Prefer) : undefined;
  switch (kind) {
    case 'pathPattern':
      return {
        kind,
        pattern: str('pattern') ?? '',
        syntax: v['syntax'] === 'regex' ? 'regex' : 'glob',
        caseSensitive: v['caseSensitive'] === true,
        prefer: prefer ?? 'keep',
      };
    case 'inFolder':
      return { kind, folder: str('folder') ?? '', prefer: prefer ?? 'keep' };
    default:
      return { kind };
  }
}

export function readSet(v: unknown): RuleSet | null {
  if (!isRecord(v) || !Array.isArray(v['rules'])) {
    return null;
  }
  const rules = (v['rules'] as unknown[])
    .map(readRule)
    .filter((r): r is Rule => r !== null)
    .slice(0, MAX_RULES);
  return { rules };
}

/** The user's sets of a loaded file (first of a name wins). */
export function userSets(file: RenamePresets): UserSet[] {
  const out: UserSet[] = [];
  for (const p of file.presets) {
    const set = readSet(p.rules);
    const name = p.name.trim();
    if (set && name !== '' && !out.some((u) => u.name === name)) {
      out.push({ name, set });
    }
  }
  return out;
}

/** The chosen set stored in `last` (`{ id }`), if valid. */
export function lastSetId(file: RenamePresets): SetId | null {
  const last = file.last;
  if (!isRecord(last) || typeof last['id'] !== 'string') {
    return null;
  }
  return parseSetId(last['id']);
}

export function parseSetId(id: string): SetId | null {
  if (id === 'none') {
    return 'none';
  }
  if (id.startsWith('b:') && id.slice(2) in BUILT_IN_SETS) {
    return id as SetId;
  }
  if (id.startsWith('u:') && id.length > 2) {
    return id as SetId;
  }
  return null;
}

/** The rules of a chosen set (null: none, or a user set that is gone). */
export function setOf(id: SetId, users: readonly UserSet[]): RuleSet | null {
  if (id === 'none') {
    return null;
  }
  if (id.startsWith('b:')) {
    return BUILT_IN_SETS[id.slice(2) as BuiltInSet] ?? null;
  }
  return users.find((u) => u.name === id.slice(2))?.set ?? null;
}

/** The file to save: the user's sets and the chosen one. */
export function toFile(users: readonly UserSet[], last: SetId): RenamePresets {
  return {
    version: 1,
    last: { id: last },
    presets: users.map((u) => ({ name: u.name, rules: { rules: u.set.rules } })),
  };
}

/** Adds or replaces the user set `name`. */
export function withUserSet(users: readonly UserSet[], name: string, set: RuleSet): UserSet[] {
  const n = name.trim().slice(0, MAX_SET_NAME);
  const rest = users.filter((u) => u.name !== n);
  return [...rest, { name: n, set: { rules: set.rules.slice(0, MAX_RULES) } }].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/** The default when nothing was chosen yet (Marc, 042 §8.2): copy names go, else the oldest. */
export function defaultSetId(images: boolean): SetId {
  return images ? 'b:resolution' : 'b:copyNamesThenOldest';
}
