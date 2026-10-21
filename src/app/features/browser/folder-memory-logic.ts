import {
  FolderMemoryFile,
  SavedFolder,
  SavedTabFolders,
} from '../../core/memory/folder-memory.models';
import { FolderState, rememberFolder, TabMemory } from './tab-memory';

/** What a tab contributes to `folder-memory.json` (design 027). */
export interface TabMemorySource {
  readonly tabId: string;
  /** The tab's memory if it was used in this session. */
  readonly memory?: TabMemory;
  /** The folder a panel shows for this tab right now (newest of all). */
  readonly current?: { readonly path: string; readonly state: FolderState } | null;
  /** What the file held for the tab – kept while the tab was not opened. */
  readonly saved?: SavedTabFolders;
}

/** Fills a fresh tab memory with the folders saved for the tab (oldest first). */
export function seedTabMemory(memory: TabMemory, saved: SavedTabFolders | undefined): void {
  for (const f of saved?.folders ?? []) {
    rememberFolder(memory, f.path, {
      cursor: f.cursor,
      marks: [...f.marks],
      scrollTop: f.scrollTop,
    });
  }
}

function saved(path: string, s: FolderState): SavedFolder {
  return { path, cursor: s.cursor, marks: [...s.marks], scrollTop: s.scrollTop };
}

/**
 * The file content for the open tabs (closed tabs are forgotten). Folders inside
 * archives, on servers and result views are left out (E3); a tab without memory
 * this session keeps what the file held.
 */
export function folderMemoryFile(tabs: readonly TabMemorySource[]): FolderMemoryFile {
  const out: SavedTabFolders[] = [];
  for (const t of tabs) {
    let folders: SavedFolder[];
    if (t.memory) {
      const map = new Map<string, SavedFolder>();
      for (const [path, s] of t.memory.folders) {
        if (!s.volatile) {
          map.set(path, saved(path, s));
        }
      }
      if (t.current && !t.current.state.volatile) {
        map.delete(t.current.path);
        map.set(t.current.path, saved(t.current.path, t.current.state));
      }
      folders = [...map.values()];
    } else {
      folders = [...(t.saved?.folders ?? [])];
    }
    if (folders.length > 0) {
      out.push({ tabId: t.tabId, folders });
    }
  }
  return { version: 1, tabs: out };
}
