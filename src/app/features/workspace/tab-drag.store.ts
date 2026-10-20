import { inject, Injectable, signal } from '@angular/core';
import { Side } from '../../core/session/session.models';
import { TabDropBlock, TabDropTarget, tabDropCheck } from './tab-drag-logic';
import { otherSide, WorkspaceStore } from './workspace.store';

/** A tab bar as a place to drop tabs (registered by `TabBar`). */
export interface TabBarZone {
  readonly side: Side;
  /** The tab bar: drops at the insertion position under the pointer. */
  readonly bar: HTMLElement;
  /** The rest of that side (header, list): drops at the end – only from the other side. */
  readonly panel: HTMLElement | null;
  /** Insertion position for pointer `x` (design 031 E2). */
  index(x: number): number;
}

/** A running tab drag. */
export interface TabDragState {
  readonly tabId: string;
  readonly from: Side;
  readonly title: string;
  readonly copy: boolean;
  readonly x: number;
  readonly y: number;
  readonly target: TabDropTarget | null;
  /** Over a bar or panel, but refused there (last tab, side full). */
  readonly blocked: TabDropBlock | null;
}

/**
 * Dragging tabs (design 031 E1–E4): one drag at a time, the tab bars of both
 * sides as zones, the drop through `WorkspaceStore.placeTab` (by id).
 */
@Injectable({ providedIn: 'root' })
export class TabDragStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly zones = new Set<TabBarZone>();

  readonly drag = signal<TabDragState | null>(null);

  /** Hit test (replaced in unit tests – jsdom has no layout). */
  elementAt: (x: number, y: number) => Element | null = (x, y) =>
    typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;

  registerZone(zone: TabBarZone): () => void {
    this.zones.add(zone);
    return () => this.zones.delete(zone);
  }

  begin(args: { tabId: string; from: Side; title: string; copy: boolean; x: number; y: number }) {
    this.drag.set({ ...args, ...this.targetAt(args.tabId, args.from, args.x, args.y, args.copy) });
  }

  move(x: number, y: number, copy?: boolean): void {
    const d = this.drag();
    if (!d) {
      return;
    }
    const c = copy ?? d.copy;
    this.drag.set({ ...d, x, y, copy: c, ...this.targetAt(d.tabId, d.from, x, y, c) });
  }

  cancel(): void {
    this.drag.set(null);
  }

  /** Released: places the tab (selected, its side active). Returns the placed tab's side or null. */
  drop(x: number, y: number, copy?: boolean): Side | null {
    this.move(x, y, copy);
    const d = this.drag();
    this.drag.set(null);
    if (!d?.target) {
      return null;
    }
    const id = this.ws.placeTab(d.tabId, d.target.side, d.target.index, d.copy);
    if (id === null) {
      return null;
    }
    this.ws.setActive(d.target.side);
    this.ws.requestFocus(d.target.side);
    return d.target.side;
  }

  private targetAt(
    tabId: string,
    from: Side,
    x: number,
    y: number,
    copy: boolean,
  ): { target: TabDropTarget | null; blocked: TabDropBlock | null } {
    const none = { target: null, blocked: null };
    const el = this.elementAt(x, y);
    if (!el) {
      return none;
    }
    const panels = this.ws.panels();
    let target: TabDropTarget | null = null;
    for (const zone of this.zones) {
      if (zone.bar.contains(el)) {
        target = { side: zone.side, index: zone.index(x) };
        break;
      }
    }
    if (!target) {
      // the other side's panel (header, list, status): at the end of its tabs
      const to = otherSide(from);
      const zone = [...this.zones].find((z) => z.side === to && z.panel?.contains(el));
      if (zone) {
        target = { side: to, index: panels[to].tabs.length };
      }
    }
    if (!target) {
      return none;
    }
    const fromIndex = panels[from].tabs.findIndex((t) => t.id === tabId);
    const check = tabDropCheck({
      from,
      fromIndex,
      fromCount: panels[from].tabs.length,
      to: target.side,
      toCount: panels[target.side].tabs.length,
      index: target.index,
      copy,
    });
    if (check === 'noop' || fromIndex < 0) {
      return none;
    }
    return check === null ? { target, blocked: null } : { target: null, blocked: check };
  }
}
