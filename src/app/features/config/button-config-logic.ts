import { ActionId, isActionId } from '../../core/actions/action-catalog';
import { ButtonSetsOverride, MAX_BUTTON_SLOTS } from '../../core/config/config.models';
import { MODIFIER_SETS, ModifierSet } from '../workspace/button-bar/button-config';

/** Effective button sets: built in, overridden per set (design 022 E1). */
export type ButtonSets = Readonly<Record<ModifierSet, readonly ActionId[]>>;

export interface ResolvedButtons {
  readonly sets: ButtonSets;
  /** Ids of the user file that the catalog does not know (dropped). */
  readonly unknown: readonly string[];
}

/** Built-in sets with the user's sets in their place; unknown ids, duplicates and extra slots dropped. */
export function resolveButtonSets(
  builtIn: ButtonSets,
  override: ButtonSetsOverride,
): ResolvedButtons {
  const unknown: string[] = [];
  const sets = {} as Record<ModifierSet, readonly ActionId[]>;
  for (const set of MODIFIER_SETS) {
    const user = Object.prototype.hasOwnProperty.call(override, set) ? override[set] : undefined;
    if (!Array.isArray(user)) {
      sets[set] = builtIn[set];
      continue;
    }
    const ids: ActionId[] = [];
    for (const id of user as readonly string[]) {
      if (!isActionId(id)) {
        if (!unknown.includes(id)) {
          unknown.push(id);
        }
      } else if (!ids.includes(id) && ids.length < MAX_BUTTON_SLOTS) {
        ids.push(id);
      }
    }
    sets[set] = ids;
  }
  return { sets, unknown };
}

/** Only the sets that differ from the built-in ones (keeps `buttons.json` minimal). */
export function minimalOverride(builtIn: ButtonSets, sets: ButtonSets): ButtonSetsOverride {
  const out: Record<string, readonly string[]> = {};
  for (const set of MODIFIER_SETS) {
    if (!sameIds(builtIn[set], sets[set])) {
      out[set] = [...sets[set]];
    }
  }
  return out;
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Moves slot `i` by `delta`; the list unchanged if it would leave the list. */
export function moveSlot<T>(list: readonly T[], i: number, delta: number): readonly T[] {
  const j = i + delta;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) {
    return list;
  }
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function removeSlot<T>(list: readonly T[], i: number): readonly T[] {
  return i >= 0 && i < list.length ? list.filter((_, k) => k !== i) : list;
}

/** Why an action cannot be added to a set: full, or already there. */
export function addProblem(
  list: readonly ActionId[],
  id: ActionId | null,
): 'none' | 'full' | 'present' | null {
  if (id === null) {
    return 'none';
  }
  if (list.includes(id)) {
    return 'present';
  }
  return list.length >= MAX_BUTTON_SLOTS ? 'full' : null;
}

/** Inserts `id` after position `at` (−1 = first). */
export function insertSlot(
  list: readonly ActionId[],
  at: number,
  id: ActionId,
): readonly ActionId[] {
  if (addProblem(list, id) !== null) {
    return list;
  }
  const pos = Math.max(0, Math.min(list.length, at + 1));
  return [...list.slice(0, pos), id, ...list.slice(pos)];
}

/** Replaces slot `i` with `id` (not if `id` is elsewhere in the set). */
export function replaceSlot(
  list: readonly ActionId[],
  i: number,
  id: ActionId,
): readonly ActionId[] {
  if (i < 0 || i >= list.length || list.some((x, k) => x === id && k !== i)) {
    return list;
  }
  return list.map((x, k) => (k === i ? id : x));
}
