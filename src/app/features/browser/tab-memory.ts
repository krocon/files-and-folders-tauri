/** Cursor, marks and scroll position of a folder (restored when coming back). */
export interface FolderState {
  readonly cursor: string | null;
  readonly marks: readonly string[];
  readonly scrollTop: number;
}

export interface HistoryEntry {
  readonly path: string;
  readonly cursor: string | null;
  readonly scrollTop: number;
}

/**
 * In-memory navigation state of one tab (design 003 E3): back/forward stacks and
 * the state of the last visited folders. Not persisted; owned by the
 * WorkspaceStore per tab id so it moves with the tab.
 */
export interface TabMemory {
  back: HistoryEntry[];
  forward: HistoryEntry[];
  readonly folders: Map<string, FolderState>;
}

export const MAX_BACK = 50;
export const MAX_FOLDERS = 50;

export function createTabMemory(): TabMemory {
  return { back: [], forward: [], folders: new Map() };
}

/** Pushes onto a stack without direct duplicates, bounded. */
export function pushEntry(stack: HistoryEntry[], entry: HistoryEntry): void {
  if (stack.at(-1)?.path === entry.path) {
    stack[stack.length - 1] = entry;
  } else {
    stack.push(entry);
  }
  if (stack.length > MAX_BACK) {
    stack.splice(0, stack.length - MAX_BACK);
  }
}

export function rememberFolder(memory: TabMemory, path: string, state: FolderState): void {
  memory.folders.delete(path);
  memory.folders.set(path, state);
  while (memory.folders.size > MAX_FOLDERS) {
    const oldest = memory.folders.keys().next().value as string;
    memory.folders.delete(oldest);
  }
}

export function recallFolder(memory: TabMemory, path: string): FolderState | undefined {
  return memory.folders.get(path);
}
