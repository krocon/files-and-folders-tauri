import { DirEntry, isNavigableDir, isParentRow } from '../../core/fs/fs.models';
import { Platform } from '../../core/actions/platform';
import {
  FileActionModifier,
  FileActionRule,
  FileActionTrigger,
  MODIFIER_ORDER,
} from '../../core/fileactions/file-actions.models';

function globToRegex(glob: string): RegExp {
  const source = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 'iu');
}

/**
 * Does the file name match? Globs with `*` and `?`, several separated by `;` or spaces,
 * without regard to case (a space inside a name: `?`).
 */
export function patternMatches(pattern: string, name: string): boolean {
  return pattern
    .split(/[;\s]+/)
    .filter((p) => p.length > 0)
    .some((p) => globToRegex(p).test(name));
}

/** A rule applies to files only: never to folders or "..". An unreadable name has no path. */
export function canHaveAction(entry: DirEntry): boolean {
  return !isParentRow(entry) && !isNavigableDir(entry) && !entry.lossyName;
}

/**
 * Keys the dialog offers on `platform` (design 073 E12). The same everywhere for now; the
 * one place where an own Ctrl for Windows/Linux would be added (on macOS Ctrl+click is the
 * context menu).
 */
export function availableModifiers(platform: Platform): readonly FileActionModifier[] {
  void platform;
  return MODIFIER_ORDER;
}

/** Known keys in canonical order, without doubles; anything else is dropped. */
export function normalizeModifiers(mods: Iterable<string>): FileActionModifier[] {
  const set = new Set<string>(mods);
  return MODIFIER_ORDER.filter((m) => set.has(m));
}

/** The keys held during a mouse event (⌘ on macOS / Ctrl elsewhere = `mod`). */
export function modifiersOf(input: {
  readonly toggleKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}): FileActionModifier[] {
  const out: FileActionModifier[] = [];
  if (input.toggleKey) {
    out.push('mod');
  }
  if (input.altKey) {
    out.push('alt');
  }
  if (input.shiftKey) {
    out.push('shift');
  }
  return out;
}

const MAC_SIGNS: Readonly<Record<FileActionModifier, string>> = { mod: '⌘', alt: '⌥', shift: '⇧' };
const PC_NAMES: Readonly<Record<FileActionModifier, string>> = {
  mod: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
};

/** Name of one key as on the shortcut badges: `⌘ ⌥ ⇧` on macOS, `Ctrl Alt Shift` elsewhere. */
export function modifierName(mod: FileActionModifier, platform: Platform): string {
  return platform === 'macos' ? MAC_SIGNS[mod] : PC_NAMES[mod];
}

/**
 * Compact form for the rule list (E19): `⌥⇧⌘` (Apple order) on macOS, `Ctrl+Alt+Shift`
 * elsewhere; `''` without keys. Unknown values (a newer file) are left out.
 */
export function modifierLabel(mods: readonly string[], platform: Platform): string {
  const known = normalizeModifiers(mods);
  if (platform === 'macos') {
    return (['alt', 'shift', 'mod'] as const)
      .filter((m) => known.includes(m))
      .map((m) => MAC_SIGNS[m])
      .join('');
  }
  return known.map((m) => PC_NAMES[m]).join('+');
}

function sameModifiers(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((m) => y.has(m));
}

/**
 * The first rule (order of the dialog) for `trigger` with exactly these keys whose pattern
 * matches the entry (design 073 E14: Shift+double click never falls back to a rule
 * without keys).
 */
export function findRule(
  rules: readonly FileActionRule[],
  trigger: FileActionTrigger,
  modifiers: readonly FileActionModifier[],
  entry: DirEntry,
): FileActionRule | null {
  if (!canHaveAction(entry)) {
    return null;
  }
  return (
    rules.find(
      (r) =>
        r.trigger === trigger &&
        sameModifiers(r.modifiers, modifiers) &&
        patternMatches(r.pattern, entry.name),
    ) ?? null
  );
}

function patternKey(pattern: string): string {
  return [
    ...new Set(
      pattern
        .split(/[;\s]+/)
        .filter((p) => p.length > 0)
        .map((p) => p.toLocaleLowerCase()),
    ),
  ]
    .sort()
    .join(';');
}

/**
 * Ids of rules that never fire because a rule above has the same trigger, keys and
 * pattern (E20; the pattern compared as a set of globs regardless of case). A hint only.
 */
export function shadowedRules(rules: readonly FileActionRule[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const r of rules) {
    const pattern = patternKey(r.pattern);
    if (!pattern) {
      continue;
    }
    const key = `${r.trigger}|${normalizeModifiers(r.modifiers).join('+')}|${pattern}`;
    if (seen.has(key)) {
      out.add(r.id);
    } else {
      seen.add(key);
    }
  }
  return out;
}
