import { DirEntry, DirectoryListing } from '../../../core/fs/fs.models';

/** Columns a watcher update may change without changing the set or order of rows. */
export type UpdatedColumn = 'size' | 'modifiedMs';

/**
 * A listing that differs from the shown one only in sizes/times of the same
 * entries (a file being written, a calculated folder size – review 012 #5):
 * the changed rows and columns, so the table can replace just those rows.
 * Null = anything else (added, removed, renamed entries, other folder).
 */
export function inPlaceUpdate(
  prev: DirectoryListing | null,
  next: DirectoryListing,
): { rows: DirEntry[]; columns: Set<UpdatedColumn> } | null {
  if (!prev || prev.path !== next.path || prev.parent !== next.parent) {
    return null;
  }
  if (prev.entries.length !== next.entries.length) {
    return null;
  }
  const rows: DirEntry[] = [];
  const columns = new Set<UpdatedColumn>();
  for (let i = 0; i < next.entries.length; i++) {
    const a = prev.entries[i];
    const b = next.entries[i];
    if (a === b) {
      continue;
    }
    if (
      a.path !== b.path ||
      a.name !== b.name ||
      a.kind !== b.kind ||
      a.targetKind !== b.targetKind ||
      a.hidden !== b.hidden ||
      a.lossyName !== b.lossyName
    ) {
      return null;
    }
    if (a.size !== b.size) {
      columns.add('size');
    }
    if (a.modifiedMs !== b.modifiedMs) {
      columns.add('modifiedMs');
    }
    rows.push(b);
  }
  return rows.length > 0 ? { rows, columns } : null;
}
