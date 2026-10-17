import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { describeFsError, toFsError } from '../../core/fs/fs-error';
import { SessionApi } from '../../core/session/session-api';
import {
  AdjustedPath,
  PanelSession,
  Session,
  Side,
  TabSession,
} from '../../core/session/session.models';
import { TEXTS } from './texts';

export type TabState = TabSession;

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
    hiddenVisible: false,
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
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Off when loading failed – never overwrite a session we could not read. */
  private saveEnabled = false;

  readonly ready = signal(false);
  readonly activeSide = signal<Side>('left');
  readonly splitter = signal(0.5);
  readonly favorites = signal<ReadonlySet<string>>(new Set());
  readonly panels = signal<Panels>(EMPTY_PANELS);
  /** Messages for the user (session warnings, replaced folders, save errors). */
  readonly notices = signal<readonly string[]>([]);
  /** Asks a panel to focus its list (`seq` makes repeated requests distinct). */
  readonly focusRequest = signal<{ side: Side; seq: number } | null>(null);
  /** Asks a panel to reload its folder. */
  readonly reloadRequest = signal<{ side: Side; seq: number } | null>(null);

  readonly source = computed(() => this.activeSide());
  readonly target = computed(() => otherSide(this.activeSide()));
  readonly leftActiveTab = computed(() => activeTabOf(this.panels().left));
  readonly rightActiveTab = computed(() => activeTabOf(this.panels().right));

  private seq = 0;

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
      const loaded = await this.api.load();
      this.restore(loaded.session);
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

  activeTab(side: Side): TabState {
    return activeTabOf(this.panels()[side]);
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
  openInNewTab(side: Side, path: string, title = ''): void {
    this.updatePanel(side, (p) =>
      p.tabs.length >= MAX_TABS ? p : insertTab(p, p.activeTab + 1, newTab(path, title)),
    );
  }

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

  /** A tab navigated to `path`: update path/title, remember the old folder in the history. */
  navigated(id: string, path: string, title: string): void {
    const tab = this.findTab(id);
    if (!tab || (tab.path === path && tab.title === title)) {
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
  }

  // ---- favourites ----

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
    panels: {
      left: toPanelSession(this.panels().left),
      right: toPanelSession(this.panels().right),
    },
  }));

  restore(session: Session): void {
    this.activeSide.set(session.activeSide === 'right' ? 'right' : 'left');
    this.splitter.set(clampSplitter(session.splitter));
    this.favorites.set(new Set(session.favorites));
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
      const text = `${TEXTS.sessionSaveFailed} ${toFsError(err).message}`;
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

function toPanelSession(p: PanelTabs): PanelSession {
  return { activeTab: p.activeTab, tabs: p.tabs };
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
