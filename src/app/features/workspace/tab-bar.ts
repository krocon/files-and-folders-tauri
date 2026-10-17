import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { Side } from '../../core/session/session.models';
import { ContextMenu, MenuItem } from './context-menu';
import { TEXTS } from './texts';
import { TabState, WorkspaceStore } from './workspace.store';

interface OpenMenu {
  readonly index: number;
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

  protected readonly panel = computed(() => this.ws.panels()[this.side()]);
  protected readonly menu = signal<OpenMenu | null>(null);
  protected readonly menuItems = computed<MenuItem[]>(() => {
    const open = this.menu();
    const count = this.panel().tabs.length;
    const m = TEXTS.tabMenu;
    return [
      { id: 'reload', label: m.reload },
      { id: 'close', label: m.close, disabled: count <= 1 },
      { id: 'moveToOther', label: m.moveToOther(this.side()), disabled: count <= 1 },
      { id: 'cloneToOther', label: m.cloneToOther(this.side()) },
      { id: 'moveLeft', label: m.moveLeft, disabled: !open || open.index === 0 },
      { id: 'moveRight', label: m.moveRight, disabled: !open || open.index >= count - 1 },
    ];
  });

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
    this.menu.set({ index, x: evt.clientX, y: evt.clientY });
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
    const open = this.menu();
    this.menu.set(null);
    if (!open) {
      return;
    }
    const side = this.side();
    const i = open.index;
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

  protected onMenuClosed(): void {
    const open = this.menu();
    this.menu.set(null);
    if (open) {
      this.focusTab(open.index);
    }
  }

  protected cloneActive(): void {
    this.ws.setActive(this.side());
    this.ws.cloneTab(this.side());
  }

  protected closeActive(): void {
    this.ws.setActive(this.side());
    this.ws.closeTab(this.side());
  }

  private openMenuAt(index: number): void {
    const el = this.tabElement(index);
    const rect = el?.getBoundingClientRect();
    this.menu.set({ index, x: rect ? rect.left : 0, y: rect ? rect.bottom : 0 });
  }

  private focusTab(index: number): void {
    // after the next render the tab exists (moved/closed tabs re-render)
    setTimeout(() => this.tabElement(index)?.focus());
  }

  private tabElement(index: number): HTMLElement | null {
    return this.host.nativeElement.querySelectorAll<HTMLElement>('[role="tab"]')[index] ?? null;
  }
}
