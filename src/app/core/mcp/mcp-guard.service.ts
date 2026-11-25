import { computed, Injectable, signal } from '@angular/core';
import { Side } from '../session/session.models';

/** After a client changed the view, file-changing actions wait this long (review #2). */
export const VIEW_LOCK_MS = 1500;

interface Influence {
  readonly client: string;
  /** The marks the client set (the store's set itself) – null: it set none. */
  readonly marks: ReadonlySet<string> | null;
  /** The user has not moved the cursor or clicked in the panel since. */
  readonly untouched: boolean;
}

/**
 * What an MCP client changed in the view and the user has not taken back into their
 * own hands (design 071, review #2). Tier 1 changes no file – but it changes what the
 * user's next key acts on: the marks, the cursor, the folder a panel shows (the target
 * of a copy). Two protections hang on this service:
 *
 * - a short lock right after every such change ({@link locked}): actions that change
 *   files, opening a file and the shell line do nothing for a moment;
 * - as long as marks, cursor or folder of a panel are still the client's
 *   ({@link influence}), the next copy/move/delete dialog is treated like a proposal.
 *
 * Marks stay the client's until they change; cursor and folder until the user moves
 * the cursor or clicks in that panel.
 */
@Injectable({ providedIn: 'root' })
export class McpGuardService {
  private readonly records = signal<Partial<Record<Side, Influence>>>({});
  private lockedUntil = 0;
  /** The clock (tests replace it). */
  now: () => number = () => Date.now();

  /** The client whose changes are still in effect on some side – for the indicator. */
  readonly client = computed(() => {
    const r = this.records();
    return r.left?.client ?? r.right?.client ?? null;
  });

  /**
   * A client changed the view of `side`. `marks`: the set it produced; `undefined` keeps
   * what is known about the marks (cursor moved), `null` = the marks are not its (new folder).
   */
  changed(side: Side, client: string, marks?: ReadonlySet<string> | null): void {
    this.lockedUntil = this.now() + VIEW_LOCK_MS;
    const before = this.records()[side];
    this.records.update((r) => ({
      ...r,
      [side]: {
        client,
        marks: marks === undefined ? (before?.marks ?? null) : marks,
        untouched: true,
      },
    }));
  }

  /** Right after a change by a client: nothing that changes files or starts a program. */
  locked(): boolean {
    return this.now() < this.lockedUntil;
  }

  /** The user moved the cursor or clicked in the panel: cursor and folder are theirs again. */
  userTouched(side: Side): void {
    const r = this.records()[side];
    if (!r?.untouched) {
      return;
    }
    this.set(side, r.marks ? { ...r, untouched: false } : undefined);
  }

  /** The marks of `side` as they are now: a set other than the client's ends that part. */
  marksNow(side: Side, marks: ReadonlySet<string>): void {
    const r = this.records()[side];
    if (!r?.marks || (r.marks === marks && marks.size > 0)) {
      return;
    }
    this.set(side, r.untouched ? { ...r, marks: null } : undefined);
  }

  /** The client whose marks, cursor or folder still stand on `side`, else null. */
  influence(side: Side, marks: ReadonlySet<string>): string | null {
    const r = this.records()[side];
    if (!r) {
      return null;
    }
    const marked = r.marks !== null && r.marks === marks && marks.size > 0;
    return marked || r.untouched ? r.client : null;
  }

  /** The user confirmed an operation on `side` knowingly – or MCP was switched off. */
  forget(side?: Side): void {
    if (side === undefined) {
      this.records.set({});
      this.lockedUntil = 0;
    } else {
      this.set(side, undefined);
    }
  }

  private set(side: Side, value: Influence | undefined): void {
    this.records.update((r) => {
      const next = { ...r };
      if (value) {
        next[side] = value;
      } else {
        delete next[side];
      }
      return next;
    });
  }
}
