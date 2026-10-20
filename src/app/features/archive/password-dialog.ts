import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FsError } from '../../core/fs/fs.models';
import { Modal } from '../../shared/dialog/modal';
import { dialogError } from '../ops/ops-logic';
import { ArchiveStore } from './archive.store';
import { ARCHIVE_TEXTS } from './archive-texts';

/**
 * Password for an encrypted archive (design 025 E4): asked when a listing,
 * Enter on an entry or an extract job needs it. The password goes to Rust
 * (checked, kept in memory for this run); the field is cleared at once.
 * Enter opens, Esc cancels.
 */
@Component({
  selector: 'app-archive-password-dialog',
  imports: [Modal],
  template: `
    @if (req(); as r) {
      <app-modal
        [heading]="t.passwordTitle"
        width="min(36rem, 94vw)"
        (closed)="store.closePassword()"
      >
        <form class="form" (submit)="submit($event)">
          <p class="source">{{ t.passwordIntro(r.archive) }}</p>
          @if (r.wrong && !error()) {
            <p class="error" role="status">{{ t.passwordWrongBefore }}</p>
          }
          <label class="field">
            <span>{{ t.password }}</span>
            <input
              data-autofocus
              type="password"
              autocomplete="off"
              spellcheck="false"
              [value]="value()"
              aria-describedby="fnf-password-error fnf-password-help"
              [attr.aria-invalid]="error() ? 'true' : null"
              (input)="value.set($any($event.target).value); error.set(null)"
            />
          </label>
          <p id="fnf-password-error" class="error" role="alert">{{ errorText() }}</p>
          <div class="buttons">
            <div id="fnf-password-help" class="help">{{ t.passwordKept }}</div>
            <div class="spacer"></div>
            <button type="button" class="btn" (click)="store.closePassword()">
              {{ t.cancel }}
            </button>
            <button type="submit" class="btn primary" [disabled]="busy()">{{ t.open }}</button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrl: '../ops/ops-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArchivePasswordDialog {
  protected readonly t = ARCHIVE_TEXTS;
  protected readonly store = inject(ArchiveStore);
  protected readonly req = this.store.password;
  protected readonly value = signal('');
  protected readonly error = signal<FsError | null>(null);
  protected readonly busy = signal(false);

  protected errorText(): string {
    const e = this.error();
    return e ? dialogError(e) : '';
  }

  protected submit(evt: Event): void {
    evt.preventDefault();
    void this.start();
  }

  private async start(): Promise<void> {
    const req = this.req();
    if (!req || this.busy()) {
      return;
    }
    this.busy.set(true);
    const password = this.value();
    try {
      const e = await this.store.submitPassword(req, password);
      this.error.set(e);
      if (e) {
        this.value.set('');
      }
    } finally {
      this.busy.set(false);
    }
  }
}
