import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { describeFsError, errorText, toFsError } from '../../core/fs/fs-error';
import { SessionApi } from '../../core/session/session-api';
import {
  AdjustedPath,
  PanelSession,
  Session,
  Side,
  TabSession,
} from '../../core/session/session.models';
import type { FileBrowserStore } from '../browser/file-browser.store';
import { createTabMemory, TabMemory } from '../browser/tab-memory';
import type { FileListController } from '../browser/file-list/file-list-controller';
import { TEXTS } from './texts';
import { SettingsStore } from '../../core/settings/settings.store';
import { DISPLAY } from '../../core/settings/display';

/** What a panel offers to window-wide actions (registered by `FilePanel`). */
export interface PanelHandle {
  readonly store: FileBrowserStore;
  /** Undefined until the table is ready. */
  controller(): FileListController | undefined;
}

/** A result tab of a search (design 009 E4): points to a result in the root `SearchStore`. */
export interface SearchTabRef {
  readonly key: string;
  /** Shown in the tab and the header (`Search: "<label>"`). */
  readonly label: string;
  /** Title of the folder the tab falls back to when saved (paths are opaque here). */
  readonly rootTitle?: string;
}

/** A tab: a folder, or (with `search`) the result of a search – never saved as such. */
export type TabState = TabSession & { readonly search?: SearchTabRef | null };

export interface PanelTabs {
  readonly activeTab: number;
  readonly tabs: readonly TabState[];
}

export interface Panels {
  readonly left: PanelTabs;
  readonly right: PanelTabs;
}

export const SPLITTER_MIN = 0.15;
export const SPLITTER_MAX = 0.85;
export const MAX_HISTORY = 15;
export const MAX_TABS = 50;
export const MAX_RECENT = 20;
/** Delay before a changed state is written (Rust writes atomically). */
export const SAVE_DEBOUNCE_MS = 400;

export function otherSide(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

let idSeq = 0;
const ID_PREFIX = Math.random().toString(36).slice(2, 7);
function newId(): string {
  return `t${ID_PREFIX}${(++idSeq).toString(36)}`;
}

export function newTab(path: string | null, title = ''): TabState {
  return {
    id: newId(),
    path,
    title,
    history: [],
    cursor: null,
    // default of new tabs (setting `view.showHidden`, design 015)
    hiddenVisible: DISPLAY.showHidden(),
    filterActive: false,
    filterText: '',
    table: null,
  };
}

const EMPTY_PANELS: Panels = {
  left: { activeTab: 0, tabs: [newTab(null)] },
  right: { activeTab: 0, tabs: [newTab(null)] },
};

/**
 * Global window state (root service): both sides with their tabs, the active
 * side (source) and the other one (target), splitter, favourites. Loaded from
 * and saved to the session file (debounced). Panels read their active tab here
 * and write path, title, cursor and table state back.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly api = inject(SessionApi);
  private readonly settings = inject(SettingsStore);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Off when loading failed – never overwrite a session we could not read. */
  private saveEnabled = false;

  readonly ready = signal(false);
  readonly activeSide = signal<Side>('left');
  readonly splitter = signal(0.5);
  readonly favorites = signal<ReadonlySet<string>>(new Set());
  /** Recently visited folders, newest first (design 003 E3). */
  readonly recent = signal<readonly string[]>([]);
  /** Archive files shown as folders in this session (their paths are never targets, review 016 #7). */
  readonly archiveRoots = signal<ReadonlySet<string>>(new Set());
  readonly panels = signal<Panels>(EMPTY_PANELS);
  /** Messages for the user (session warnings, replaced folders, save errors). */
  readonly notices = signal<readonly string[]>([]);
  /** Asks a panel to focus its list (`seq` makes repeated requests distinct). */
  readonly focusRequest = signal<{ side: Side; seq: number } | null>(null);
  /** Asks a panel to reload its folder. */
  readonly reloadRequest = signal<{ side: Side; seq: number } | null>(null);
  /** Asks a panel to open a folder (menu ▾). */
  readonly navigateRequest = signal<{ side: Side; path: string | null; seq: number } | null>(null);
  /** Asks a panel to show the path input (Strg/⌘+L). */
  readonly pathEditRequest = signal<{ side: Side; seq: number } | null>(null);
  /** Asks a panel to open its folder menu ▾ (Alt+F1/F2). */
  readonly folderMenuRequest = signal<{ side: Side; seq: number } | null>(null);
  private readonly memories = new Map<string, TabMemory>();

  readonly source = computed(() => this.activeSide());
  readonly target = computed(() => otherSide(this.activeSide()));
  readonly leftActiveTab = computed(() => activeTabOf(this.panels().left));
  readonly rightActiveTab = computed(() => activeTabOf(this.panels().right));

  private seq = 0;
  private readonly handles = new Map<Side, PanelHandle>();

  constructor() {
    effect(() => {
      const snapshot = this.snapshot();
      if (!this.ready()) {
        return;
      }
      untracked(() => this.scheduleSave(snapshot));
    });
  }

  /** Loads the saved session; without one both sides show the home folder. */
  async init(): Promise<void> {
    try {
      const [loaded] = await Promise.all([this.api.load(), this.settings.init()]);
      this.restore(loaded.session);
      if (this.settings.get('general.startFolder') === 'home') {
        // design 015: both sides start in the home folder (favourites, splitter stay)
        this.panels.set({
          left: { activeTab: 0, tabs: [newTab(null)] },
          right: { activeTab: 0, tabs: [newTab(null)] },
        });
      }
      const notices: string[] = [];
      if (loaded.warning) {
        notices.push(loaded.warning);
      }
      notices.push(...loaded.adjusted.map(describeAdjusted));
      this.notices.set(notices);
      this.saveEnabled = true;
    } catch (err) {
      this.notices.set([`${TEXTS.sessionLoadFailed} ${describeFsError(toFsError(err))}`]);
    }
    this.ready.set(true);
    this.requestFocus(this.activeSide());
  }

  registerPanel(side: Side, handle: PanelHandle): () => void {
    this.handles.set(side, handle);
    return () => {
      if (this.handles.get(side) === handle) {
        this.handles.delete(side);
      }
    };
  }

  panel(side: Side = this.activeSide()): PanelHandle | undefined {
    return this.handles.get(side);
  }

  activeTab(side: Side): TabState {
    return activeTabOf(this.panels()[side]);
  }

  /**
   * Default target folder: the folder of the selected tab on the other side (the side that
   * is not `from`, by default not the active one) – for Copy, Move, Pack, Group, tools.
   * A result tab gives the folder it searched in; `null` inside an archive (virtual path)
   * or before a home tab has its first listing.
   */
  targetDir(from: Side = this.activeSide()): string | null {
    const side = otherSide(from);
    const store = this.panel(side)?.store;
    if (store?.archive()) {
      return null;
    }
    return this.activeTab(side).path ?? store?.path() ?? null;
  }

  // ---- sides ----

  setActive(side: Side): void {
    this.activeSide.set(side);
  }

  /** `Tab`: the other side becomes active and gets the focus. */
  toggleActive(): void {
    const next = otherSide(this.activeSide());
    this.activeSide.set(next);
    this.requestFocus(next);
  }

  requestFocus(side: Side): void {
    this.focusRequest.set({ side, seq: ++this.seq });
  }

  requestNavigate(side: Side, path: string | null): void {
    this.navigateRequest.set({ side, path, seq: ++this.seq });
  }

  requestPathEdit(side: Side): void {
    this.pathEditRequest.set({ side, seq: ++this.seq });
  }

  requestFolderMenu(side: Side): void {
    this.folderMenuRequest.set({ side, seq: ++this.seq });
  }

  /** In-memory navigation state of a tab (back/forward, per-folder cursor/marks/scroll). */
  memory(tabId: string): TabMemory {
    let m = this.memories.get(tabId);
    if (!m) {
      m = createTabMemory();
      this.memories.set(tabId, m);
    }
    return m;
  }

  requestReload(side: Side): void {
    this.reloadRequest.set({ side, seq: ++this.seq });
  }

  setSplitter(ratio: number): void {
    this.splitter.set(clampSplitter(ratio));
  }

  // ---- tabs ----

  selectTab(side: Side, index: number): void {
    this.updatePanel(side, (p) =>
      index >= 0 && index < p.tabs.length ? { ...p, activeTab: index } : p,
    );
  }

  /** Strg+Tab / Strg+Shift+Tab: next or previous tab, wrapping around. */
  cycleTab(side: Side, delta: number): void {
    this.updatePanel(side, (p) => ({
      ...p,
      activeTab: (p.activeTab + delta + p.tabs.length) % p.tabs.length,
    }));
  }

  /** `+`: clones a tab (default: the active one) next to it and selects the clone. */
  cloneTab(side: Side, index = this.panels()[side].activeTab): void {
    this.updatePanel(side, (p) => {
      const original = p.tabs[index];
      if (!original || p.tabs.length >= MAX_TABS) {
        return p;
      }
      return insertTab(p, index + 1, { ...original, id: newId() });
    });
  }

  /** Strg/⌘+Enter: opens a folder in a new tab after the active one. */
  openInNewTab(side: Side, path: string, title = '', cursor: string | null = null): void {
    this.updatePanel(side, (p) =>
      p.tabs.length >= MAX_TABS
        ? p
        : insertTab(p, p.activeTab + 1, { ...newTab(path, title), cursor }),
    );
  }

  /**
   * Opens a search result tab after the active one (or turns tab `reuse` into it)
   * and selects it. `root` = folder the tab falls back to when saved. Returns the tab id.
   */
  openSearchTab(side: Side, ref: SearchTabRef, root: string, reuse?: string): string | null {
    if (reuse && this.findTab(reuse)) {
      this.updateTab(reuse, { search: ref, title: ref.label, cursor: null });
      return reuse;
    }
    if (this.panels()[side].tabs.length >= MAX_TABS) {
      return null;
    }
    const tab: TabState = { ...newTab(root, ref.label), search: ref };
    this.updatePanel(side, (p) => insertTab(p, p.activeTab + 1, tab));
    return tab.id;
  }

  /** Keys of the search results some tab shows (results without a tab are released). */
  readonly searchKeys = computed<ReadonlySet<string>>(() => {
    const { left, right } = this.panels();
    const keys = new Set<string>();
    for (const t of [...left.tabs, ...right.tabs]) {
      if (t.search) {
        keys.add(t.search.key);
      }
    }
    return keys;
  });

  /** `−`: closes a tab; the last tab of a side stays. */
  closeTab(side: Side, index = this.panels()[side].activeTab): void {
    this.updatePanel(side, (p) => {
      if (p.tabs.length <= 1 || !p.tabs[index]) {
        return p;
      }
      const tabs = p.tabs.filter((_, i) => i !== index);
      const activeTab =
        index < p.activeTab || (index === p.activeTab && index === tabs.length)
          ? p.activeTab - 1
          : p.activeTab;
      return { tabs, activeTab: Math.min(activeTab, tabs.length - 1) };
    });
  }

  /** Moves a tab to the other side (selected there); the last tab of a side stays. */
  moveTabToOther(side: Side, index: number): void {
    const tab = this.panels()[side].tabs[index];
    if (!tab || this.panels()[side].tabs.length <= 1) {
      return;
    }
    this.closeTab(side, index);
    this.appendAndSelect(otherSide(side), tab);
  }

  /** Clones a tab into the other side (selected there). */
  cloneTabToOther(side: Side, index: number): void {
    const tab = this.panels()[side].tabs[index];
    if (tab) {
      this.appendAndSelect(otherSide(side), { ...tab, id: newId() });
    }
  }

  /** Moves a tab one place to the left (`-1`) or right (`+1`) within its side. */
  moveTab(side: Side, index: number, delta: -1 | 1): void {
    this.updatePanel(side, (p) => {
      const target = index + delta;
      if (!p.tabs[index] || target < 0 || target >= p.tabs.length) {
        return p;
      }
      const tabs = [...p.tabs];
      [tabs[index], tabs[target]] = [tabs[target], tabs[index]];
      const activeId = p.tabs[p.activeTab].id;
      return { tabs, activeTab: tabs.findIndex((t) => t.id === activeId) };
    });
  }

  /** Writes fields of a tab (by id, wherever it is now). Unknown ids are ignored. */
  updateTab(id: string, patch: Partial<Omit<TabState, 'id'>>): void {
    this.panels.update((panels) => {
      for (const side of ['left', 'right'] as const) {
        const p = panels[side];
        const i = p.tabs.findIndex((t) => t.id === id);
        if (i >= 0) {
          const tabs = [...p.tabs];
          tabs[i] = { ...tabs[i], ...patch };
          return { ...panels, [side]: { ...p, tabs } };
        }
      }
      return panels;
    });
  }

  /**
   * A tab navigated to `path`: update path/title, remember the old folder in the
   * history. A result tab that navigates becomes a folder tab (review 009 #3):
   * its search goes, the `SearchStore` releases the result.
   */
  navigated(id: string, path: string, title: string): void {
    const tab = this.findTab(id);
    if (!tab) {
      return;
    }
    if (tab.search) {
      this.updateTab(id, { path, title, search: null, table: null });
      this.addRecent(path);
      return;
    }
    if (tab.path === path && tab.title === title) {
      return;
    }
    const history =
      tab.path && tab.path !== path
        ? [tab.path, ...tab.history.filter((h) => h !== tab.path && h !== path)].slice(
            0,
            MAX_HISTORY,
          )
        : tab.history;
    this.updateTab(id, { path, title, history });
    this.addRecent(path);
  }

  // ---- favourites ----

  noteArchive(path: string): void {
    if (!this.archiveRoots().has(path)) {
      this.archiveRoots.update((s) => new Set([...s, path]));
    }
  }

  addRecent(path: string): void {
    this.recent.update((r) => [path, ...r.filter((p) => p !== path)].slice(0, MAX_RECENT));
  }

  isFavorite(path: string | null): boolean {
    return path !== null && this.favorites().has(path);
  }

  toggleFavorite(path: string): void {
    const next = new Set(this.favorites());
    if (!next.delete(path)) {
      next.add(path);
    }
    this.favorites.set(next);
  }

  dismissNotice(index: number): void {
    this.notices.update((n) => n.filter((_, i) => i !== index));
  }

  // ---- session ----

  /** The persistent part of the state, in the format of the session file. */
  readonly snapshot = computed<Session>(() => ({
    version: 1,
    activeSide: this.activeSide(),
    splitter: this.splitter(),
    favorites: [...this.favorites()],
    recent: this.recent(),
    panels: {
      left: toPanelSession(this.panels().left),
      right: toPanelSession(this.panels().right),
    },
  }));

  restore(session: Session): void {
    this.activeSide.set(session.activeSide === 'right' ? 'right' : 'left');
    this.splitter.set(clampSplitter(session.splitter));
    this.favorites.set(new Set(session.favorites));
    this.recent.set((session.recent ?? []).slice(0, MAX_RECENT));
    const ids = new Set<string>();
    this.panels.set({
      left: fromPanelSession(session.panels.left, ids),
      right: fromPanelSession(session.panels.right, ids),
    });
  }

  /** Writes pending changes now (e.g. when the window is hidden). */
  flush(): Promise<void> {
    if (this.saveTimer === null) {
      return Promise.resolve();
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    return this.save(this.snapshot());
  }

  private scheduleSave(snapshot: Session): void {
    if (!this.saveEnabled) {
      return;
    }
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save(snapshot);
    }, SAVE_DEBOUNCE_MS);
  }

  private async save(snapshot: Session): Promise<void> {
    try {
      await this.api.save(snapshot);
    } catch (err) {
      const text = `${TEXTS.sessionSaveFailed} ${errorText(toFsError(err))}`;
      if (!this.notices().includes(text)) {
        this.notices.update((n) => [...n, text]);
      }
    }
  }

  private appendAndSelect(side: Side, tab: TabState): void {
    this.updatePanel(side, (p) =>
      p.tabs.length >= MAX_TABS ? p : insertTab(p, p.tabs.length, tab),
    );
  }

  private findTab(id: string): TabState | undefined {
    const { left, right } = this.panels();
    return left.tabs.find((t) => t.id === id) ?? right.tabs.find((t) => t.id === id);
  }

  private updatePanel(side: Side, fn: (p: PanelTabs) => PanelTabs): void {
    this.panels.update((panels) => {
      const next = fn(panels[side]);
      return next === panels[side] ? panels : { ...panels, [side]: next };
    });
  }
}

function activeTabOf(p: PanelTabs): TabState {
  return p.tabs[Math.min(p.activeTab, p.tabs.length - 1)];
}

function insertTab(p: PanelTabs, index: number, tab: TabState): PanelTabs {
  const tabs = [...p.tabs];
  tabs.splice(index, 0, tab);
  return { tabs, activeTab: index };
}

function clampSplitter(ratio: number): number {
  return Number.isFinite(ratio) ? Math.min(SPLITTER_MAX, Math.max(SPLITTER_MIN, ratio)) : 0.5;
}

/** Search tabs are not saved: they become a tab of their first folder (design 009 E4). */
function toPanelSession(p: PanelTabs): PanelSession {
  return {
    activeTab: p.activeTab,
    tabs: p.tabs.map((t) => {
      const { search, ...tab } = t;
      return search ? { ...tab, title: search.rootTitle ?? '', cursor: null, table: null } : tab;
    }),
  };
}

/** Tabs are found by id – empty or duplicate ids (never from Rust, but cheap to guard) get new ones. */
function fromPanelSession(p: PanelSession | undefined, ids: Set<string>): PanelTabs {
  const tabs = (p && p.tabs.length > 0 ? p.tabs : [newTab(null)]).map((t) => {
    const tab = !t.id || ids.has(t.id) ? { ...t, id: newId() } : t;
    ids.add(tab.id);
    return tab;
  });
  const activeTab = Math.min(Math.max(0, p?.activeTab ?? 0), tabs.length - 1);
  return { tabs, activeTab };
}

function describeAdjusted(a: AdjustedPath): string {
  return TEXTS.folderReplaced(a.from, a.to ?? TEXTS.homeFolder);
}
