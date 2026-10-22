import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { DedupeAction } from '../../core/jobs/jobs.models';
import { SearchHit } from '../../core/search/search.models';
import { formatSize } from '../../shared/format';
import { Modal } from '../../shared/dialog/modal';
import { DUP_TEXTS } from './duplicates-texts';
import { DEDUPE_PAGE, DuplicatesStore } from './duplicates.store';

/**
 * "Delete duplicates" (design 042 E5): what goes, what stays, how much becomes free;
 * trash (default), permanent (asks twice) or into the other side's folder. The groups
 * are shown page by page with their pictures – for similar images always open, since
 * similar files are not the same. Enter = cancel for permanent.
 */
@Component({
  selector: 'app-dedupe-dialog',
  imports: [Modal],
  template: `
    @if (dup.dedupe(); as r) {
      <app-modal
        [heading]="t.dedupeTitle"
        [dialogRole]="r.action === 'permanent' ? 'alertdialog' : 'dialog'"
        describedBy="fnf-dedupe-summary"
        width="min(58rem, 96vw)"
        (closed)="dup.closeDedupe()"
      >
        <div class="form">
          <p id="fnf-dedupe-summary" class="message">
            <strong>{{ t.dedupeSummary(r.plan.files, r.plan.groups.length, bytes()) }}</strong>
          </p>
          @if (skipped(); as s) {
            <p class="muted" role="note">{{ s }}</p>
          }
          <fieldset class="group col">
            <legend>{{ t.action }}</legend>
            <label class="check">
              <input
                type="radio"
                name="fnf-dedupe-action"
                [checked]="r.action === 'trash'"
                (change)="setAction('trash')"
              />
              {{ t.actionTrash }}
            </label>
            <label class="check">
              <input
                type="radio"
                name="fnf-dedupe-action"
                [checked]="r.action === 'permanent'"
                (change)="setAction('permanent')"
              />
              <span [class.danger-text]="r.action === 'permanent'">{{ t.actionPermanent }}</span>
            </label>
            <label class="check">
              <input
                type="radio"
                name="fnf-dedupe-action"
                [checked]="r.action === 'move'"
                [disabled]="!r.target"
                (change)="setAction('move')"
              />
              {{ t.actionMove }}
            </label>
            <span class="muted path indent">{{
              r.target ? t.moveTarget(r.target) : t.noMoveTarget
            }}</span>
          </fieldset>
          <p class="muted" role="note">
            {{ r.mode === 'exact' ? t.verifyContent : t.verifyUnchanged }}
          </p>
          <section class="groups" [attr.aria-label]="t.groupsTitle">
            <div class="pager">
              <strong>{{ t.groupsTitle }}</strong>
              <span class="muted">{{ pageText() }}</span>
              <span class="grow"></span>
              <button type="button" class="btn small" [disabled]="r.page === 0" (click)="page(-1)">
                {{ t.previous }}
              </button>
              <button
                type="button"
                class="btn small"
                [disabled]="(r.page + 1) * pageSize >= r.plan.groups.length"
                (click)="page(1)"
              >
                {{ t.next }}
              </button>
            </div>
            <ol class="list" [attr.start]="r.page * pageSize + 1">
              @for (g of shown(); track g.keep.path) {
                <li class="grp">
                  <div class="tiles">
                    <figure class="tile stays">
                      <div class="pic">
                        @if (thumb(g.keep.path); as url) {
                          <img [src]="url" alt="" />
                        } @else {
                          <i class="fa fa-file-o" aria-hidden="true"></i>
                        }
                      </div>
                      <figcaption>
                        <strong
                          ><i class="fa fa-check" aria-hidden="true"></i> {{ t.stays }}</strong
                        >
                        <span class="path" [attr.title]="g.keep.path">{{ g.keep.name }}</span>
                      </figcaption>
                    </figure>
                    @for (c of g.remove; track c.path) {
                      <figure class="tile goes">
                        <div class="pic">
                          @if (thumb(c.path); as url) {
                            <img [src]="url" alt="" />
                          } @else {
                            <i class="fa fa-file-o" aria-hidden="true"></i>
                          }
                        </div>
                        <figcaption>
                          <strong
                            ><i class="fa fa-trash-o" aria-hidden="true"></i> {{ t.goes }}</strong
                          >
                          <span class="path" [attr.title]="c.path">{{ c.name }}</span>
                        </figcaption>
                      </figure>
                    }
                  </div>
                </li>
              }
            </ol>
          </section>
          @if (r.error) {
            <p class="error" role="alert">{{ r.error }}</p>
          }
          <div class="buttons">
            <button
              type="button"
              class="btn"
              [attr.data-autofocus]="r.action === 'permanent' ? '' : null"
              (click)="dup.closeDedupe()"
            >
              {{ t.cancel }}
            </button>
            <button
              type="button"
              class="btn"
              [class.primary]="r.action !== 'permanent'"
              [class.danger]="r.action === 'permanent'"
              [attr.data-autofocus]="r.action === 'permanent' ? null : ''"
              [disabled]="r.busy || (r.action === 'move' && !r.target)"
              (click)="dup.runDedupe()"
            >
              {{ confirmLabel() }}
            </button>
          </div>
        </div>
      </app-modal>
    }
  `,
  styleUrls: ['../ops/ops-dialog.css'],
  styles: `
    .col {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }
    .indent {
      padding-left: 1.6rem;
    }
    .groups {
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-sm);
      max-height: 22rem;
      overflow: auto;
    }
    .pager {
      position: sticky;
      top: 0;
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-1) var(--spacing-2);
      background: var(--color-surface);
      border-bottom: var(--border-width) solid var(--color-border);
    }
    .grow {
      flex: 1;
    }
    .btn.small {
      min-height: 0;
      min-width: 0;
      padding: 0 var(--spacing-2);
      line-height: inherit;
    }
    .list {
      margin: 0;
      padding: var(--spacing-2) var(--spacing-2) var(--spacing-2) 2.2rem;
    }
    .grp + .grp {
      margin-top: var(--spacing-2);
    }
    .tiles {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-2);
    }
    .tile {
      margin: 0;
      width: 9rem;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .pic {
      height: 6rem;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-surface);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .pic img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .pic .fa {
      font-size: 2rem;
      color: var(--color-muted);
    }
    .goes .pic {
      border-style: dashed;
    }
    .goes strong {
      color: var(--color-danger);
    }
    figcaption {
      display: flex;
      flex-direction: column;
      font-size: var(--font-size-sm);
      min-width: 0;
    }
    figcaption .path {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DedupeDialog {
  protected readonly t = DUP_TEXTS;
  protected readonly dup = inject(DuplicatesStore);
  protected readonly pageSize = DEDUPE_PAGE;

  protected readonly shown = computed<
    readonly { readonly keep: SearchHit; readonly remove: readonly SearchHit[] }[]
  >(() => {
    const r = this.dup.dedupe();
    return r ? r.plan.rows.slice(r.page * DEDUPE_PAGE, (r.page + 1) * DEDUPE_PAGE) : [];
  });
  protected readonly bytes = computed(() => formatSize(this.dup.dedupe()?.plan.bytes ?? 0));
  protected readonly skipped = computed(() => {
    const r = this.dup.dedupe();
    return r ? DUP_TEXTS.dedupeSkipped(r.undecided, r.plan.withoutKeep.length) : '';
  });
  protected readonly pageText = computed(() => {
    const r = this.dup.dedupe();
    if (!r) {
      return '';
    }
    const n = r.plan.groups.length;
    return DUP_TEXTS.groupPage(
      r.page * DEDUPE_PAGE + 1,
      Math.min(n, (r.page + 1) * DEDUPE_PAGE),
      n,
    );
  });
  protected readonly confirmLabel = computed(() => {
    const r = this.dup.dedupe();
    if (!r) {
      return '';
    }
    if (r.action === 'permanent' && r.confirmStep) {
      return DUP_TEXTS.confirmPermanent;
    }
    return r.action === 'move'
      ? DUP_TEXTS.confirmMove(r.plan.files)
      : DUP_TEXTS.confirm(r.plan.files);
  });

  constructor() {
    // pictures of the groups on this page
    effect(() => {
      const groups = this.shown();
      untracked(() =>
        this.dup.wantThumbs(groups.flatMap((g) => [g.keep.path, ...g.remove.map((r) => r.path)])),
      );
    });
  }

  protected thumb(path: string): string | null {
    return this.dup.thumbs().get(path) ?? null;
  }

  protected setAction(action: DedupeAction): void {
    this.dup.updateDedupe({ action });
  }

  protected page(delta: number): void {
    const r = this.dup.dedupe();
    if (r) {
      this.dup.updateDedupe({ page: Math.max(0, r.page + delta) });
    }
  }
}
