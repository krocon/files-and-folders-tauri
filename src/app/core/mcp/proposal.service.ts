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

/**
 * The proposal of an MCP client that is open right now (design 071, tier 2) – at most
 * one. The stores that open the normal dialogs tell here how it ended: the job the
 * user started, or that the dialog was closed. A dialog that appears while the user
 * types or clicks must not be confirmed by accident: its button is locked for a moment
 * (`armed`), the focus starts on Cancel and Enter never confirms (the dialogs).
 */
@Injectable({ providedIn: 'root' })
export class ProposalService {
  readonly current = signal<Proposal | null>(null);
  /** The confirm button may be used. */
  readonly armed = signal(false);
  private settle: ((outcome: ProposalOutcome) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** A proposal's dialog opens; resolves when the user confirmed or closed it. */
  begin(proposal: Proposal): Promise<ProposalOutcome> {
    this.end({ outcome: 'cancelled' });
    this.current.set(proposal);
    this.armed.set(false);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.armed.set(true);
    }, PROPOSAL_ARM_MS);
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

  /** May the confirm button of a dialog proposed by `client` be used? */
  locked(proposedBy: string | undefined | null): boolean {
    return !!proposedBy && !this.armed();
  }

  private end(outcome: ProposalOutcome): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const settle = this.settle;
    this.settle = null;
    this.current.set(null);
    this.armed.set(false);
    settle?.(outcome);
  }
}
