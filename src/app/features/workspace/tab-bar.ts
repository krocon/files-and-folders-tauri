import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  untracked,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { Side } from '../../core/session/session.models';
import { FileBrowserStore } from '../browser/file-browser.store';
import { ArchiveStore } from '../archive/archive.store';
import { tabZoneHit } from '../dnd/dnd-logic';
import { DragStore } from '../dnd/drag.store';
import { OS_TEXTS, volumeLabel } from '../osintegration/os-texts';
import { VolumesStore } from '../osintegration/volumes.store';
import { SearchStore } from '../search/search.store';
import { modifiersAfter } from '../../core/actions/shortcut';
import { ContextMenu, MenuCloseReason, MenuItem } from './context-menu';
import { insertionIndex, tabDragCopies } from './tab-drag-logic';
import { TabDragStore } from './tab-drag.store';
import { TEXTS } from './texts';
import { TabState, WorkspaceStore } from './workspace.store';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** Pixels the pointer must travel before a press on a tab becomes a drag. */
const TAB_DRAG_THRESHOLD = 6;

interface OpenMenu {
  /** The menu belongs to a tab, not to a position – tabs can move or close meanwhile. */
  readonly tabId: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Tab bar of one side (row 2): `role="tablist"` with roving focus and automatic
 * activation (APG tabs), `+` clones, `−` closes; context menu on right click,
 * Shift+F10 or the context-menu key; double click reloads, middle click closes.
 * The menu button ▾ and the filter/hidden toggles follow in prompt 003.
 */
const HISTORY_IN_MENU = 15;

@Component({
  selector: 'app-tab-bar',
  imports: [ContextMenu],
  templateUrl: './tab-bar.html',
  styleUrl: './tab-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabBar {
  readonly side = input.required<Side>();

  protected readonly ws = inject(WorkspaceStore);
  protected readonly texts = TEXTS;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The panel's store (TabBar lives inside the FilePanel). */
  protected readonly store = inject(FileBrowserStore, { optional: true });
  private readonly drives = inject(VolumesStore);
  protected readonly folderMenuOpen = signal<{ x: number; y: number } | null>(null);
  protected readonly folderMenuItems = computed<MenuItem[]>(() => {
    const t = TEXTS;
    const favorites = [...this.ws.favorites()];
    const recent = this.ws.recent().filter((p) => !this.ws.favorites().has(p));
    const group = (prefix: string, label: string, paths: string[]): MenuItem[] => [
      { id: `${prefix}-h`, label, heading: true },
      ...(paths.length === 0
        ? [{ id: `${prefix}-none`, label: t.menuEmpty, disabled: true }]
        : paths.map((p, i) => ({ id: `${prefix}:${i}`, label: p }))),
    ];
    const volumes = this.drives.volumes();
    const drives: MenuItem[] = [
      { id: 'vol-h', label: OS_TEXTS.drives, heading: true },
      ...(volumes === null
        ? [{ id: 'vol-loading', label: OS_TEXTS.readingDrives, disabled: true }]
        : volumes.length === 0
          ? [{ id: 'vol-none', label: OS_TEXTS.noDrives, disabled: true }]
          : volumes.map((v, i) => ({ id: `vol:${i}`, label: volumeLabel(v) }))),
    ];
    return [
      { id: 'home', label: t.menuHome },
      ...drives,
      ...group('fav', t.menuFavorites, favorites),
      ...group('recent', t.menuRecent, recent),
    ];
  });

  protected readonly panel = computed(() => this.ws.panels()[this.side()]);
  private readonly dnd = inject(DragStore);
  private readonly archives = inject(ArchiveStore);
  /** The tab a drag would drop into (its folder) – also a tab that is not open. */
  protected readonly dropTabId = computed(() => {
    const t = this.dnd.drag()?.target;
    return t && t.side === this.side() ? (t.tabId ?? null) : null;
  });
  /** Dragging tabs (design 031 E1–E4). */
  protected readonly tabDrag = inject(TabDragStore);
  /** Insertion position a tab drag would drop at in this bar (the marker), or null. */
  protected readonly insertAt = computed(() => {
    const t = this.tabDrag.drag()?.target;
    return t && t.side === this.side() ? t.index : null;
  });
  /** The hint next to the pointer – only in the bar the drag started in. */
  protected readonly tabDragText = computed(() => {
    const d = this.tabDrag.drag();
    if (!d || d.from !== this.side()) {
      return '';
    }
    const t = TEXTS.tabDrag;
    if (d.target) {
      return t.label(d.copy, d.title, d.target.side, d.target.index + 1);
    }
    if (d.blocked === 'lastTab') {
      return t.lastTab(IS_MAC);
    }
    return d.blocked === 'full' ? t.full : t.noTarget(d.title);
  });
  protected get tabDragHint(): string {
    return TEXTS.tabDrag.hint(IS_MAC);
  }
  private tabPress: {
    x: number;
    y: number;
    pointerId: number;
    tabId: string;
    el: HTMLElement;
  } | null = null;
  private tabDragging = false;
  private lastTabPointer = { x: 0, y: 0 };
  protected readonly menu = signal<OpenMenu | null>(null);
  /** Index of the menu's tab, -1 when it is gone (closed by a shortcut while the menu was open). */
  private readonly menuIndex = computed(() => {
    const open = this.menu();
    return open ? this.panel().tabs.findIndex((t) => t.id === open.tabId) : -1;
  });
  /** History of the tab whose menu is open (most recent first, max. 15). */
  private readonly history = computed(
    () => this.panel().tabs[this.menuIndex()]?.history.slice(0, HISTORY_IN_MENU) ?? [],
  );
  protected readonly menuLabel = computed(() => {
    const tab = this.panel().tabs[this.menuIndex()];
    return tab ? this.title(tab) : '';
  });
  protected readonly menuItems = computed<MenuItem[]>(() => {
    const index = this.menuIndex();
    const count = this.panel().tabs.length;
    const m = TEXTS.tabMenu;
    return [
      { id: 'reload', label: m.reload },
      { id: 'close', label: m.close, disabled: count <= 1 },
      { id: 'moveToOther', label: m.moveToOther(this.side()), disabled: count <= 1 },
      { id: 'cloneToOther', label: m.cloneToOther(this.side()) },
      { id: 'moveLeft', label: m.moveLeft, disabled: index <= 0 },
      { id: 'moveRight', label: m.moveRight, disabled: index < 0 || index >= count - 1 },
      // the folders this tab visited (mr: long press on a tab, 018 J12)
      {
        id: 'history',
        label: m.history,
        disabled: this.history().length === 0,
        children: this.history().map((p, i) => ({ id: `hist:${i}`, label: p })),
      },
    ];
  });

  constructor() {
    // the tab headers as drop zones: drop into a tab's folder without opening it
    const unregister = this.dnd.registerZone({
      element: this.host.nativeElement,
      hit: (el) => {
        const id = el.closest<HTMLElement>('[role="tab"]')?.dataset['tabId'];
        const tab = this.panel().tabs.find((t) => t.id === id);
        return tabZoneHit(this.side(), tab, tab ? this.title(tab) : '', (p) =>
          this.archives.isArchivePath(p),
        );
      },
    });
    const side = this.side;
    const host = this.host.nativeElement;
    const unregisterTabs = this.tabDrag.registerZone({
      // read on use: the input is not set yet in the constructor
      get side() {
        return side();
      },
      bar: host,
      get panel() {
        return host.closest<HTMLElement>('app-file-panel');
      },
      index: (x) =>
        insertionIndex(
          [...this.host.nativeElement.querySelectorAll<HTMLElement>('[role="tab"]')].map((el) => {
            const r = el.getBoundingClientRect();
            return r.left + r.width / 2;
          }),
          x,
        ),
    });
    inject(DestroyRef).onDestroy(() => {
      unregister();
      unregisterTabs();
      if (this.tabDragging) {
        this.tabDrag.cancel();
      }
      this.endTabPress();
    });
    effect(() => {
      if (this.menu() && this.menuIndex() < 0) {
        this.menu.set(null);
      }
    });
    effect(() => {
      const req = this.ws.folderMenuRequest();
      if (req && req.side === this.side()) {
        untracked(() => this.openFolderMenu());
      }
    });
  }

  protected openFolderMenu(): void {
    const button = this.host.nativeElement.querySelector<HTMLElement>('.folder-menu');
    const rect = button?.getBoundingClientRect();
    this.ws.setActive(this.side());
    void this.drives.refresh();
    this.folderMenuOpen.set({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
  }

  protected onFolderChosen(id: string): void {
    this.folderMenuOpen.set(null);
    const favorites = [...this.ws.favorites()];
    const recent = this.ws.recent().filter((p) => !this.ws.favorites().has(p));
    let path: string | null | undefined;
    if (id === 'home') {
      path = null;
    } else if (id.startsWith('fav:')) {
      path = favorites[Number(id.slice(4))];
    } else if (id.startsWith('recent:')) {
      path = recent[Number(id.slice(7))];
    } else if (id.startsWith('vol:')) {
      path = this.drives.volumes()?.[Number(id.slice(4))]?.path;
    }
    if (path !== undefined) {
      this.ws.requestNavigate(this.side(), path);
    }
    this.ws.requestFocus(this.side());
  }

  protected onFolderMenuClosed(reason: MenuCloseReason): void {
    this.folderMenuOpen.set(null);
    if (reason !== 'outside') {
      this.host.nativeElement.querySelector<HTMLElement>('.folder-menu')?.focus();
    }
  }

  protected toggleHidden(): void {
    this.store?.hiddenVisible.update((v) => !v);
  }

  protected toggleFilter(): void {
    if (!this.store) {
      return;
    }
    const on = !this.store.filterActive();
    this.store.filterActive.set(on);
    if (on) {
      setTimeout(() =>
        this.host.nativeElement.querySelector<HTMLInputElement>('.filter-input')?.focus(),
      );
    } else {
      this.ws.requestFocus(this.side());
    }
  }

  protected onFilterInput(value: string): void {
    this.store?.filterText.set(value);
  }

  protected onFilterKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Escape') {
      evt.preventDefault();
      evt.stopPropagation();
      this.store?.filterText.set('');
      this.store?.filterActive.set(false);
      this.ws.requestFocus(this.side());
    } else if (evt.key === 'Enter' || evt.key === 'ArrowDown') {
      evt.preventDefault();
      this.ws.requestFocus(this.side());
    }
  }

  protected title(tab: TabState): string {
    if (tab.search) {
      return tab.search.label;
    }
    return tab.title || (tab.path === null ? TEXTS.homeTitle : '…');
  }

  private readonly search = inject(SearchStore);

  /** A result tab whose search runs (spinner + `aria-busy`, design 009 E4). */
  protected isSearching(tab: TabState): boolean {
    return tab.search ? (this.search.results().get(tab.search.key)?.running ?? false) : false;
  }

  /** Click; Shift+click closes the tab like in the old version (018 J13). */
  protected onTabClick(evt: MouseEvent, index: number): void {
    if (evt.shiftKey && this.panel().tabs.length > 1) {
      this.ws.closeTab(this.side(), index);
      return;
    }
    this.select(index);
  }

  protected select(index: number): void {
    this.ws.setActive(this.side());
    this.ws.selectTab(this.side(), index);
  }

  /** Double click: reload (select first if needed). */
  protected reload(index: number): void {
    this.select(index);
    this.ws.requestReload(this.side());
  }

  protected onAuxClick(evt: MouseEvent, index: number): void {
    if (evt.button === 1) {
      evt.preventDefault();
      this.ws.closeTab(this.side(), index);
    }
  }

  protected onContextMenu(evt: MouseEvent, index: number): void {
    evt.preventDefault();
    this.menu.set({ tabId: this.panel().tabs[index].id, x: evt.clientX, y: evt.clientY });
  }

  protected onTabKeydown(evt: KeyboardEvent, index: number): void {
    const count = this.panel().tabs.length;
    let next: number | null = null;
    switch (evt.key) {
      case 'ArrowRight':
        next = (index + 1) % count;
        break;
      case 'ArrowLeft':
        next = (index - 1 + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      case 'Delete':
        this.ws.closeTab(this.side(), index);
        this.focusTab(this.panel().activeTab);
        break;
      case 'ContextMenu':
        this.openMenuAt(index);
        break;
      case 'F10':
        if (!evt.shiftKey) {
          return;
        }
        this.openMenuAt(index);
        break;
      default:
        return;
    }
    evt.preventDefault();
    evt.stopPropagation();
    if (next !== null) {
      this.select(next);
      this.focusTab(next);
    }
  }

  protected onMenuChosen(id: string): void {
    const i = this.menuIndex();
    const history = this.history();
    this.menu.set(null);
    if (i < 0) {
      return;
    }
    const side = this.side();
    if (id.startsWith('hist:')) {
      const path = history[Number(id.slice(5))];
      this.select(i);
      if (path !== undefined) {
        this.ws.requestNavigate(side, path);
      }
      this.ws.requestFocus(side);
      return;
    }
    switch (id) {
      case 'reload':
        this.reload(i);
        break;
      case 'close':
        this.ws.closeTab(side, i);
        break;
      case 'moveToOther':
        this.ws.moveTabToOther(side, i);
        break;
      case 'cloneToOther':
        this.ws.cloneTabToOther(side, i);
        break;
      case 'moveLeft':
        this.ws.moveTab(side, i, -1);
        break;
      case 'moveRight':
        this.ws.moveTab(side, i, 1);
        break;
    }
    this.focusTab(this.panel().activeTab);
  }

  /** Escape/Tab give the focus back to the tab; a click elsewhere keeps it where it went. */
  protected onMenuClosed(reason: MenuCloseReason): void {
    const i = this.menuIndex();
    this.menu.set(null);
    if (reason !== 'outside' && i >= 0) {
      this.focusTab(i);
    }
  }

  protected cloneActive(): void {
    this.ws.setActive(this.side());
    this.ws.cloneTab(this.side());
  }

  protected closeActive(): void {
    this.ws.setActive(this.side());
    this.ws.closeTab(this.side());
    // the − button may now be disabled – never leave the focus on it
    this.focusTab(this.panel().activeTab);
  }

  // ---- dragging tabs (design 031 E1) ----

  protected onTabPointerDown(evt: PointerEvent, tab: TabState): void {
    // Shift+click closes the tab (018 J13); only the primary button drags
    if (evt.button !== 0 || evt.shiftKey || this.tabPress) {
      return;
    }
    this.tabPress = {
      x: evt.clientX,
      y: evt.clientY,
      pointerId: evt.pointerId,
      tabId: tab.id,
      el: evt.currentTarget as HTMLElement,
    };
    window.addEventListener('pointermove', this.onTabPointerMove, true);
    window.addEventListener('pointerup', this.onTabPointerUp, true);
    window.addEventListener('pointercancel', this.onTabPointerCancel, true);
    window.addEventListener('keydown', this.onTabDragKey, true);
    window.addEventListener('keyup', this.onTabDragKey, true);
  }

  private readonly onTabPointerMove = (evt: PointerEvent): void => {
    const press = this.tabPress;
    if (!press) {
      return;
    }
    this.lastTabPointer = { x: evt.clientX, y: evt.clientY };
    const copy = tabDragCopies(evt, IS_MAC);
    if (!this.tabDragging) {
      if (Math.hypot(evt.clientX - press.x, evt.clientY - press.y) < TAB_DRAG_THRESHOLD) {
        return;
      }
      const tab = this.panel().tabs.find((t) => t.id === press.tabId);
      if (!tab) {
        this.endTabPress();
        return;
      }
      this.tabDragging = true;
      try {
        press.el.setPointerCapture(press.pointerId);
      } catch {
        // the pointer may be gone already – the window listeners still see it
      }
      this.tabDrag.begin({
        tabId: tab.id,
        from: this.side(),
        title: this.title(tab),
        copy,
        x: evt.clientX,
        y: evt.clientY,
      });
    } else {
      this.tabDrag.move(evt.clientX, evt.clientY, copy);
    }
    evt.preventDefault();
  };

  private readonly onTabPointerUp = (evt: PointerEvent): void => {
    if (this.tabDragging) {
      swallowNextClick();
      this.tabDrag.drop(evt.clientX, evt.clientY, tabDragCopies(evt, IS_MAC));
    }
    this.endTabPress();
  };

  private readonly onTabPointerCancel = (): void => {
    if (this.tabDragging) {
      this.tabDrag.cancel();
    }
    this.endTabPress();
  };

  /** Esc cancels, the copy modifier switches live, every other key is swallowed while dragging. */
  private readonly onTabDragKey = (evt: KeyboardEvent): void => {
    if (!this.tabDragging) {
      return;
    }
    const modifier = ['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(evt.key);
    if (!modifier) {
      evt.preventDefault();
      evt.stopPropagation();
    }
    if (evt.key === 'Escape' && evt.type === 'keydown') {
      this.tabDrag.cancel();
      swallowNextClick();
      this.endTabPress();
      return;
    }
    if (modifier) {
      const { x, y } = this.lastTabPointer;
      this.tabDrag.move(x, y, tabDragCopies(modifiersAfter(evt, evt.type), IS_MAC));
    }
  };

  private endTabPress(): void {
    const press = this.tabPress;
    if (press && this.tabDragging) {
      try {
        press.el.releasePointerCapture(press.pointerId);
      } catch {
        // not captured
      }
    }
    this.tabPress = null;
    this.tabDragging = false;
    window.removeEventListener('pointermove', this.onTabPointerMove, true);
    window.removeEventListener('pointerup', this.onTabPointerUp, true);
    window.removeEventListener('pointercancel', this.onTabPointerCancel, true);
    window.removeEventListener('keydown', this.onTabDragKey, true);
    window.removeEventListener('keyup', this.onTabDragKey, true);
  }

  /** Near the right edge the hint goes left of the pointer. */
  protected flipHint(x: number): boolean {
    return typeof window !== 'undefined' && x > window.innerWidth - 380;
  }

  protected viewportWidth(): number {
    return typeof window === 'undefined' ? 0 : window.innerWidth;
  }

  private openMenuAt(index: number): void {
    const el = this.tabElement(index);
    const rect = el?.getBoundingClientRect();
    this.menu.set({
      tabId: this.panel().tabs[index].id,
      x: rect ? rect.left : 0,
      y: rect ? rect.bottom : 0,
    });
  }

  private focusTab(index: number): void {
    // after the next render the tab exists (moved/closed tabs re-render)
    setTimeout(() => this.tabElement(index)?.focus());
  }

  private tabElement(index: number): HTMLElement | null {
    return this.host.nativeElement.querySelectorAll<HTMLElement>('[role="tab"]')[index] ?? null;
  }
}

/** The click that follows releasing a tab drag must not select the tab under the pointer. */
function swallowNextClick(): void {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}
