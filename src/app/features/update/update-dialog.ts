import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { describeFsError } from '../../core/fs/fs-error';
import { locale } from '../../core/i18n/i18n';
import { DialogService } from '../../shared/dialog/dialog.service';
import { DialogKey } from '../../shared/dialog/dialog-key';
import { Modal } from '../../shared/dialog/modal';
import { UPDATE_TEXTS } from './update-texts';
import { UpdateStore } from './update.store';

/** A GitHub time (`2026-11-20T10:00:00Z`) as a local date; unreadable → as sent. Pure. */
export function releaseDate(iso: string, loc: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms).toLocaleDateString(loc, { dateStyle: 'long' });
}

/**
 * Check for updates (action CHECK_FOR_UPDATES, design 075 E9). Shows the result of a
 * check – started by the opener (`UpdateStore.check`) or taken from the automatic hint.
 * Release notes are plain text (interpolation, never `innerHTML`).
 */
@Component({
  selector: 'app-update-dialog',
  imports: [Modal, DialogKey],
  template: `
    <app-modal [heading]="t.title" width="min(34rem, 92vw)" (closed)="close()">
      <div class="body" role="status" aria-live="polite" data-testid="update-status">
        @switch (view().kind) {
          @case ('checking') {
            <p class="muted">{{ t.checking }}</p>
          }
          @case ('error') {
            <p>{{ t.failed }}</p>
            <p class="error">{{ errorText() }}</p>
          }
          @case ('done') {
            @if (info(); as i) {
              @if (i.newer) {
                <p class="headline">{{ t.available(i.latest) }}</p>
                <p class="muted">
                  {{ t.yours(i.current) }}
                  @if (i.publishedAt) {
                    {{ t.published(date(i.publishedAt)) }}
                  }
                </p>
                @if (isSkipped()) {
                  <p class="muted">{{ t.skipped }}</p>
                }
                @if (i.notes) {
                  <h3>{{ t.notes }}</h3>
                  <pre class="notes" tabindex="0" data-testid="update-notes">{{ i.notes }}</pre>
                  @if (i.notesTruncated) {
                    <p class="muted small">{{ t.notesCut }}</p>
                  }
                }
              } @else {
                <p class="headline">{{ t.upToDate(i.current) }}</p>
              }
            }
          }
        }
      </div>
      <p class="muted small">{{ t.privacy }}</p>
      <div class="buttons">
        @if (view().kind === 'error') {
          <button appDialogKey="secondary:R" type="button" class="btn" (click)="retry()">
            {{ t.retry }}
          </button>
        }
        @if (info()?.newer) {
          @if (isSkipped()) {
            <button appDialogKey="secondary:S" type="button" class="btn" (click)="unskip()">
              {{ t.unskip }}
            </button>
          } @else {
            <button appDialogKey="secondary:S" type="button" class="btn" (click)="skip()">
              {{ t.skip }}
            </button>
          }
        }
        <!-- without a newer version, Close is the answer: Enter and the first focus -->
        <button
          [appDialogKey]="info()?.newer ? 'cancel' : 'primary'"
          type="button"
          class="btn"
          [class.primary]="!info()?.newer"
          [attr.data-autofocus]="info()?.newer ? null : ''"
          (click)="close()"
        >
          {{ t.close }}
        </button>
        @if (info()?.newer) {
          <button
            appDialogKey="primary"
            type="button"
            class="btn primary"
            data-autofocus
            (click)="openPage()"
          >
            {{ t.openPage }}
          </button>
        }
      </div>
    </app-modal>
  `,
  styles: `
    .body {
      min-height: 3rem;
    }
    .headline {
      margin-top: 0;
      font-weight: 600;
    }
    .muted {
      color: var(--color-muted);
    }
    .small {
      font-size: var(--font-size-sm);
    }
    .error {
      color: var(--color-dialog-danger-text, var(--color-text));
    }
    h3 {
      margin: var(--spacing-3) 0 var(--spacing-1);
      font-size: var(--font-size-sm);
    }
    .notes {
      /* more in a high window (modal.css) */
      max-height: calc(12rem + var(--dialog-spare, 0px));
      margin: 0;
      padding: var(--spacing-2);
      overflow: auto;
      font: inherit;
      font-size: var(--font-size-sm);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      user-select: text;
      border: var(--border-width) solid var(--color-border);
    }
    .buttons {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-2);
      margin-top: var(--spacing-4);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdateDialog implements OnInit {
  protected readonly t = UPDATE_TEXTS;
  protected readonly store = inject(UpdateStore);
  private readonly dialogs = inject(DialogService);

  protected readonly view = this.store.view;
  protected readonly info = computed(() => {
    const v = this.view();
    return v.kind === 'done' ? v.info : null;
  });
  protected readonly isSkipped = computed(
    () => this.info()?.latest !== undefined && this.info()?.latest === this.store.skipped(),
  );
  protected readonly errorText = computed(() => {
    const v = this.view();
    return v.kind === 'error' ? describeFsError(v.error) : '';
  });

  ngOnInit(): void {
    void this.store.loadState();
  }

  protected date(iso: string): string {
    return releaseDate(iso, locale());
  }

  protected retry(): void {
    void this.store.check();
  }

  protected skip(): void {
    const i = this.info();
    if (i) void this.store.skip(i.latest);
  }

  protected unskip(): void {
    void this.store.skip(null);
  }

  protected openPage(): void {
    void this.store.openReleasePage().then(() => {
      if (this.view().kind === 'done') this.close();
    });
  }

  protected close(): void {
    this.store.cancel();
    this.dialogs.close();
  }
}
