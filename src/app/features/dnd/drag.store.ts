import { inject, Injectable, signal } from '@angular/core';
import { DragDropApi, OsDragEvent } from '../../core/dnd/drag-drop-api';
import { OsDragApi } from '../../core/dnd/os-drag-api';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { DirEntry } from '../../core/fs/fs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { Side } from '../../core/session/session.models';
import { WatchApi } from '../../core/watch/watch-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { OpsStore } from '../ops/ops.store';
import {
  DND_TEXTS,
  DragKind,
  DragOrigin,
  DropTarget,
  resolveDropTarget,
  ZoneHit,
} from './dnd-logic';

/** A panel's file list as a drop zone. */
export interface DropZone {
  readonly element: HTMLElement;
  /** What lies under the pointer (`target` is inside `element`). */
  hit(target: Element): ZoneHit;
}

/** A running drag – from a panel or from the system. */
export interface DragState {
  readonly origin: DragOrigin;
  readonly fromSystem: boolean;
  readonly kind: DragKind;
  /** Entries dragged inside the app (empty for a drag from the system). */
  readonly sources: readonly DirEntry[];
  /** Paths dragged from the system. */
  readonly paths: readonly string[];
  /** The entries lie inside an archive (virtual paths) – not for other apps (design 028). */
  readonly inArchive: boolean;
  readonly x: number;
  readonly y: number;
  readonly target: DropTarget | null;
}

/**
 * Drag and drop of design 012 E5/E6: one drag at a time, the drop zones of
 * both panels, and the hand-over to the copy/move dialog (never a direct
 * operation). Drags from the system arrive through {@link DragDropApi}.
 */
@Injectable({ providedIn: 'root' })
export class DragStore {
  private readonly ops = inject(OpsStore);
  private readonly dialogs = inject(DialogService);
  private readonly jobs = inject(JobsStore);
  private readonly watchApi = inject(WatchApi, { optional: true });
  private readonly osDragApi = inject(OsDragApi, { optional: true });
  private readonly zones = new Map<Side, DropZone>();

  readonly drag = signal<DragState | null>(null);

  /** Hit test (replaced in unit tests – jsdom has no layout). */
  elementAt: (x: number, y: number) => Element | null = (x, y) =>
    typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;

  constructor() {
    const api = inject(DragDropApi, { optional: true });
    void api?.listen((e) => void this.onSystemDrag(e)).catch(() => undefined);
  }

  registerZone(side: Side, zone: DropZone): () => void {
    this.zones.set(side, zone);
    return () => {
      if (this.zones.get(side) === zone) {
        this.zones.delete(side);
      }
    };
  }

  /** A press in a panel became a drag. */
  begin(args: {
    side: Side;
    sourceDir: string | null;
    sources: readonly DirEntry[];
    kind: DragKind;
    x: number;
    y: number;
    inArchive?: boolean;
  }): void {
    const origin: DragOrigin = {
      side: args.side,
      dir: args.sourceDir,
      paths: new Set(args.sources.map((e) => e.path)),
    };
    this.drag.set({
      origin,
      fromSystem: false,
      kind: args.kind,
      sources: args.sources,
      paths: [],
      inArchive: args.inArchive ?? false,
      x: args.x,
      y: args.y,
      target: this.targetAt(args.x, args.y, origin),
    });
  }

  move(x: number, y: number, kind?: DragKind): void {
    const d = this.drag();
    if (!d) {
      return;
    }
    const target = this.targetAt(x, y, d.origin);
    this.drag.set({ ...d, x, y, kind: kind ?? d.kind, target });
  }

  cancel(): void {
    this.drag.set(null);
  }

  /** Released inside the app: opens the copy/move dialog for the target (if any). */
  async drop(x: number, y: number, kind?: DragKind): Promise<void> {
    this.move(x, y, kind);
    const d = this.drag();
    this.drag.set(null);
    if (!d || !d.target || d.fromSystem || d.origin.side === null) {
      return;
    }
    try {
      await this.ops.openCopyMoveFor({
        kind: d.kind,
        side: d.origin.side,
        sourceDir: d.origin.dir ?? '',
        sources: d.sources,
        target: d.target.dir,
      });
    } catch (err) {
      this.jobs.report(errorText(toFsError(err)));
    }
  }

  /**
   * The pointer left the window (design 028 E1): the drag from a panel goes on
   * as a system drag ("copy", E3) with the same entries – into Finder, Explorer,
   * Mail … Dragged back in, it arrives as a drop from the system (012 E6).
   */
  async handOff(): Promise<void> {
    const d = this.drag();
    this.drag.set(null);
    if (!d || d.fromSystem || d.sources.length === 0 || !this.osDragApi) {
      return;
    }
    if (d.inArchive) {
      this.jobs.report(DND_TEXTS.notFromArchive);
      return;
    }
    try {
      await this.osDragApi.startOsDrag(d.sources.map((e) => e.path));
    } catch (err) {
      const e = toFsError(err);
      // released just before the start: nothing to say, the user let go (review 028 #1)
      if (e.code !== 'drag_not_held') {
        this.jobs.report(errorText(e));
      }
    }
  }

  /** The label next to the pointer. */
  label(d: DragState): string {
    if (d.fromSystem) {
      return d.target ? `${DND_TEXTS.dropFromSystem(d.paths.length)} → ${d.target.name}` : '';
    }
    return DND_TEXTS.label(d.kind, d.sources.length, d.sources[0]?.name ?? '', d.target);
  }

  private targetAt(x: number, y: number, origin: DragOrigin): DropTarget | null {
    const el = this.elementAt(x, y);
    if (!el) {
      return null;
    }
    for (const zone of this.zones.values()) {
      if (zone.element.contains(el)) {
        return resolveDropTarget(zone.hit(el), origin);
      }
    }
    return null;
  }

  /** Files dragged from Finder/Explorer/… over the window (design 012 E6). */
  private async onSystemDrag(e: OsDragEvent): Promise<void> {
    if (this.dialogs.open() !== null) {
      this.drag.set(null);
      return;
    }
    switch (e.type) {
      case 'enter': {
        const origin: DragOrigin = { side: null, dir: null, paths: new Set(e.paths) };
        this.drag.set({
          origin,
          fromSystem: true,
          kind: 'copy',
          sources: [],
          paths: e.paths,
          inArchive: false,
          x: e.x,
          y: e.y,
          target: this.targetAt(e.x, e.y, origin),
        });
        break;
      }
      case 'over':
        this.move(e.x, e.y);
        break;
      case 'leave':
        this.drag.set(null);
        break;
      case 'drop':
        await this.dropFromSystem(e.paths, e.x, e.y);
        break;
    }
  }

  private async dropFromSystem(paths: readonly string[], x: number, y: number): Promise<void> {
    const origin: DragOrigin = { side: null, dir: null, paths: new Set(paths) };
    const target = this.targetAt(x, y, origin);
    this.drag.set(null);
    if (!target || paths.length === 0 || !this.watchApi) {
      return;
    }
    try {
      const described = await this.watchApi.describePaths(paths);
      if (described.entries.length === 0) {
        this.jobs.report(DND_TEXTS.nothingDropped);
        return;
      }
      if (described.parent === target.dir) {
        return; // dropped where it already is
      }
      if (described.missing > 0) {
        this.jobs.report(DND_TEXTS.missingDropped(described.missing));
      }
      await this.ops.openCopyMoveFor({
        kind: 'copy',
        side: target.side,
        sourceDir: described.parent ?? '',
        sources: described.entries,
        target: target.dir,
      });
    } catch (err) {
      this.jobs.report(errorText(toFsError(err)));
    }
  }
}
