import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MAX_DUP_THRESHOLD } from '../../core/search/search.models';
import { Modal } from '../../shared/dialog/modal';
import { DupField, DuplicatesForm, DupUnit } from './duplicates-form';
import { DUP_TEXTS } from './duplicates-texts';
import { DuplicatesStore } from './duplicates.store';

const UNITS: readonly DupUnit[] = ['B', 'KB', 'MB'];
const ERR = 'fnf-dup-error';

/** Find duplicates (OPEN_FIND_DUPLICATES_DLG, Alt+Shift+F7, design 016 E6). Enter = find, Esc = cancel. */
@Component({
  selector: 'app-duplicates-dialog',
  imports: [Modal],
  template: `
    @if (dup.request(); as req) {
      <app-modal [heading]="t.title" width="min(56rem, 96vw)" (closed)="dup.close()">
        <form class="tool" (submit)="$event.preventDefault(); dup.run()">
          <div class="scroll">
            <fieldset class="row group">
              <legend>{{ t.searchIn }}</legend>
              <label class="check">
                <input
                  type="radio"
                  name="fnf-dup-where"
                  [checked]="dup.where() === 'folder'"
                  (change)="dup.where.set('folder')"
                />
                <span class="path">{{
                  req.folder.length === 1 ? req.folder[0] : t.folders(req.folder.length)
                }}</span>
              </label>
              @if (req.marked.length > 0) {
                <label class="check">
                  <input
                    type="radio"
                    name="fnf-dup-where"
                    [checked]="dup.where() === 'marked'"
                    (change)="dup.where.set('marked')"
                  />
                  {{ t.markedFolders(req.marked.length) }}
                </label>
              }
            </fieldset>
            <div class="cols">
              <fieldset class="group col">
                <legend>{{ t.mode }}</legend>
                <label class="check">
                  <input
                    type="radio"
                    name="fnf-dup-mode"
                    data-autofocus
                    [checked]="f().mode === 'exact'"
                    (change)="set({ mode: 'exact' })"
                  />
                  {{ t.modeExact }}
                </label>
                <label class="check">
                  <input
                    type="radio"
                    name="fnf-dup-mode"
                    [checked]="f().mode === 'similarImages'"
                    (change)="set({ mode: 'similarImages' })"
                  />
                  {{ t.modeImages }}
                </label>
                <label class="check">
                  <input
                    type="radio"
                    name="fnf-dup-mode"
                    [checked]="f().mode === 'comics'"
                    (change)="set({ mode: 'comics' })"
                  />
                  {{ t.modeComics }}
                </label>
              </fieldset>
              @if (f().mode === 'exact') {
                <fieldset class="group col">
                  <legend>{{ t.compare }}</legend>
                  <label class="check">
                    <input
                      type="radio"
                      name="fnf-dup-compare"
                      [checked]="f().compare === 'content'"
                      (change)="set({ compare: 'content' })"
                    />
                    {{ t.compareContent }}
                  </label>
                  <label class="check">
                    <input
                      type="radio"
                      name="fnf-dup-compare"
                      [checked]="f().compare === 'size'"
                      (change)="set({ compare: 'size' })"
                    />
                    {{ t.compareSize }}
                  </label>
                  <label class="check">
                    <input
                      type="checkbox"
                      [checked]="f().sameName"
                      (change)="set({ sameName: checked($event) })"
                    />
                    {{ t.sameName }}
                  </label>
                  @if (f().compare === 'content') {
                    <label class="check">
                      <input
                        type="checkbox"
                        [checked]="f().paranoid"
                        (change)="set({ paranoid: checked($event) })"
                      />
                      {{ t.paranoid }}
                    </label>
                  }
                </fieldset>
              } @else {
                <div class="col">
                  <div class="row">
                    <label class="field grow">
                      <span>{{ t.similarity }}</span>
                      <span class="inline slider">
                        <span aria-hidden="true">{{ t.strict }}</span>
                        <input
                          type="range"
                          min="0"
                          [max]="maxThreshold"
                          step="1"
                          [value]="f().threshold"
                          [attr.aria-valuetext]="t.thresholdValue(f().threshold)"
                          (input)="set({ threshold: +text($event) })"
                        />
                        <span aria-hidden="true">{{ t.loose }}</span>
                        <span class="value">{{ f().threshold }}</span>
                      </span>
                    </label>
                  </div>
                  <p class="hint">{{ t.formats }}</p>
                </div>
              }
            </div>
            <div class="row">
              <label class="field grow">
                <span>{{ t.names }}</span>
                <input
                  type="text"
                  spellcheck="false"
                  [placeholder]="t.namesHint"
                  [value]="f().names"
                  (input)="set({ names: text($event) })"
                />
              </label>
              <label class="field">
                <span>{{ t.minSize }}</span>
                <span class="inline">
                  <input
                    type="text"
                    class="num"
                    inputmode="numeric"
                    [value]="f().minSize"
                    [attr.aria-invalid]="invalid('minSize')"
                    [attr.aria-describedby]="errId"
                    (input)="set({ minSize: text($event) })"
                  />
                  <select
                    [attr.aria-label]="t.minSize"
                    (change)="set({ minUnit: $any(text($event)) })"
                  >
                    @for (u of units; track u) {
                      <option [value]="u" [selected]="u === f().minUnit">{{ u }}</option>
                    }
                  </select>
                </span>
              </label>
              <label class="field">
                <span>{{ t.maxFiles }}</span>
                <input
                  type="text"
                  class="num"
                  inputmode="numeric"
                  [value]="f().maxFiles"
                  [attr.aria-invalid]="invalid('maxFiles')"
                  [attr.aria-describedby]="errId"
                  (input)="set({ maxFiles: text($event) })"
                />
              </label>
            </div>
            <div class="row">
              <label class="field grow">
                <span>{{ t.excludes }}</span>
                <input
                  type="text"
                  spellcheck="false"
                  [value]="f().excludes"
                  (input)="set({ excludes: text($event) })"
                />
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="f().includeHidden"
                  (change)="set({ includeHidden: checked($event) })"
                />
                {{ t.hidden }}
              </label>
              @if (rulesShown()) {
                <label class="field grow">
                  <span>{{ t.ruleSet }}</span>
                  <select
                    (change)="chooseSet($event)"
                    [attr.aria-describedby]="'fnf-dup-rules-hint'"
                  >
                    <option value="none" [selected]="setId() === 'none'">{{ t.noRules }}</option>
                    @for (id of dup.setIds(); track id) {
                      <option [value]="id" [selected]="id === setId()">
                        {{ dup.setLabel(id) }}
                      </option>
                    }
                  </select>
                </label>
              }
            </div>
            @if (rulesShown()) {
              <p class="hint" id="fnf-dup-rules-hint">{{ t.ruleSetHint }}</p>
            }
          </div>
          <p class="error" role="alert" [id]="errId">{{ dup.error()?.message ?? '' }}</p>
          <div class="buttons">
            <button type="button" class="btn" (click)="dup.close()">{{ t.cancel }}</button>
            <button type="submit" class="btn primary" [disabled]="dup.busy()">{{ t.find }}</button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrls: ['../../shared/dialog/tool-dialog.css', '../search/find-dialog.css'],
  styles: [
    `
      /* "Find" and "Equal means" side by side; one column when the window is narrow */
      .cols {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
        gap: var(--spacing-3);
        align-items: start;
      }
      /* the fields scroll, the error line and the buttons stay visible */
      .scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2);
        padding: 2px; /* room for the focus ring */
      }
      .col {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-1);
      }
      .col legend {
        float: none;
      }
      .slider {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
      }
      .slider input {
        flex: 1;
      }
      .value {
        min-width: 2ch;
        text-align: end;
      }
      .hint {
        margin: 0;
        color: var(--color-muted);
        font-size: var(--font-size-sm);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DuplicatesDialog {
  protected readonly t = DUP_TEXTS;
  protected readonly dup = inject(DuplicatesStore);
  protected readonly f = this.dup.form;
  protected readonly units = UNITS;
  /** A rule set only makes sense when the result has real duplicates (not "same size"). */
  protected readonly rulesShown = computed(
    () => this.f().compare === 'content' || this.f().mode !== 'exact',
  );
  protected readonly errId = ERR;
  protected readonly maxThreshold = MAX_DUP_THRESHOLD;
  /** The rule set applied after the search (design 042 E2, the one chosen last). */
  protected readonly setId = computed(() => this.dup.setFor(this.f().mode));

  protected chooseSet(evt: Event): void {
    const id = this.dup.parseSet(this.text(evt));
    if (id) {
      this.dup.choose(id, this.f().mode);
    }
  }

  protected invalid(field: DupField): 'true' | null {
    return this.dup.error()?.field === field ? 'true' : null;
  }

  protected set(patch: Partial<DuplicatesForm>): void {
    this.dup.update(patch);
  }

  protected text(evt: Event): string {
    return (evt.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected checked(evt: Event): boolean {
    return (evt.target as HTMLInputElement).checked;
  }
}
