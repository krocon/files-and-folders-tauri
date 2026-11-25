import { Injectable, signal } from '@angular/core';

/** The dialog a proposal opens (`DialogService` kinds). */
export type ProposalDialog = 'copy-move' | 'delete' | 'multi-rename' | 'multi-mkdir';

export interface Proposal {
  /** Id of the request from Rust. */
  readonly id: number;
  /** The client's name – shown, not authentic. */
  readonly client: string;
  readonly dialog: ProposalDialog;
}

export type ProposalOutcome =
  | { readonly outcome: 'confirmed'; readonly jobId: string | null }
  | { readonly outcome: 'cancelled' };

/** The confirm button of a proposal stays locked this long after its dialog opened. */
export const PROPOSAL_ARM_MS = 800;

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Meta',
  'Control',
  'Shift',
  'Alt',
  'AltGraph',
  'CapsLock',
]);

/**
 * The proposal of an MCP client that is open right now (design 071, tier 2) – at most
 * one. The stores that open the normal dialogs tell here how it ended: the job the
 * user started, or that the dialog was closed.
 *
 * A dialog that appears while the user types or clicks must not be confirmed by
 * accident. Its confirm button is locked ({@link armed} is false) until
 * {@link PROPOSAL_ARM_MS} passed **without a key** since the dialog appeared (review
 * #4): a key the user was already pressing – Enter, or the ⌘/Ctrl+Enter that opens a
 * folder in a new tab in the panel – starts the wait again instead of confirming. The
 * focus starts on Cancel and Enter alone never confirms (the dialogs). The same lock
 * guards the pairing question and a dialog over a selection a client changed
 * ({@link watch}).
 */
@Injectable({ providedIn: 'root' })
export class ProposalService {
  readonly current = signal<Proposal | null>(null);
  /** The confirm button may be used. */
  readonly armed = signal(false);
  private settle: ((outcome: ProposalOutcome) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watching = false;

  constructor() {
    if (typeof document !== 'undefined') {
      // capture: before the dialog sees the key
      document.addEventListener('keydown', (evt) => this.onKey(evt), true);
    }
  }

  /** A guarded dialog appeared: its button is locked until the keyboard was quiet. */
  watch(): void {
    this.watching = true;
    this.restart();
  }

  /** The guarded dialog is gone. */
  unwatch(): void {
    this.watching = false;
    this.clearTimer();
    this.armed.set(false);
  }

  /** Stops the lock unless a proposal is still open (a store closed another dialog). */
  release(): void {
    if (this.current() === null) {
      this.unwatch();
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private restart(): void {
    this.clearTimer();
    this.armed.set(false);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.armed.set(this.watching);
    }, PROPOSAL_ARM_MS);
  }

  /**
   * A key while a guarded dialog is open. Locked: the wait starts again. Armed: this
   * key may confirm – and the lock comes back right after it (keys in a row never do).
   */
  private onKey(evt: KeyboardEvent): void {
    if (!this.watching || MODIFIER_KEYS.has(evt.key)) {
      return;
    }
    if (this.armed()) {
      setTimeout(() => {
        if (this.watching) {
          this.restart();
        }
      });
    } else {
      this.restart();
    }
  }

  /** A proposal's dialog opens; resolves when the user confirmed or closed it. */
  begin(proposal: Proposal): Promise<ProposalOutcome> {
    this.end({ outcome: 'cancelled' });
    this.current.set(proposal);
    this.watch();
    return new Promise((resolve) => (this.settle = resolve));
  }

  /** The user started the proposed operation (`jobId` null: done without a job). */
  confirmed(dialog: ProposalDialog, jobId: string | null): void {
    if (this.current()?.dialog === dialog) {
      this.end({ outcome: 'confirmed', jobId });
    }
  }

  /** The dialog closed without the operation. No-op if nothing of `dialog` is open. */
  cancelled(dialog: ProposalDialog): void {
    if (this.current()?.dialog === dialog) {
      this.end({ outcome: 'cancelled' });
    }
  }

  /** Whatever is open ends as cancelled (another dialog took its place). */
  abandon(): void {
    this.end({ outcome: 'cancelled' });
  }

  /** May the confirm button of a dialog guarded for `client` be used? */
  locked(client: string | undefined | null): boolean {
    return !!client && !this.armed();
  }

  private end(outcome: ProposalOutcome): void {
    const settle = this.settle;
    this.settle = null;
    this.current.set(null);
    this.unwatch();
    settle?.(outcome);
  }
}
