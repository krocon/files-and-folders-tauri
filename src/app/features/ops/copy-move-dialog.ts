import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FsError } from '../../core/fs/fs.models';
import { ConflictDefault } from '../../core/jobs/jobs.models';
import { Modal } from '../../shared/dialog/modal';
import { formatSize } from '../../shared/format';
import { dialogError, sameNames } from './ops-logic';
import { OPS_TEXTS } from './ops-texts';
import { liveCount } from './live-count';
import { OpsStore, TransferKind } from './ops.store';
import { TargetField } from './target-field';

const DEFAULTS: readonly ConflictDefault[] = [
  'ask',
  'overwrite',
  'skip',
  'overwriteIfNewer',
  'rename',
];

/**
 * F5 / F6 (design 006 E4): source with a live count, target folder (text +
 * suggestions), name in the target for a single source, conflict default,
 * background. Enter or Ctrl/⌘+Enter starts, Esc cancels.
 */
@Component({
  selector: 'app-copy-move-dialog',
  imports: [Modal, TargetField],
  template: `
    @if (req(); as r) {
      <app-modal [heading]="heading(r.kind)" width="min(60rem, 94vw)" (closed)="ops.close()">
        <form class="form" (submit)="submit($event)" (keydown)="onKeydown($event)">
          <p class="source">
            <strong>{{
              r.sources.length === 1 ? r.sources[0].name : t.entries(r.sources.length)
            }}</strong>
            <span class="count" aria-live="polite">{{ countText() }}</span>
          </p>
          <app-target-field
            [label]="t.to"
            [suggestionsLabel]="t.suggestions"
            [value]="target()"
            [targets]="r.targets"
            [autofocus]="true"
            [invalid]="!!error()"
            describedBy="fnf-copy-error"
            (valueChange)="target.set($event); error.set(null)"
          />
          @if (r.sources.length === 1) {
            <label class="field">
              <span>{{ r.kind === 'link' ? t.linkName : t.newName }}</span>
              <input
                type="text"
                spellcheck="false"
                autocomplete="off"
                [value]="name()"
                (input)="name.set($any($event.target).value); error.set(null)"
              />
            </label>
          }
          @if (r.kind === 'link') {
            <!-- links (design 031 E8): never replace a name, absolute unless asked -->
            <label class="field">
              <span>{{ t.ifLinkExists }}</span>
              <select (change)="keepBoth.set($any($event.target).value === 'keepBoth')">
                <option value="fail" [selected]="!keepBoth()">{{ t.linkExists.fail }}</option>
                <option value="keepBoth" [selected]="keepBoth()">
                  {{ t.linkExists.keepBoth }}
                </option>
              </select>
            </label>
            <label class="check">
              <input type="checkbox" [checked]="relative()" (change)="relative.set(!relative())" />
              {{ t.relative }}
            </label>
          } @else {
            <label class="field">
              <span>{{ t.ifExists }}</span>
              <select (change)="conflictDefault.set($any($event.target).value)">
                @for (d of defaults; track d) {
                  <option [value]="d" [selected]="d === conflictDefault()">
                    {{ t.conflictDefaults[d] }}
                  </option>
                }
              </select>
            </label>
            <label class="check">
              <input
                type="checkbox"
                [checked]="background()"
                (change)="background.set(!background())"
              />
              {{ t.background }}
            </label>
          }
          @if (sameNames().length > 0) {
            <div class="danger-box same-names" role="note">
              <p>{{ t.sameNames(sameNames()) }}</p>
              @if (conflictDefault() === 'overwrite' || conflictDefault() === 'overwriteIfNewer') {
                <p>
                  <strong>{{ t.sameNamesOverwrite }}</strong>
                </p>
              }
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
          <p id="fnf-copy-error" class="error" role="alert">
            @if (error(); as e) {
              {{ errorText(e) }}
            }
          </p>

          <div class="buttons">
            <div class="help">{{ t.ctrlEnter }}</div>
            <div class="spacer"></div>

            <button type="button" class="btn" (click)="ops.close()">{{ t.cancel }}</button>
            <button
              type="submit"
              class="btn primary"
              [disabled]="busy() || (r.dangers.length > 0 && !allowDangerous())"
            >
              {{ r.kind === 'link' ? t.linkConfirm : heading(r.kind) }}
            </button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrl: './ops-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyMoveDialog {
  protected readonly t = OPS_TEXTS;
  protected readonly defaults = DEFAULTS;
  protected readonly ops = inject(OpsStore);
  protected readonly req = this.ops.copyMove;

  protected readonly target = signal(this.req()?.target ?? '');
  protected readonly name = signal(
    this.req()?.sources.length === 1 ? this.req()!.sources[0].name : '',
  );
  protected readonly conflictDefault = signal<ConflictDefault>('ask');
  protected readonly background = signal(false);
  protected readonly allowDangerous = signal(false);
  /** Link mode (design 031 E8). */
  protected readonly relative = signal(false);
  protected readonly keepBoth = signal(false);
  protected readonly error = signal<FsError | null>(null);
  protected readonly busy = signal(false);
  /** Equal names from different folders (search results) collide in the target. */
  protected readonly sameNames = computed(() => sameNames(this.req()?.sources ?? []));

  /** The live count runs as a helper job; it is cancelled when the dialog closes. Links: none. */
  private readonly count = liveCount(
    this.req()?.kind === 'link' ? null : (this.req()?.sources.map((e) => e.path) ?? null),
  );
  protected readonly countText = computed(() => {
    const c = this.count();
    if (!c) {
      return '';
    }
    if (c.state === 'done') {
      const size = c.size;
      return (
        ' · ' +
        this.t.counted(size.files, size.dirs, formatSize(size.bytes)) +
        (size.unreadable > 0 ? this.t.unreadable(size.unreadable) : '')
      );
    }
    return c.items > 0
      ? ` · ${c.items} … ${formatSize(c.bytes)} (${this.t.counting})`
      : ` · ${this.t.counting}`;
  });

  protected heading(kind: TransferKind): string {
    return kind === 'copy' ? this.t.copy : kind === 'move' ? this.t.move : this.t.link;
  }

  protected errorText(e: FsError): string {
    return dialogError(e);
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) {
      evt.preventDefault();
      void this.start();
    }
  }

  protected submit(evt: Event): void {
    evt.preventDefault();
    void this.start();
  }

  private async start(): Promise<void> {
    const req = this.req();
    if (!req || this.busy() || (req.dangers.length > 0 && !this.allowDangerous())) {
      return;
    }
    this.busy.set(true);
    try {
      const error = await this.ops.runCopyMove(req, {
        target: this.target(),
        name: req.sources.length === 1 ? this.name() : null,
        conflictDefault: this.conflictDefault(),
        background: this.background(),
        allowDangerous: this.allowDangerous(),
        relative: this.relative(),
        keepBoth: this.keepBoth(),
      });
      this.error.set(error);
    } finally {
      this.busy.set(false);
    }
  }
}
