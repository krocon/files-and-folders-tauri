import { USAGE_TEXTS } from '../diskusage/disk-usage-texts';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FsError } from '../../core/fs/fs.models';
import { DeleteMode } from '../../core/jobs/jobs.models';
import { isRemotePath } from '../../core/remote/remote-path';
import { REMOTE_TEXTS } from '../remote/remote-texts';
import { ARCHIVE_TEXTS } from '../archive/archive-texts';
import { Modal } from '../../shared/dialog/modal';
import { dialogError } from './ops-logic';
import { OPS_TEXTS } from './ops-texts';
import { OpsStore } from './ops.store';
import { liveCount } from './live-count';
import { formatSize } from '../../shared/format';
import { DUP_TEXTS } from '../duplicates/duplicates-texts';

const SHOWN = 5;

/**
 * F8 / Del (trash, Enter = delete – it can be restored) and Shift+F8 /
 * Shift+Del (permanent: red, Enter = cancel). Root, home and system paths need
 * an extra tick (design 006 E6/E7). The trash dialog also offers "Delete
 * permanently" as a second, red button: never the default, and while it is
 * hovered or focused the message says that it cannot be undone. The size of
 * the entries is counted live; the buttons never wait for it.
 */
@Component({
  selector: 'app-delete-dialog',
  imports: [Modal],
  template: `
    @if (req(); as r) {
      <app-modal
        [heading]="permanent() ? t.deletePermanentTitle : t.deleteTitle"
        [dialogRole]="permanent() ? 'alertdialog' : 'dialog'"
        describedBy="fnf-delete-message"
        width="54rem"
        (closed)="ops.close()"
      >
        <div class="form">
          <p id="fnf-delete-message" class="message" [class.danger-text]="showsPermanent()">
            {{
              showsPermanent()
                ? t.deletePermanentMessage(r.entries.length)
                : t.deleteTrashMessage(r.entries.length)
            }}
          </p>
          @if (count(); as c) {
            <p class="size" data-testid="delete-size">
              {{ t.deleteSize }}:
              @if (c.state === 'done') {
                <strong>{{
                  c.size.cancelled ? t.sizeAtLeast(fmtSize(c.size.bytes)) : fmtSize(c.size.bytes)
                }}</strong>
                <span class="muted">
                  · {{ t.filesAndDirs(c.size.files, c.size.dirs)
                  }}{{ c.size.unreadable > 0 ? t.unreadable(c.size.unreadable) : '' }}</span
                >
              } @else {
                <strong>{{ c.items > 0 ? t.sizeAtLeast(fmtSize(c.bytes)) : t.counting }}</strong>
                @if (c.items > 0) {
                  <span class="muted"> · {{ t.countedSoFar(c.items) }}</span>
                }
                <i class="fa fa-spinner fa-pulse muted" aria-hidden="true"></i>
              }
            </p>
          }
          <ul class="names">
            @for (e of shown(); track e.path) {
              <li class="path">{{ e.name }}</li>
            }
            @if (r.entries.length > shown().length) {
              <li class="muted">{{ t.moreEntries(r.entries.length - shown().length) }}</li>
            }
          </ul>

          @if (r.inArchive) {
            <p class="muted strong" role="note">
              <i class="fa fa-file-archive-o" aria-hidden="true"></i>
              {{ archiveTexts.deleteNoTrash }}
            </p>
          }
          @if (onServer()) {
            <p class="muted strong" role="note">
              <i class="fa fa-server" aria-hidden="true"></i> {{ remoteTexts.noTrash }}
            </p>
          }
          @if (r.scanAgeMin !== undefined) {
            <p class="muted" role="note" [class.strong]="r.mode === 'permanent'">
              {{ usage.scanAge(r.scanAgeMin) }}
            </p>
          }
          @if (r.sizeOnly) {
            <div class="danger-box" role="note">
              <strong>{{ dup.sizeOnlyDelete }}</strong>
            </div>
          }
          @if (r.wholeGroups) {
            <div class="danger-box" role="note">
              <strong>{{ dup.wholeGroups(r.wholeGroups) }}</strong>
            </div>
          }
          @if (r.dangers.length > 0) {
            <div class="danger-box" role="group" [attr.aria-label]="t.dangerTitle">
              <strong>{{ t.dangerTitle }}</strong>
              <ul>
                @for (d of r.dangers; track d.path) {
                  <li>
                    <span class="path">{{ d.path }}</span> – {{ t.danger(d.danger!) }}
                  </li>
                }
              </ul>
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="allowDangerous()"
                  (change)="allowDangerous.set(!allowDangerous())"
                />
                {{ t.dangerConfirm }}
              </label>
            </div>
          }
          <p class="error" role="alert">{{ errorText() }}</p>
          <div class="buttons">
            @if (!permanent()) {
              <!-- hidden, not removed, while armed: the buttons must not move under the pointer -->
              <div class="help" [style.visibility]="armed() ? 'hidden' : null">
                {{ t.trashHint }}
              </div>
              <div class="spacer"></div>
            }
            <button
              type="button"
              class="btn"
              [attr.data-autofocus]="cancelFirst() ? '' : null"
              (click)="ops.close()"
            >
              {{ t.cancel }}
            </button>
            @if (!permanent()) {
              <button
                type="button"
                class="btn danger"
                data-testid="delete-permanent"
                [disabled]="busy() || (r.dangers.length > 0 && !allowDangerous())"
                (mouseenter)="armed.set(true)"
                (mouseleave)="armed.set(false)"
                (focus)="armed.set(true)"
                (blur)="armed.set(false)"
                (click)="confirm('permanent')"
              >
                {{ t.deletePermanent }}
              </button>
            }
            <button
              type="button"
              class="btn"
              [class.primary]="!permanent()"
              [class.danger]="permanent()"
              [attr.data-autofocus]="cancelFirst() ? null : ''"
              data-testid="delete-confirm"
              [disabled]="busy() || (r.dangers.length > 0 && !allowDangerous())"
              (click)="confirm()"
            >
              {{ permanent() ? t.deletePermanent : t.toTrash }}
            </button>
          </div>
        </div>
      </app-modal>
    }
  `,
  styleUrl: './ops-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteDialog {
  protected readonly t = OPS_TEXTS;
  protected readonly ops = inject(OpsStore);
  protected readonly req = this.ops.del;
  protected readonly permanent = computed(() => this.req()?.mode === 'permanent');
  protected readonly remoteTexts = REMOTE_TEXTS;
  protected readonly archiveTexts = ARCHIVE_TEXTS;
  /** Deleting on a server (design 034): permanent, there is no trash. */
  protected readonly onServer = computed(() => isRemotePath(this.req()?.sourceDir));
  /** The trash dialog's "Delete permanently" button is hovered or focused. */
  protected readonly armed = signal(false);
  /** The message warns "cannot be undone": permanent mode or the armed second button. */
  protected readonly showsPermanent = computed(() => this.permanent() || this.armed());
  /** Enter must not destroy: permanent delete, or a dangerous path (its button starts disabled). */
  protected readonly cancelFirst = computed(
    () =>
      this.permanent() ||
      (this.req()?.dangers.length ?? 0) > 0 ||
      (this.req()?.wholeGroups ?? 0) > 0,
  );
  protected readonly dup = DUP_TEXTS;
  protected readonly usage = USAGE_TEXTS;
  /**
   * Size of what goes away, counted live (job `count`, the progress grows about
   * every 100 ms). Never blocks the buttons. Not inside archives (virtual paths).
   */
  protected readonly count = liveCount(
    this.req()?.inArchive ? null : (this.req()?.entries.map((e) => e.path) ?? null),
  );
  protected readonly fmtSize = formatSize;
  protected readonly shown = computed(() => this.req()?.entries.slice(0, SHOWN) ?? []);
  protected readonly allowDangerous = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<FsError | null>(null);
  protected readonly errorText = computed(() => {
    const e = this.error();
    return e ? dialogError(e) : '';
  });

  /** `mode` overrides the request's mode (the trash dialog's "Delete permanently"). */
  protected async confirm(mode?: DeleteMode): Promise<void> {
    const req = this.req();
    if (!req || this.busy() || (req.dangers.length > 0 && !this.allowDangerous())) {
      return;
    }
    this.busy.set(true);
    try {
      const run = mode && mode !== req.mode ? { ...req, mode } : req;
      this.error.set(await this.ops.runDelete(run, this.allowDangerous()));
    } finally {
      this.busy.set(false);
    }
  }
}
