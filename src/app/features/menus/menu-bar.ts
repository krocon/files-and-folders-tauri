import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DialogService } from '../../shared/dialog/dialog.service';
import {
  ContextMenu,
  isTypeahead,
  MenuCloseReason,
  typeaheadIndex,
} from '../workspace/context-menu';
import { WorkspaceStore } from '../workspace/workspace.store';
import { MENU_TEXTS } from './menu-texts';
import { MenuService } from './menu.service';

/**
 * The menu bar in the window (Windows/Linux, design 014 E5) after the APG
 * menubar pattern: roving focus, ←/→ move (also while a menu is open), ↓ /
 * Enter / Space open, Esc closes (focus back to the entry), Esc on an entry
 * returns to the file list, a letter jumps to the menu starting with it, Tab in a
 * drop-down leaves the bar. The drop-downs are the {@link ContextMenu}.
 */
@Component({
  selector: 'app-menu-bar',
  imports: [ContextMenu],
  template: `
    @if (menus.mode() === 'html') {
      <div
        class="bar"
        role="menubar"
        [attr.aria-label]="texts.menuBar"
        [attr.inert]="dialogs.open() !== null ? '' : null"
      >
        @for (m of menus.menuBar(); track m.id; let i = $index) {
          <button
            type="button"
            role="menuitem"
            class="top"
            aria-haspopup="menu"
            [attr.aria-expanded]="openIndex() === i"
            [attr.tabindex]="i === roving() ? 0 : -1"
            [attr.data-index]="i"
            (click)="toggle(i)"
            (mouseenter)="onHover(i)"
            (keydown)="onKey($event, i)"
          >
            {{ m.label }}
          </button>
        }
      </div>
      @for (d of dropdown(); track d.key) {
        <app-context-menu
          [items]="d.items"
          [x]="d.x"
          [y]="d.y"
          [label]="d.label"
          [autofocus]="d.focus"
          (chosen)="onChosen($event)"
          (closed)="onClosed($event)"
          (sideways)="move($event, true)"
        />
      }
    }
  `,
  styleUrl: './menu-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenuBar {
  protected readonly menus = inject(MenuService);
  protected readonly dialogs = inject(DialogService);
  private readonly ws = inject(WorkspaceStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly texts = MENU_TEXTS;

  protected readonly roving = signal(0);
  protected readonly openIndex = signal<number | null>(null);
  private readonly openFocus = signal(true);
  /** New key per opening: a fresh menu instance (focus, position, viewport check). */
  private readonly openKey = signal(0);
  /** Time of the last close by a click outside – that click may be on our own entry. */
  private closedAt = 0;

  protected readonly dropdown = computed(() => {
    const i = this.openIndex();
    const menu = i === null ? undefined : this.menus.menuBar()[i];
    if (i === null || !menu) {
      return [];
    }
    const rect = this.button(i)?.getBoundingClientRect();
    return [
      {
        key: this.openKey(),
        items: menu.items,
        label: menu.label,
        x: rect?.left ?? 0,
        y: rect?.bottom ?? 0,
        focus: this.openFocus(),
      },
    ];
  });

  constructor() {
    let seen = 0;
    effect(() => {
      const n = this.menus.menuBarFocus();
      untracked(() => {
        if (n !== seen) {
          seen = n;
          this.button(this.roving())?.focus();
        }
      });
    });
  }

  protected toggle(i: number): void {
    if (this.openIndex() === i || (Date.now() - this.closedAt < 300 && this.lastClosed === i)) {
      this.openIndex.set(null);
      this.lastClosed = -1;
      return;
    }
    this.openAt(i, true);
  }

  private lastClosed = -1;

  protected onHover(i: number): void {
    if (this.openIndex() !== null && this.openIndex() !== i) {
      this.openAt(i, false);
    }
  }

  protected onKey(evt: KeyboardEvent, i: number): void {
    const count = this.menus.menuBar().length;
    switch (evt.key) {
      case 'ArrowRight':
        this.focusTop((i + 1) % count);
        break;
      case 'ArrowLeft':
        this.focusTop((i - 1 + count) % count);
        break;
      case 'Home':
        this.focusTop(0);
        break;
      case 'End':
        this.focusTop(count - 1);
        break;
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        this.openAt(i, true);
        break;
      case 'Escape':
        this.ws.requestFocus(this.ws.activeSide());
        break;
      default: {
        const labels = this.menus.menuBar().map((m) => m.label);
        const next = isTypeahead(evt) ? typeaheadIndex(labels, i, evt.key) : -1;
        if (next < 0) {
          return;
        }
        this.focusTop(next);
      }
    }
    evt.preventDefault();
    evt.stopPropagation();
  }

  /** ←/→ inside an open menu: the neighbour menu opens. */
  protected move(delta: -1 | 1, focus: boolean): void {
    const i = this.openIndex();
    if (i === null) {
      return;
    }
    const count = this.menus.menuBar().length;
    this.openAt((i + delta + count) % count, focus);
  }

  protected onChosen(id: string): void {
    this.openIndex.set(null);
    // the action's dialog returns the focus to the list, not to the menu bar
    this.ws.requestFocus(this.ws.activeSide());
    setTimeout(() => void this.menus.run(id));
  }

  protected onClosed(reason: MenuCloseReason): void {
    const i = this.openIndex();
    this.openIndex.set(null);
    if (reason === 'tab') {
      // Tab leaves the menu bar (APG): back to the file list
      if (i !== null) {
        this.roving.set(i);
      }
      this.ws.requestFocus(this.ws.activeSide());
    } else if (reason === 'key' && i !== null) {
      this.focusTop(i);
    } else {
      this.closedAt = Date.now();
      this.lastClosed = i ?? -1;
    }
  }

  private openAt(i: number, focus: boolean): void {
    this.roving.set(i);
    this.openFocus.set(focus);
    this.openKey.update((k) => k + 1);
    this.openIndex.set(i);
    if (!focus) {
      this.button(i)?.focus();
      return;
    }
    // the focus may sit in the menu that was just replaced (←/→): make sure it lands in the new one
    setTimeout(() => {
      const menu = this.host.nativeElement.querySelector('app-context-menu');
      if (menu && !menu.contains(document.activeElement)) {
        (
          menu.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ??
          menu.querySelector<HTMLElement>('[role="menuitem"]')
        )?.focus();
      }
    });
  }

  private focusTop(i: number): void {
    this.roving.set(i);
    this.button(i)?.focus();
  }

  private button(i: number): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(`[data-index="${i}"]`);
  }
}
