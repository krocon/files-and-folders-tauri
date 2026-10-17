import { computed, effect, inject, Injectable, Injector, signal, untracked } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { isParentRow } from '../../core/fs/fs.models';
import { toFsError } from '../../core/fs/fs-error';
import { MenuApi } from '../../core/menu/menu-api';
import { NativeMenuSpec } from '../../core/menu/menu.models';
import { Side } from '../../core/session/session.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import {
  contextKind,
  contextMenuFor,
  enabledChanges,
  MenuDef,
  nativeEnabled,
  nativeStructureKey,
  resolveMenuBar,
  resolveMenu,
  toNativeSpec,
} from './menu-model';
import { MENU_TEXTS } from './menu-texts';
import { MenuCloseReason } from '../workspace/context-menu';

/** How long the native spec waits for more changes before it is sent (design 014 E7). */
export const NATIVE_DEBOUNCE_MS = 150;

interface OpenContext {
  readonly side: Side;
  readonly x: number;
  readonly y: number;
  readonly defs: readonly MenuDef[];
}

/**
 * Root service of the menus (design 014): the file-list context menu (one at a
 * time), the menu bar – native (macOS) or in the window – and the bridge from
 * native menu events to the actions. Menus never contain logic of their own:
 * every entry runs `ActionService.runAny(id)`.
 */
@Injectable({ providedIn: 'root' })
export class MenuService {
  private readonly actions = inject(ActionService);
  private readonly ws = inject(WorkspaceStore);
  private readonly dialogs = inject(DialogService);
  private readonly api = inject(MenuApi);
  private readonly injector = inject(Injector);

  private readonly open = signal<OpenContext | null>(null);
  /** `unknown` until the backend answered; `html` = this window shows its own menu bar. */
  readonly mode = signal<'unknown' | 'native' | 'html'>('unknown');
  /** Bumped by FOCUS_MENU_BAR – the HTML menu bar focuses its first entry. */
  readonly menuBarFocus = signal(0);

  /** The open context menu with live entries (tools and states may change while open). */
  readonly context = computed(() => {
    const open = this.open();
    if (!open) {
      return null;
    }
    return {
      x: open.x,
      y: open.y,
      label: MENU_TEXTS.contextMenu,
      items: resolveMenu(open.defs, this.actions, this.actions.platform()),
    };
  });

  /** Menus of the HTML menu bar (Windows/Linux). */
  readonly menuBar = computed(() => resolveMenuBar(this.actions, this.actions.platform()));

  private started = false;

  /** Starts the native menu (if the platform has one) and its event bridge. */
  init(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    void this.api
      .subscribe((evt) => this.onNativeEvent(evt.id))
      .catch((err) => this.actions.report(`Menu: ${toFsError(err).message}`));
    const spec = computed(() =>
      toNativeSpec(this.actions, this.actions.platform(), this.dialogs.open() !== null),
    );
    let timer: ReturnType<typeof setTimeout> | null = null;
    // what the native menu shows: its structure (labels, shortcuts, tools) and the states
    let sentStructure = '';
    let sentEnabled: ReadonlyMap<string, boolean> = new Map();
    let latest: NativeMenuSpec | null = null;
    const flush = () => {
      timer = null;
      const next = latest;
      if (!next || this.mode() === 'html') {
        return;
      }
      const structure = nativeStructureKey(next);
      const enabled = nativeEnabled(next);
      if (structure !== sentStructure) {
        sentStructure = structure;
        sentEnabled = enabled;
        void this.api
          .setAppMenu(next)
          .then((native) => this.mode.set(native ? 'native' : 'html'))
          .catch((err) => {
            this.mode.set('html');
            this.actions.report(`Menu: ${toFsError(err).message}`);
          });
        return;
      }
      // only states changed (selection, dialog, tab): toggle items, no rebuild (review 014 #7)
      if (this.mode() !== 'native') {
        timer = setTimeout(flush, NATIVE_DEBOUNCE_MS); // the first menu is still on its way
        return;
      }
      const changes = enabledChanges(sentEnabled, enabled);
      sentEnabled = enabled;
      if (changes.length > 0) {
        void this.api
          .setMenuEnabled(changes)
          .catch((err) => this.actions.report(`Menu: ${toFsError(err).message}`));
      }
    };
    effect(
      () => {
        const next = spec();
        untracked(() => {
          if (this.mode() === 'html') {
            return;
          }
          latest = next;
          if (timer !== null) {
            clearTimeout(timer);
          }
          // the first spec goes out at once (no flash of the HTML menu bar on macOS)
          timer = setTimeout(flush, sentStructure === '' ? 0 : NATIVE_DEBOUNCE_MS);
        });
      },
      { injector: this.injector },
    );
  }

  /** A native menu item was chosen. */
  onNativeEvent(id: string): void {
    // like the keyboard dispatcher: keys and menus wait while a dialog is open;
    // a menu event right after the same key is its echo (design 014 E6) – also when the
    // dispatcher held that key back in a text field (review 014 #1)
    if (this.dialogs.open() !== null || this.actions.handledByKeyRecently(id)) {
      return;
    }
    void this.actions.runAny(id);
  }

  /**
   * Right click in the list of `side` (design 014 E3): a row moves the cursor
   * there, the marks stay; `rowIndex` -1 = free space.
   */
  openFromPointer(side: Side, rowIndex: number, x: number, y: number): void {
    this.ws.setActive(side);
    const panel = this.ws.panel(side);
    const controller = panel?.controller();
    const row = rowIndex >= 0 ? controller?.displayedEntries()[rowIndex] : undefined;
    if (row && !isParentRow(row)) {
      controller?.moveCursorTo(row.path);
    }
    this.openFor(side, x, y, row && !isParentRow(row) ? row : null);
  }

  /** Shift+F10 / context-menu key: at the cursor row of the active side. */
  openAtCursor(): void {
    const side = this.ws.activeSide();
    const entry = this.ws.panel(side)?.controller()?.cursorEntry() ?? null;
    const pane = document.getElementById(`fnf-pane-${side}`);
    const cell = pane?.querySelector<HTMLElement>('.fnf-cursor');
    const rect = (cell ?? pane)?.getBoundingClientRect();
    const x = rect ? rect.left + Math.min(48, rect.width / 2) : 0;
    const y = rect ? (cell ? rect.bottom : rect.top + 24) : 0;
    this.openFor(side, x, y, entry && !isParentRow(entry) ? entry : null);
  }

  private openFor(side: Side, x: number, y: number, entry: { kind: string } | null): void {
    const store = this.ws.panel(side)?.store;
    const marked = store?.markedEntries().filter((e) => !isParentRow(e)).length ?? 0;
    const kind = contextKind({
      resultTab: (store?.searchKey() ?? null) !== null,
      markedCount: marked,
      entry,
    });
    this.open.set({ side, x, y, defs: contextMenuFor(kind, marked) });
  }

  /** An entry of the context menu: focus back to the list (the dialog's opener), then run. */
  choose(id: string): void {
    const open = this.open();
    this.open.set(null);
    if (open) {
      this.ws.requestFocus(open.side);
    }
    setTimeout(() => void this.actions.runAny(id));
  }

  /** An entry of the HTML menu bar. */
  run(id: string): Promise<boolean> {
    return this.actions.runAny(id);
  }

  close(reason: MenuCloseReason): void {
    const open = this.open();
    this.open.set(null);
    if (open && reason !== 'outside') {
      this.ws.requestFocus(open.side);
    }
  }

  /** FOCUS_MENU_BAR: only the HTML menu bar can take the focus. */
  canFocusMenuBar(): boolean {
    return this.mode() === 'html';
  }

  focusMenuBar(): void {
    this.menuBarFocus.update((n) => n + 1);
  }

  /** QUIT_APP: closes the window like its close button (jobs ask, session is saved). */
  async quit(): Promise<void> {
    await this.ws.flush();
    await this.api.closeMainWindow();
  }
}
