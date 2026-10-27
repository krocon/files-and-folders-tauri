import {
  CompareRow,
  CompareSide,
  CompareStatus,
  Seen,
  SyncAction,
  SyncOp,
} from '../../core/sync/sync.models';

/** What happens to a row: one of the job's actions or nothing (design 036 E3). */
export type RowAction = SyncAction | 'none';

/** Both directions (default), or one side is the master. */
export type SyncMode = 'both' | 'leftToRight' | 'rightToLeft';

/** Which rows the list shows (design 036 E5). */
export interface ViewFilter {
  readonly equal: boolean;
  /** `leftNewer`. */
  readonly leftNewer: boolean;
  /** `rightNewer`. */
  readonly rightNewer: boolean;
  /** `differs` and `kindMismatch`. */
  readonly differs: boolean;
  readonly onlyLeft: boolean;
  readonly onlyRight: boolean;
}

/** "Only differences". */
export const DEFAULT_VIEW: ViewFilter = {
  equal: false,
  leftNewer: true,
  rightNewer: true,
  differs: true,
  onlyLeft: true,
  onlyRight: true,
};

const isDir = (s: CompareSide | null) => s?.kind === 'directory';

/** The suggested action of a row (design 036 E3, table). `mirror`: delete what the master lacks. */
export function defaultAction(row: CompareRow, mode: SyncMode, mirror: boolean): RowAction {
  const s: CompareStatus = row.status;
  if (mode === 'both') {
    if (s === 'leftNewer' || s === 'onlyLeft') {
      return 'copyToRight';
    }
    if (s === 'rightNewer' || s === 'onlyRight') {
      return 'copyToLeft';
    }
    return 'none';
  }
  const toRight = mode === 'leftToRight';
  const masterNewer = toRight ? 'leftNewer' : 'rightNewer';
  const targetNewer = toRight ? 'rightNewer' : 'leftNewer';
  const onlyMaster = toRight ? 'onlyLeft' : 'onlyRight';
  const onlyTarget = toRight ? 'onlyRight' : 'onlyLeft';
  const copy: RowAction = toRight ? 'copyToRight' : 'copyToLeft';
  if (s === masterNewer || s === onlyMaster) {
    return copy;
  }
  if (mirror) {
    if (s === targetNewer || s === 'differs') {
      return copy;
    }
    if (s === onlyTarget) {
      return toRight ? 'deleteRight' : 'deleteLeft';
    }
  }
  return 'none';
}

/** Actions a row allows, in the order the Space key cycles through them. */
export function allowedActions(row: CompareRow): readonly RowAction[] {
  const out: RowAction[] = [];
  const { left, right } = row;
  const mismatch = row.status === 'kindMismatch';
  // a folder is never copied onto an existing entry (its files bring their own rows)
  if (left && !mismatch && !(isDir(left) && right)) {
    out.push('copyToRight');
  }
  if (right && !mismatch && !(isDir(right) && left)) {
    out.push('copyToLeft');
  }
  if (left) {
    out.push('deleteLeft');
  }
  if (right) {
    out.push('deleteRight');
  }
  out.push('none');
  return out;
}

export function isAllowed(row: CompareRow, action: RowAction): boolean {
  return allowedActions(row).includes(action);
}

/** The next allowed action after `current` (Space, click on the action column). */
export function nextAction(row: CompareRow, current: RowAction): RowAction {
  const list = allowedActions(row);
  const i = list.indexOf(current);
  return list[(i + 1) % list.length];
}

/**
 * Rows with their structure (rows come in preorder: a folder's content follows it):
 * `parent[i]` = index of the folder row above `i` (-1 = top level), `end[i]` = index after
 * the last row below `i`. Built once per row list in O(n).
 */
export interface Tree {
  readonly rows: readonly CompareRow[];
  readonly parent: Int32Array;
  readonly end: Int32Array;
}

export function buildTree(rows: readonly CompareRow[]): Tree {
  const n = rows.length;
  const parent = new Int32Array(n).fill(-1);
  const end = new Int32Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = rows[i].depth;
    while (stack.length > 0 && rows[stack[stack.length - 1]].depth >= d) {
      end[stack.pop()!] = i;
    }
    parent[i] = stack.length > 0 ? stack[stack.length - 1] : -1;
    stack.push(i);
  }
  while (stack.length > 0) {
    end[stack.pop()!] = n;
  }
  return { rows, parent, end };
}

export function defaultActions(tree: Tree, mode: SyncMode, mirror: boolean): RowAction[] {
  const { rows } = tree;
  const out = rows.map((r) => defaultAction(r, mode, mirror));
  // a suggested delete of a folder takes its content with it (coupling, E3)
  for (let i = 0; i < rows.length; i++) {
    if (out[i] === 'deleteLeft' || out[i] === 'deleteRight') {
      cascadeDelete(tree, out, i);
      i = tree.end[i] - 1;
    }
  }
  return out;
}

function cascadeDelete(tree: Tree, actions: RowAction[], i: number): void {
  const a = actions[i];
  const leftSide = a === 'deleteLeft';
  for (let j = i + 1; j < tree.end[i]; j++) {
    const has = leftSide ? tree.rows[j].left : tree.rows[j].right;
    actions[j] = has ? a : 'none';
  }
}

/**
 * Sets the action of row `i` in `out` (in place) and keeps folders and their content
 * consistent (E3): deleting a folder deletes everything below it on that side; a copy
 * below a deleted folder, or keeping an entry of that side, takes the delete of the
 * folder back. Returns `false` if the row does not allow the action.
 */
export function applyAction(tree: Tree, out: RowAction[], i: number, action: RowAction): boolean {
  const row = tree.rows[i];
  if (!row || !isAllowed(row, action)) {
    return false;
  }
  const before = out[i];
  out[i] = action;
  const isDelete = action === 'deleteLeft' || action === 'deleteRight';
  if (isDelete && (action === 'deleteLeft' ? isDir(row.left) : isDir(row.right))) {
    cascadeDelete(tree, out, i);
  } else if ((before === 'deleteLeft' || before === 'deleteRight') && tree.end[i] > i + 1) {
    // the folder is kept: its content no longer goes with its delete
    for (let j = i + 1; j < tree.end[i]; j++) {
      if (out[j] === before) {
        out[j] = 'none';
      }
    }
  }
  for (let k = tree.parent[i]; k >= 0; k = tree.parent[k]) {
    const up = out[k];
    if (up !== 'deleteLeft' && up !== 'deleteRight') {
      continue;
    }
    const onUpSide = up === 'deleteLeft' ? row.left : row.right;
    if (action === up || (!onUpSide && action !== 'copyToLeft' && action !== 'copyToRight')) {
      continue;
    }
    out[k] = 'none';
  }
  return true;
}

/** [`applyAction`] on a copy. */
export function setAction(
  tree: Tree,
  actions: readonly RowAction[],
  i: number,
  action: RowAction,
): RowAction[] {
  const out = [...actions];
  applyAction(tree, out, i, action);
  return out;
}

/** Category of a status for the view filter. */
export function visible(row: CompareRow, view: ViewFilter): boolean {
  switch (row.status) {
    case 'equal':
      return view.equal;
    case 'leftNewer':
      return view.leftNewer;
    case 'rightNewer':
      return view.rightNewer;
    case 'differs':
    case 'kindMismatch':
      return view.differs;
    case 'onlyLeft':
      return view.onlyLeft;
    case 'onlyRight':
      return view.onlyRight;
  }
}

/** Indexes of the rows the view shows. */
export function visibleIndexes(rows: readonly CompareRow[], view: ViewFilter): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (visible(r, view)) {
      out.push(i);
    }
  });
  return out;
}

export interface Sums {
  readonly toRight: number;
  readonly toRightBytes: number;
  readonly toLeft: number;
  readonly toLeftBytes: number;
  readonly deleteLeft: number;
  readonly deleteRight: number;
}

/** Counts per direction; a deleted folder counts once (its content goes with it). */
export function sums(tree: Tree, actions: readonly RowAction[]): Sums {
  const { rows } = tree;
  let toRight = 0;
  let toRightBytes = 0;
  let toLeft = 0;
  let toLeftBytes = 0;
  let deleteLeft = 0;
  let deleteRight = 0;
  for (const i of opIndexes(tree, actions)) {
    const r = rows[i];
    switch (actions[i]) {
      case 'copyToRight':
        toRight++;
        toRightBytes += r.left?.size ?? 0;
        break;
      case 'copyToLeft':
        toLeft++;
        toLeftBytes += r.right?.size ?? 0;
        break;
      case 'deleteLeft':
        deleteLeft++;
        break;
      case 'deleteRight':
        deleteRight++;
        break;
    }
  }
  return { toRight, toRightBytes, toLeft, toLeftBytes, deleteLeft, deleteRight };
}

/** Rows that become operations: not `none`, not below a folder deleted on the same side. */
function opIndexes(tree: Tree, actions: readonly RowAction[]): number[] {
  const { rows } = tree;
  const out: number[] = [];
  let i = 0;
  while (i < rows.length) {
    const a = actions[i] ?? 'none';
    if (a !== 'none') {
      out.push(i);
    }
    const r = rows[i];
    if ((a === 'deleteLeft' && isDir(r.left)) || (a === 'deleteRight' && isDir(r.right))) {
      const end = tree.end[i];
      // only the other side's deletes below remain (the same side goes with the folder)
      for (let j = i + 1; j < end; j++) {
        const b = actions[j];
        if (b !== 'none' && b !== a) {
          out.push(j);
        }
      }
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

function seen(side: CompareSide | null): Seen | null {
  return side ? { kind: side.kind, size: side.size, modifiedMs: side.modifiedMs } : null;
}

/** The operations for the job `sync` (paths and seen values as Rust sent them). */
export function buildOps(tree: Tree, actions: readonly RowAction[]): SyncOp[] {
  return opIndexes(tree, actions).map((i) => {
    const r = tree.rows[i];
    return {
      action: actions[i] as SyncAction,
      left: { path: r.leftPath, seen: seen(r.left) },
      right: { path: r.rightPath, seen: seen(r.right) },
    };
  });
}
