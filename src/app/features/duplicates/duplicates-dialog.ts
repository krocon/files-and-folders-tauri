import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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
      <app-modal [heading]="t.title" width="min(40rem, 94vw)" (closed)="dup.close()">
        <form class="tool" (submit)="$event.preventDefault(); dup.run()">
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
          <fieldset class="group col">
            <legend>{{ t.compare }}</legend>
            <label class="check">
              <input
                type="radio"
                name="fnf-dup-compare"
                data-autofocus
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
          </fieldset>
          <div class="row">
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
  styleUrls: ['../../shared/dialog/tool-dialog.scss', '../search/find-dialog.scss'],
  styles: [
    `
      .col {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-1);
      }
      .col legend {
        float: none;
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
  protected readonly errId = ERR;

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
