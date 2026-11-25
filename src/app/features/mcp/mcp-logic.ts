import { DirEntry, isParentRow } from '../../core/fs/fs.models';
import { McpEntry, McpPanel, McpTab, McpTabKind } from '../../core/mcp/mcp.models';

/** Marked entries reported to Rust (Rust `state::MAX_MARKED`); `markedTotal` says how many there are. */
export const MAX_REPORTED_MARKED = 5000;
/** The window is reported this long after its last change. */
export const PUBLISH_DEBOUNCE_MS = 150;

export function toMcpEntry(e: DirEntry): McpEntry {
  return {
    name: e.name,
    path: e.path,
    kind: e.kind,
    size: e.size,
    modifiedMs: e.modifiedMs,
  };
}

/** What a tab shows, from its search reference (pure; keys as the stores build them). */
export function tabKind(
  search: { readonly key: string; readonly flat?: unknown } | null | undefined,
  resultKind: (key: string) => McpTabKind,
): McpTabKind {
  if (!search) {
    return 'folder';
  }
  return search.flat ? 'flat' : resultKind(search.key);
}

export interface PanelSource {
  readonly tabs: readonly McpTab[];
  readonly activeTab: number;
  readonly folder: string | null;
  readonly cursor: DirEntry | null;
  readonly marked: readonly DirEntry[];
  readonly unchecked: boolean;
}

/** The report of one panel – the `..` row is no entry, the marks are cut at the limit. */
export function panelState(src: PanelSource): McpPanel {
  const real = (e: DirEntry): boolean => !isParentRow(e);
  const marked = src.marked.filter(real);
  return {
    tabs: src.tabs,
    activeTab: src.activeTab,
    folder: src.folder,
    cursor: src.cursor && real(src.cursor) ? toMcpEntry(src.cursor) : null,
    marked: marked.slice(0, MAX_REPORTED_MARKED).map(toMcpEntry),
    markedTotal: marked.length,
    unchecked: src.unchecked,
  };
}

export const EMPTY_PANEL: McpPanel = {
  tabs: [],
  activeTab: 0,
  folder: null,
  cursor: null,
  marked: [],
  markedTotal: 0,
  unchecked: false,
};

/**
 * The paths of `wanted` that are entries of the panel (the `..` row never) – a client
 * can mark or point at nothing else.
 */
export function entriesInPanel(
  wanted: readonly string[],
  entries: readonly DirEntry[],
): readonly string[] {
  const known = new Set(entries.filter((e) => !isParentRow(e)).map((e) => e.path));
  return wanted.filter((p) => known.has(p));
}

/** Local time of a log line, `HH:MM:SS`. */
export function logTime(ms: number): string {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** Adds `name` to the "always" list (no duplicates, bounded like the schema). */
export function withClient(list: readonly unknown[], name: string, max = 16): string[] {
  const names = list.filter((x): x is string => typeof x === 'string');
  if (names.includes(name)) {
    return names;
  }
  return [...names, name].slice(-max);
}
