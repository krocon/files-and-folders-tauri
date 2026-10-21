import { ExtraMenuNode } from '../../core/actions/action.service';
import {
  MAX_STARTER_DEPTH,
  StarterItem,
  StarterKind,
  StarterProblem,
} from '../../core/starter/starter.models';

/** Pure helpers of the starter menu (design 032): menu tree, editing the draft. */

/** Extra-action ids of the starter entries. */
export const STARTER_PREFIX = 'starter:';

export function starterActionId(id: string): string {
  return STARTER_PREFIX + id;
}

/** All entries depth-first (submenus before their children). */
export function walk(items: readonly StarterItem[]): StarterItem[] {
  const out: StarterItem[] = [];
  for (const it of items) {
    out.push(it);
    if (it.items?.length) {
      out.push(...walk(it.items));
    }
  }
  return out;
}

/** The runnable entries (programs and folders) – they become extra actions. */
export function runnable(items: readonly StarterItem[]): StarterItem[] {
  return walk(items).filter((i) => i.kind === 'program' || i.kind === 'folder');
}

/** The menu tree: items point to the extra actions (`starter:<id>`). */
export function menuTree(items: readonly StarterItem[]): ExtraMenuNode[] {
  return items.map((it): ExtraMenuNode => {
    switch (it.kind) {
      case 'separator':
        return { kind: 'separator' };
      case 'submenu':
        return { kind: 'sub', label: it.label ?? '', items: menuTree(it.items ?? []) };
      default:
        return { kind: 'item', id: starterActionId(it.id) };
    }
  });
}

/** One row of the editor list. */
export interface StarterRow {
  readonly item: StarterItem;
  /** 0 = top level. */
  readonly depth: number;
}

export function rows(items: readonly StarterItem[], depth = 0): StarterRow[] {
  const out: StarterRow[] = [];
  for (const item of items) {
    out.push({ item, depth });
    if (item.kind === 'submenu') {
      out.push(...rows(item.items ?? [], depth + 1));
    }
  }
  return out;
}

/** A new id not used in `items` (`s1`, `s2`, …). */
export function newId(items: readonly StarterItem[]): string {
  const used = new Set(walk(items).map((i) => i.id));
  let n = 1;
  while (used.has(`s${n}`)) {
    n++;
  }
  return `s${n}`;
}

/** An empty entry of `kind`. */
export function blank(kind: StarterKind, id: string, label = ''): StarterItem {
  switch (kind) {
    case 'separator':
      return { id, kind };
    case 'submenu':
      return { id, kind, label, items: [] };
    case 'folder':
      return { id, kind, label, folder: '' };
    default:
      return { id, kind, label, program: '', params: '' };
  }
}

/** Where an id sits: the sibling list and its index there, plus the parent id. */
interface Location {
  readonly list: readonly StarterItem[];
  readonly index: number;
  readonly parent: string | null;
}

function locate(
  items: readonly StarterItem[],
  id: string,
  parent: string | null = null,
): Location | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) {
      return { list: items, index: i, parent };
    }
    const sub = items[i].items;
    if (sub?.length) {
      const found = locate(sub, id, items[i].id);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

export function find(items: readonly StarterItem[], id: string): StarterItem | null {
  const at = locate(items, id);
  return at ? at.list[at.index] : null;
}

/** Depth of `id` (0 = top level), -1 if missing. */
export function depthOf(items: readonly StarterItem[], id: string): number {
  return rows(items).find((r) => r.item.id === id)?.depth ?? -1;
}

/** How many levels below `item` hold entries (0 = no submenu or an empty one). */
function height(item: StarterItem): number {
  const children = item.kind === 'submenu' ? (item.items ?? []) : [];
  return children.length === 0 ? 0 : 1 + Math.max(...children.map(height));
}

/** Replaces the sibling list that holds `parent`'s children (`null` = top level). */
function withChildren(
  items: readonly StarterItem[],
  parent: string | null,
  children: readonly StarterItem[],
): StarterItem[] {
  if (parent === null) {
    return [...children];
  }
  return items.map((it) => {
    if (it.id === parent) {
      return { ...it, items: [...children] };
    }
    return it.items?.length ? { ...it, items: withChildren(it.items, parent, children) } : it;
  });
}

/** Changes the fields of one entry. */
export function update(
  items: readonly StarterItem[],
  id: string,
  patch: Partial<Omit<StarterItem, 'id' | 'items'>>,
): StarterItem[] {
  return items.map((it) => {
    if (it.id === id) {
      return { ...it, ...patch };
    }
    return it.items?.length ? { ...it, items: update(it.items, id, patch) } : it;
  });
}

/**
 * Inserts `item` after the entry `after` (same level); on an open submenu it goes in as its
 * first child (`intoSub`). `after` null = at the end of the top level.
 */
export function insert(
  items: readonly StarterItem[],
  after: string | null,
  item: StarterItem,
  intoSub = false,
): StarterItem[] {
  const at = after === null ? null : locate(items, after);
  if (!at) {
    return [...items, item];
  }
  const target = at.list[at.index];
  if (intoSub && target.kind === 'submenu' && depthOf(items, target.id) < MAX_STARTER_DEPTH) {
    return withChildren(items, target.id, [item, ...(target.items ?? [])]);
  }
  const list = [...at.list];
  list.splice(at.index + 1, 0, item);
  return withChildren(items, at.parent, list);
}

export function remove(items: readonly StarterItem[], id: string): StarterItem[] {
  const at = locate(items, id);
  if (!at) {
    return [...items];
  }
  return withChildren(
    items,
    at.parent,
    at.list.filter((_, i) => i !== at.index),
  );
}

/** Moves the entry one place up/down among its siblings; unchanged at the ends. */
export function move(items: readonly StarterItem[], id: string, delta: -1 | 1): StarterItem[] {
  const at = locate(items, id);
  const to = at ? at.index + delta : -1;
  if (!at || to < 0 || to >= at.list.length) {
    return items as StarterItem[];
  }
  const list = [...at.list];
  [list[at.index], list[to]] = [list[to], list[at.index]];
  return withChildren(items, at.parent, list);
}

/** Moves the entry into the submenu right above it (as its last child); unchanged otherwise. */
export function indent(items: readonly StarterItem[], id: string): StarterItem[] {
  const at = locate(items, id);
  if (!at || at.index === 0) {
    return items as StarterItem[];
  }
  const prev = at.list[at.index - 1];
  const item = at.list[at.index];
  const prevDepth = depthOf(items, prev.id);
  if (prev.kind !== 'submenu' || prevDepth + 1 + height(item) > MAX_STARTER_DEPTH) {
    return items as StarterItem[];
  }
  const without = remove(items, id);
  const target = find(without, prev.id)!;
  return withChildren(without, prev.id, [...(target.items ?? []), item]);
}

/** Moves the entry out of its submenu, right after it; unchanged on the top level. */
export function outdent(items: readonly StarterItem[], id: string): StarterItem[] {
  const at = locate(items, id);
  if (!at || at.parent === null) {
    return items as StarterItem[];
  }
  const item = at.list[at.index];
  return insert(remove(items, id), at.parent, item);
}

export function canIndent(items: readonly StarterItem[], id: string): boolean {
  return indent(items, id) !== items;
}

export function canOutdent(items: readonly StarterItem[], id: string): boolean {
  return (locate(items, id)?.parent ?? null) !== null;
}

/** Problem code per entry id (the first one). */
export function problemMap(problems: readonly StarterProblem[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const p of problems) {
    if (!out.has(p.id)) {
      out.set(p.id, p.code);
    }
  }
  return out;
}

/** Same entries, same order and fields? (the draft has unsaved changes if not) */
export function sameItems(a: readonly StarterItem[], b: readonly StarterItem[]): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** Drops empty optional fields (Rust leaves them out) so drafts compare by content. */
export function normalize(items: readonly StarterItem[]): StarterItem[] {
  return items.map((it) => {
    const out: Record<string, unknown> = { id: it.id, kind: it.kind };
    for (const key of ['label', 'program', 'params', 'workingDir', 'folder'] as const) {
      if (it[key]) {
        out[key] = it[key];
      }
    }
    if (it.shortcut) {
      out['shortcut'] = it.shortcut;
    }
    if (it.kind === 'submenu') {
      out['items'] = normalize(it.items ?? []);
    }
    return out as unknown as StarterItem;
  });
}
