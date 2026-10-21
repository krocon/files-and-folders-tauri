import { SizeMode } from '../../core/diskusage/disk-usage.models';
import { UsageRow } from './usage-rows';

/**
 * The basket of a disk-usage scan (design 033 E3): the marked entries of all
 * levels. An entry inside a marked folder is "covered" – it goes with the folder,
 * counts once and is not passed to the delete job on its own.
 */
export interface BasketItem {
  readonly row: UsageRow;
}

export interface BasketView {
  /** Entries to delete (not covered), in the order they were marked. */
  readonly effective: readonly UsageRow[];
  /** Ids of entries inside a marked folder. */
  readonly covered: ReadonlySet<number>;
  /** Bytes of the effective entries. */
  readonly size: number;
}

export function basketView(rows: ReadonlyMap<number, UsageRow>, mode: SizeMode): BasketView {
  const ids = new Set(rows.keys());
  const covered = new Set<number>();
  const effective: UsageRow[] = [];
  let size = 0;
  for (const [id, row] of rows) {
    if (row.usage.ancestors.some((a) => ids.has(a) && a !== id)) {
      covered.add(id);
      continue;
    }
    effective.push(row);
    size += mode === 'allocated' ? row.usage.allocated : row.usage.logical;
  }
  return { effective, covered, size };
}

/**
 * The basket after the list's marks of one level changed: the rows of that level
 * are taken from `marked`, the other levels stay.
 */
export function withLevelMarks(
  basket: ReadonlyMap<number, UsageRow>,
  levelRows: readonly UsageRow[],
  marked: ReadonlySet<string>,
): Map<number, UsageRow> {
  const next = new Map(basket);
  for (const r of levelRows) {
    if (r.usage.virtual) {
      continue;
    }
    if (marked.has(r.path)) {
      next.set(r.usage.id, r);
    } else {
      next.delete(r.usage.id);
    }
  }
  return next;
}

/** Drops the entries whose path is in `gone` (deleted) – and what was inside them. */
export function withoutPaths(
  basket: ReadonlyMap<number, UsageRow>,
  gone: ReadonlySet<string>,
): Map<number, UsageRow> {
  const goneIds = new Set<number>();
  for (const [id, r] of basket) {
    if (gone.has(r.path)) {
      goneIds.add(id);
    }
  }
  const next = new Map<number, UsageRow>();
  for (const [id, r] of basket) {
    if (!goneIds.has(id) && !r.usage.ancestors.some((a) => goneIds.has(a))) {
      next.set(id, r);
    }
  }
  return next;
}
