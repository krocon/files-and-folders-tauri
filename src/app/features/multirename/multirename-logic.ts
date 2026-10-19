import { DirEntry, isParentRow, PathSegment } from '../../core/fs/fs.models';
import { RenameItem, RenamePlan } from '../../core/rename/rename.models';
import { describeFsError } from '../../core/fs/fs-error';
import { MR_TEXTS } from './multirename-texts';

/**
 * The entries a multi-rename works on, in the order the list shows them (the
 * counter `[C]` follows it): the marked entries, otherwise the cursor entry –
 * never "..". Marked entries hidden by a filter come last, in listing order.
 */
export function selectionInDisplayOrder(
  marked: readonly DirEntry[],
  cursor: DirEntry | null,
  displayed: readonly DirEntry[] | null,
): readonly DirEntry[] {
  const list = marked.filter((e) => !isParentRow(e));
  if (list.length === 0) {
    return cursor && !isParentRow(cursor) ? [cursor] : [];
  }
  if (!displayed) {
    return list;
  }
  const byPath = new Map(list.map((e) => [e.path, e] as const));
  const out: DirEntry[] = [];
  for (const e of displayed) {
    const m = byPath.get(e.path);
    if (m) {
      out.push(m);
      byPath.delete(e.path);
    }
  }
  return [...out, ...byPath.values()];
}

/**
 * Names of the parent, grandparent and great-grandparent folder from the
 * breadcrumbs (root first, from Rust). The root itself has no name ('').
 */
export function parentNames(segments: readonly PathSegment[]): [string, string, string] {
  const names = segments.slice(1).map((s) => s.name);
  const at = (k: number) => names[names.length - 1 - k] ?? '';
  return [at(0), at(1), at(2)];
}

export type RowStatus = 'ok' | 'unchanged' | 'error' | 'pending';

export interface PreviewRow {
  /** 1-based, = counter order. */
  readonly nr: number;
  readonly path: string;
  readonly oldName: string;
  readonly newName: string;
  readonly status: RowStatus;
  readonly info: string;
}

export type PreviewFilter = 'all' | 'changed' | 'errors';

export function matchesFilter(row: PreviewRow, filter: PreviewFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'changed':
      return row.status === 'ok' || row.status === 'error';
    case 'errors':
      return row.status === 'error';
  }
}

/**
 * Preview rows: the new names at once; the Rust check when it belongs to
 * these names (`plan.items === items`), otherwise "checking…".
 */
export function previewRows(
  sources: readonly { readonly path: string; readonly name: string }[],
  items: readonly RenameItem[] | null,
  ruleError: string | null,
  planned: { readonly items: readonly RenameItem[]; readonly plan: RenamePlan } | null,
): PreviewRow[] {
  const plan = planned && items && planned.items === items ? planned.plan : null;
  return sources.map((s, i) => {
    const newName = items?.[i]?.newName ?? s.name;
    let status: RowStatus;
    let info: string;
    if (ruleError !== null || items === null) {
      status = 'error';
      info = ruleError ?? MR_TEXTS.ruleError;
    } else if (plan) {
      const row = plan.rows[i];
      status = row?.status ?? 'pending';
      info =
        status === 'ok'
          ? MR_TEXTS.statusOk
          : status === 'unchanged'
            ? MR_TEXTS.statusUnchanged
            : row?.error
              ? rowError(row.error)
              : MR_TEXTS.statusPending;
    } else {
      status = 'pending';
      info = MR_TEXTS.statusPending;
    }
    return { nr: i + 1, path: s.path, oldName: s.name, newName, status, info };
  });
}

function rowError(e: {
  code: Parameters<typeof describeFsError>[0]['code'];
  message: string;
  path: string | null;
}): string {
  // our own messages are written for the user; the OS ones get the general text first
  return e.code === 'io' || e.code === 'permission_denied' || e.code === 'not_found'
    ? `${describeFsError(e)} (${e.message})`
    : e.message;
}

export interface PreviewSummary {
  readonly ok: number;
  readonly unchanged: number;
  readonly errors: number;
  readonly pending: number;
}

export function summarize(rows: readonly PreviewRow[]): PreviewSummary {
  const s = { ok: 0, unchanged: 0, errors: 0, pending: 0 };
  for (const r of rows) {
    if (r.status === 'ok') s.ok++;
    else if (r.status === 'unchanged') s.unchanged++;
    else if (r.status === 'error') s.errors++;
    else s.pending++;
  }
  return s;
}

/** Inserts a token at the caret (replacing the selection); returns the new value and caret. */
export function insertAt(
  value: string,
  start: number,
  end: number,
  token: string,
): { value: string; caret: number } {
  const a = Math.max(0, Math.min(start, value.length));
  const b = Math.max(a, Math.min(end, value.length));
  return { value: value.slice(0, a) + token + value.slice(b), caret: a + token.length };
}
