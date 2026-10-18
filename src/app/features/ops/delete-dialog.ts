import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FsError } from '../../core/fs/fs.models';
import { Modal } from '../../shared/dialog/modal';
import { dialogError } from './ops-logic';
import { OPS_TEXTS } from './ops-texts';
import { OpsStore } from './ops.store';
import { DUP_TEXTS } from '../duplicates/duplicates-texts';

const SHOWN = 5;

/**
 * F8 / Del (trash, Enter = delete – it can be restored) and Shift+F8 /
 * Shift+Del (permanent: red, Enter = cancel). Root, home and system paths need
 * an extra tick (design 006 E6/E7).
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
        width="34rem"
        (closed)="ops.close()"
      >
        <div class="form">
          <p id="fnf-delete-message" class="message" [class.danger-text]="permanent()">
            {{
              permanent()
                ? t.deletePermanentMessage(r.entries.length)
                : t.deleteTrashMessage(r.entries.length)
            }}
          </p>
          <ul class="names">
            @for (e of shown(); track e.path) {
              <li class="path">{{ e.name }}</li>
            }
            @if (r.entries.length > shown().length) {
              <li class="muted">{{ t.moreEntries(r.entries.length - shown().length) }}</li>
            }
          </ul>
          @if (!permanent()) {
            <p class="help">{{ t.trashHint }}</p>
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
            <button
              type="button"
              class="btn"
              [attr.data-autofocus]="cancelFirst() ? '' : null"
              (click)="ops.close()"
            >
              {{ t.cancel }}
            </button>
            <button
              type="button"
              class="btn"
              [class.primary]="!permanent()"
              [class.danger]="permanent()"
              [attr.data-autofocus]="cancelFirst() ? null : ''"
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
  styleUrl: './ops-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteDialog {
  protected readonly t = OPS_TEXTS;
  protected readonly ops = inject(OpsStore);
  protected readonly req = this.ops.del;
  protected readonly permanent = computed(() => this.req()?.mode === 'permanent');
  /** Enter must not destroy: permanent delete, or a dangerous path (its button starts disabled). */
  protected readonly cancelFirst = computed(
    () =>
      this.permanent() ||
      (this.req()?.dangers.length ?? 0) > 0 ||
      (this.req()?.wholeGroups ?? 0) > 0,
  );
  protected readonly dup = DUP_TEXTS;
  protected readonly shown = computed(() => this.req()?.entries.slice(0, SHOWN) ?? []);
  protected readonly allowDangerous = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<FsError | null>(null);
  protected readonly errorText = computed(() => {
    const e = this.error();
    return e ? dialogError(e) : '';
  });

  protected async confirm(): Promise<void> {
    const req = this.req();
    if (!req || this.busy() || (req.dangers.length > 0 && !this.allowDangerous())) {
      return;
    }
    this.busy.set(true);
    try {
      this.error.set(await this.ops.runDelete(req, this.allowDangerous()));
    } finally {
      this.busy.set(false);
    }
  }
}
