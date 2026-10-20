import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { describeFsError } from '../../core/fs/fs-error';
import { Modal } from '../../shared/dialog/modal';
import {
  applyOctal,
  AttrForm,
  FlagName,
  octalOf,
  rwxBit,
  setsSpecialBit,
  setTime,
  SPECIAL,
  SPECIAL_BIT,
  TimeName,
  toggleBit,
  toggleFlag,
  Tri,
  WHAT,
  WHO,
} from './attributes-logic';
import { AT_TEXTS } from './attributes-texts';
import { AttributesStore } from './attributes.store';
import type { ApplyTo } from '../../core/attributes/attributes.models';

/**
 * Change attributes (design 024 §3): permissions (Unix), attributes (Windows,
 * macOS "hidden"), times, recursion. Tri-state checkboxes (`indeterminate` =
 * the entries differ, stays as it is). Strg/⌘+Enter = Change.
 */
@Component({
  selector: 'app-attributes-dialog',
  imports: [Modal],
  template: `
    @if (s.request(); as req) {
      @if (s.form(); as f) {
        <app-modal [heading]="heading()" width="min(40rem, 94vw)" (closed)="s.close()">
          <div class="attrs">
            @if (s.loading()) {
              <p class="help" aria-live="polite">{{ t.loading }}</p>
            }
            @if (fields().mode) {
              <fieldset>
                <legend>{{ t.permissions }}</legend>
                <table class="perm">
                  <thead>
                    <tr>
                      <td></td>
                      @for (w of what; track w) {
                        <th scope="col">{{ t.what[w] }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (who of whoList; track who; let first = $first) {
                      <tr>
                        <th scope="row">{{ t.who[who] }}</th>
                        @for (w of what; track w; let firstCol = $first) {
                          <td>
                            <input
                              type="checkbox"
                              [attr.data-autofocus]="first && firstCol ? '' : null"
                              [attr.aria-label]="t.bitLabel(t.who[who], t.what[w])"
                              [checked]="f.bits[bit(who, w)].value === 'on'"
                              [indeterminate]="f.bits[bit(who, w)].value === 'mixed'"
                              (change)="onBit($event, bit(who, w))"
                            />
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
                <div class="row">
                  @for (sp of special; track sp) {
                    <label class="check">
                      <input
                        type="checkbox"
                        [checked]="f.bits[specialBit[sp]].value === 'on'"
                        [indeterminate]="f.bits[specialBit[sp]].value === 'mixed'"
                        (change)="onBit($event, specialBit[sp])"
                      />
                      {{ t.special[sp] }}
                    </label>
                  }
                </div>
                @if (warnSpecial()) {
                  <p class="warn" role="note">
                    <i class="fa fa-exclamation-triangle" aria-hidden="true"></i>
                    {{ t.specialWarning }}
                  </p>
                }
                <label class="inline">
                  <span>{{ t.octal }}</span>
                  <input
                    class="octal mono"
                    type="text"
                    inputmode="numeric"
                    maxlength="4"
                    spellcheck="false"
                    autocomplete="off"
                    aria-describedby="fnf-at-octal-hint"
                    [attr.aria-invalid]="octalInvalid() ? 'true' : null"
                    [value]="octalText()"
                    (input)="onOctal($event)"
                    (blur)="octalDraft.set(null)"
                  />
                  <span id="fnf-at-octal-hint" class="help">
                    {{ octalInvalid() ? t.octalInvalid : t.octalHint }}
                  </span>
                </label>
              </fieldset>
            }
            @if (fields().flags.length > 0) {
              <fieldset>
                <legend>{{ t.attributes }}</legend>
                <div class="row">
                  @for (name of fields().flags; track name; let first = $first) {
                    <label class="check">
                      <input
                        type="checkbox"
                        [attr.data-autofocus]="first && !fields().mode ? '' : null"
                        [checked]="f.flags[name].value === 'on'"
                        [indeterminate]="f.flags[name].value === 'mixed'"
                        (change)="onFlag($event, name)"
                      />
                      {{ t.flags[name] }}
                    </label>
                  }
                </div>
              </fieldset>
            }
            <fieldset>
              <legend>{{ t.times }}</legend>
              @for (name of fields().times; track name) {
                <div class="time" role="group" [attr.aria-label]="t.time[name]">
                  <label class="check name">
                    <input
                      type="checkbox"
                      [checked]="f.times[name].enabled"
                      [attr.aria-label]="t.change(t.time[name])"
                      (change)="time(name, { enabled: checked($event) })"
                    />
                    {{ t.time[name] }}
                  </label>
                  <label class="check">
                    <input
                      type="checkbox"
                      [disabled]="!f.times[name].enabled"
                      [checked]="f.times[name].now"
                      (change)="time(name, { now: checked($event) })"
                    />
                    {{ t.now }}
                  </label>
                  <input
                    type="datetime-local"
                    step="1"
                    [attr.aria-label]="t.time[name] + ': ' + t.at"
                    [attr.aria-invalid]="s.invalidTimes().includes(name) ? 'true' : null"
                    [disabled]="!f.times[name].enabled || f.times[name].now"
                    [value]="f.times[name].value"
                    (input)="time(name, { value: text($event) })"
                  />
                </div>
              }
            </fieldset>
            <div class="row options">
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="f.recursive"
                  (change)="setOption({ recursive: checked($event) })"
                />
                {{ t.recursive }}
              </label>
              @if (f.recursive) {
                <label class="inline">
                  <span>{{ t.applyTo }}</span>
                  <select (change)="setOption({ applyTo: applyTo($event) })">
                    @for (a of applyToList; track a) {
                      <option [value]="a" [selected]="a === f.applyTo">
                        {{ t.applyToOptions[a] }}
                      </option>
                    }
                  </select>
                </label>
              }
            </div>
            @if (hasMixed()) {
              <p class="help">{{ t.mixedHint }}</p>
            }
            <div class="foot">
              <p class="summary" aria-live="polite">
                {{ summary() }}
                @if (s.links() > 0) {
                  · {{ t.links(s.links()) }}
                }
              </p>
              <p class="error" role="alert">{{ errorText() }}</p>
              <div class="buttons">
                <button type="button" class="btn" (click)="s.close()">{{ t.cancel }}</button>
                <button
                  type="button"
                  class="btn primary"
                  [disabled]="!s.canRun()"
                  aria-keyshortcuts="Control+Enter Meta+Enter"
                  (click)="s.run()"
                >
                  {{ t.run }}
                </button>
              </div>
            </div>
          </div>
        </app-modal>
      }
    }
  `,
  styles: `
    .attrs {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
    }
    fieldset {
      margin: 0;
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border);
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }
    legend {
      padding: 0 var(--spacing-1);
      font-weight: 600;
    }
    .perm {
      border-collapse: collapse;
      th,
      td {
        padding: 2px var(--spacing-2);
        text-align: center;
      }
      th[scope='row'] {
        text-align: start;
        font-weight: normal;
      }
      th[scope='col'] {
        font-weight: normal;
        color: var(--color-muted);
      }
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-3);
    }
    .check,
    .inline {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
      white-space: nowrap;
    }
    .octal {
      width: 5rem;
      font-family: var(--font-mono);
    }
    .time {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-3);
      .name {
        min-width: 7rem;
      }
    }
    .help,
    .warn,
    .summary,
    .error {
      margin: 0;
    }
    .help {
      color: var(--color-muted);
    }
    .warn {
      color: var(--color-danger-text);
      background: var(--color-danger-bg);
      padding: var(--spacing-1) var(--spacing-2);
      border-radius: 4px;
    }
    .error {
      min-height: 1em;
      color: var(--color-danger);
    }
    .buttons {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-2);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
})
export class AttributesDialog {
  protected readonly s = inject(AttributesStore);
  protected readonly t = AT_TEXTS;
  protected readonly whoList = WHO;
  protected readonly what = WHAT;
  protected readonly special = SPECIAL;
  protected readonly specialBit = SPECIAL_BIT;
  protected readonly applyToList: readonly ApplyTo[] = ['all', 'files', 'dirs'];
  protected readonly fields = this.s.fields;
  /** What the user is typing into the octal field (`null` = show the mode). */
  protected readonly octalDraft = signal<string | null>(null);

  protected readonly heading = computed(() => {
    const entries = this.s.request()?.entries ?? [];
    return this.t.title(entries.length, entries[0]?.name ?? '');
  });
  protected readonly octalText = computed(() => {
    const f = this.s.form();
    return this.octalDraft() ?? (f ? octalOf(f) : '');
  });
  protected readonly octalInvalid = computed(() => {
    const d = this.octalDraft();
    const f = this.s.form();
    return d !== null && d !== '' && !!f && applyOctal(f, d) === null;
  });
  protected readonly warnSpecial = computed(() => {
    const f = this.s.form();
    return !!f && setsSpecialBit(f);
  });
  protected readonly hasMixed = computed(() => {
    const f = this.s.form();
    if (!f || this.s.loading()) {
      return false;
    }
    const fl = this.fields();
    const mixed = (v: Tri) => v === 'mixed';
    return (
      (fl.mode && Object.values(f.bits).some((b) => mixed(b.value))) ||
      fl.flags.some((n) => mixed(f.flags[n].value))
    );
  });
  protected readonly summary = computed(() => {
    const n = this.s.request()?.entries.length ?? 0;
    const c = this.s.changeCount();
    return c === 0 ? this.t.nothing : this.t.summary(n, c, this.s.form()?.recursive ?? false);
  });
  protected readonly errorText = computed(() => {
    const e = this.s.runError();
    if (e) {
      return describeFsError(e);
    }
    return this.s.invalidTimes().length > 0 ? this.t.timeInvalid : '';
  });

  protected bit(who: (typeof WHO)[number], what: (typeof WHAT)[number]): number {
    return rwxBit(who, what);
  }

  protected text(evt: Event): string {
    return (evt.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected checked(evt: Event): boolean {
    return (evt.target as HTMLInputElement).checked;
  }

  protected applyTo(evt: Event): ApplyTo {
    return this.text(evt) as ApplyTo;
  }

  protected setOption(patch: Partial<Pick<AttrForm, 'recursive' | 'applyTo'>>): void {
    this.s.update((f) => ({ ...f, ...patch }));
  }

  protected time(name: TimeName, patch: { enabled?: boolean; now?: boolean; value?: string }) {
    this.s.update((f) => setTime(f, name, patch));
  }

  /** The native toggle is replaced by the tri-state cycle; the element follows it. */
  private sync(evt: Event, value: Tri | undefined): void {
    const el = evt.target as HTMLInputElement;
    el.checked = value === 'on';
    el.indeterminate = value === 'mixed';
  }

  protected onBit(evt: Event, bit: number): void {
    this.octalDraft.set(null);
    this.s.update((f) => toggleBit(f, bit));
    this.sync(evt, this.s.form()?.bits[bit].value);
  }

  protected onFlag(evt: Event, name: FlagName): void {
    this.s.update((f) => toggleFlag(f, name));
    this.sync(evt, this.s.form()?.flags[name].value);
  }

  protected onOctal(evt: Event): void {
    const value = this.text(evt);
    this.octalDraft.set(value);
    const f = this.s.form();
    const next = f ? applyOctal(f, value) : null;
    if (next) {
      this.s.update(() => next);
    }
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) {
      evt.preventDefault();
      evt.stopPropagation();
      void this.s.run();
    }
  }
}
