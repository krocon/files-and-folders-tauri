import { DirEntry, isNavigableDir, isParentRow } from '../../core/fs/fs.models';
import { FileActionRule, FileActionTrigger } from '../../core/fileactions/file-actions.models';

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

/** The first rule (order of the dialog) for `trigger` whose pattern matches the entry. */
export function findRule(
  rules: readonly FileActionRule[],
  trigger: FileActionTrigger,
  entry: DirEntry,
): FileActionRule | null {
  if (!canHaveAction(entry)) {
    return null;
  }
  return rules.find((r) => r.trigger === trigger && patternMatches(r.pattern, entry.name)) ?? null;
}
