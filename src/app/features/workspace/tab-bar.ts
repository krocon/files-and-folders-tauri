import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  untracked,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { Side } from '../../core/session/session.models';
import { FileBrowserStore } from '../browser/file-browser.store';
import { ContextMenu, MenuItem } from './context-menu';
import { TEXTS } from './texts';
import { TabState, WorkspaceStore } from './workspace.store';

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
@Component({
  selector: 'app-tab-bar',
  imports: [ContextMenu],
  templateUrl: './tab-bar.html',
  styleUrl: './tab-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabBar {
  readonly side = input.required<Side>();

  protected readonly ws = inject(WorkspaceStore);
  protected readonly texts = TEXTS;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The panel's store (TabBar lives inside the FilePanel). */
  protected readonly store = inject(FileBrowserStore, { optional: true });
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
    return [
      { id: 'home', label: t.menuHome },
      ...group('fav', t.menuFavorites, favorites),
      ...group('recent', t.menuRecent, recent),
    ];
  });

  protected readonly panel = computed(() => this.ws.panels()[this.side()]);
  protected readonly menu = signal<OpenMenu | null>(null);
  /** Index of the menu's tab, -1 when it is gone (closed by a shortcut while the menu was open). */
  private readonly menuIndex = computed(() => {
    const open = this.menu();
    return open ? this.panel().tabs.findIndex((t) => t.id === open.tabId) : -1;
  });
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
    ];
  });

  constructor() {
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
    }
    if (path !== undefined) {
      this.ws.requestNavigate(this.side(), path);
    }
    this.ws.requestFocus(this.side());
  }

  protected onFolderMenuClosed(reason: 'key' | 'outside'): void {
    this.folderMenuOpen.set(null);
    if (reason === 'key') {
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
    return tab.title || (tab.path === null ? TEXTS.homeTitle : '…');
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
    this.menu.set(null);
    if (i < 0) {
      return;
    }
    const side = this.side();
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
  protected onMenuClosed(reason: 'key' | 'outside'): void {
    const i = this.menuIndex();
    this.menu.set(null);
    if (reason === 'key' && i >= 0) {
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
