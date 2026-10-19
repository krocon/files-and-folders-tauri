import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Modal } from '../../shared/dialog/modal';
import { NameMode } from '../../core/search/search.models';
import {
  DateMode,
  FindForm,
  FormField,
  Preset,
  PRESETS_BUILT_IN,
  presetGlob,
  SizeUnit,
} from './find-form';
import { FindStore } from './find.store';
import { SEARCH_TEXTS } from './search-texts';
import { SearchStore } from './search.store';

const MODES: readonly NameMode[] = ['glob', 'regex', 'text'];
const UNITS: readonly SizeUnit[] = ['B', 'KB', 'MB', 'GB'];
const ERR = 'fnf-find-error';

/** Find dialog (OPEN_FIND_DLG, Alt+F7, design 009 E5). Enter = find, Esc = cancel. */
@Component({
  selector: 'app-find-dialog',
  imports: [Modal],
  template: `
    @if (find.request(); as req) {
      <app-modal [heading]="t.title" width="min(48rem, 94vw)" (closed)="find.close()">
        <form class="tool" (submit)="$event.preventDefault(); find.run()">
          <fieldset class="row group">
            <legend>{{ t.searchIn }}</legend>
            <label class="check">
              <input
                type="radio"
                name="fnf-find-where"
                [checked]="find.where() === 'folder'"
                (change)="find.where.set('folder')"
              />
              <span class="path">{{
                req.folder.length === 1 ? req.folder[0] : t.inRoots(req.folder)
              }}</span>
            </label>
            @if (req.marked.length > 0) {
              <label class="check">
                <input
                  type="radio"
                  name="fnf-find-where"
                  [checked]="find.where() === 'marked'"
                  (change)="find.where.set('marked')"
                />
                {{ t.markedFolders(req.marked.length) }}
              </label>
            }
          </fieldset>

          <div class="row">
            <label class="field grow">
              <span>{{ t.name }}</span>
              <input
                type="text"
                data-autofocus
                spellcheck="false"
                autocomplete="off"
                [placeholder]="t.namePlaceholder"
                [value]="f().name"
                [attr.aria-invalid]="invalid('name')"
                [attr.aria-describedby]="invalid('name') ? errId : null"
                (input)="set({ name: text($event) })"
              />
            </label>
            <label class="field">
              <span>{{ t.mode }}</span>
              <select (change)="setMode(text($event))">
                @for (m of modes; track m) {
                  <option [value]="m" [selected]="m === f().nameMode">{{ t.modes[m] }}</option>
                }
              </select>
            </label>
            <label class="field">
              <span>{{ t.template }}</span>
              <select (change)="applyTemplate($event)">
                <option value="">{{ t.templateNone }}</option>
                <optgroup [attr.label]="t.template">
                  @for (p of presets; track p.label; let i = $index) {
                    <option [value]="'p' + i">{{ p.label }}</option>
                  }
                </optgroup>
                @if (search.templates().length > 0) {
                  <optgroup [label]="t.own">
                    @for (p of search.templates(); track p.label; let i = $index) {
                      <option [value]="'t' + i">{{ p.label }}</option>
                    }
                  </optgroup>
                }
                @if (search.recent().length > 0) {
                  <optgroup [attr.label]="t.recent">
                    @for (r of search.recent(); track $index; let i = $index) {
                      <option [value]="'r' + i">
                        {{ r.name || '*' }}{{ r.content ? ' ∋ ' + r.content : '' }}
                      </option>
                    }
                  </optgroup>
                }
              </select>
            </label>
          </div>
          <div class="row options">
            <label class="check">
              <input
                type="checkbox"
                [checked]="f().caseSensitive"
                (change)="set({ caseSensitive: checked($event) })"
              />
              {{ t.caseSensitive }}
            </label>
            <label class="check">
              <input
                type="checkbox"
                [checked]="f().wholeName"
                (change)="set({ wholeName: checked($event) })"
              />
              {{ t.wholeName }}
            </label>
          </div>

          <fieldset class="row options group" [attr.aria-invalid]="invalid('kinds')">
            <legend>{{ t.kinds }}</legend>
            <label class="check">
              <input
                type="checkbox"
                [checked]="f().files"
                (change)="set({ files: checked($event) })"
              />
              {{ t.files }}
            </label>
            <label class="check">
              <input
                type="checkbox"
                [checked]="f().dirs"
                (change)="set({ dirs: checked($event) })"
              />
              {{ t.folders }}
            </label>
            <label class="check">
              <input
                type="checkbox"
                [checked]="f().links"
                (change)="set({ links: checked($event) })"
              />
              {{ t.links }}
            </label>
          </fieldset>

          <div class="row">
            <span class="label">{{ t.size }}</span>
            <label class="inline">
              {{ t.min }}
              <input
                class="num"
                type="text"
                inputmode="decimal"
                [value]="f().minSize"
                [attr.aria-invalid]="invalid('minSize')"
                (input)="set({ minSize: text($event) })"
              />
            </label>
            <select [attr.aria-label]="t.min" (change)="set({ minUnit: $any(text($event)) })">
              @for (u of units; track u) {
                <option [value]="u" [selected]="u === f().minUnit">{{ u }}</option>
              }
            </select>
            <label class="inline">
              {{ t.max }}
              <input
                class="num"
                type="text"
                inputmode="decimal"
                [value]="f().maxSize"
                [attr.aria-invalid]="invalid('maxSize')"
                (input)="set({ maxSize: text($event) })"
              />
            </label>
            <select [attr.aria-label]="t.max" (change)="set({ maxUnit: $any(text($event)) })">
              @for (u of units; track u) {
                <option [value]="u" [selected]="u === f().maxUnit">{{ u }}</option>
              }
            </select>
          </div>

          <fieldset class="row group">
            <legend>{{ t.modified }}</legend>
            <label class="check">
              <input
                type="radio"
                name="fnf-find-date"
                [checked]="f().dateMode === 'any'"
                (change)="setDate('any')"
              />
              {{ t.anyTime }}
            </label>
            <label class="check">
              <input
                type="radio"
                name="fnf-find-date"
                [checked]="f().dateMode === 'days'"
                (change)="setDate('days')"
              />
              {{ t.lastDays }}
              <input
                class="num small"
                type="text"
                inputmode="numeric"
                [attr.aria-label]="t.days"
                [value]="f().days"
                [disabled]="f().dateMode !== 'days'"
                [attr.aria-invalid]="invalid('days')"
                (input)="set({ days: text($event) })"
              />
              {{ t.days }}
            </label>
            <label class="check">
              <input
                type="radio"
                name="fnf-find-date"
                [checked]="f().dateMode === 'range'"
                (change)="setDate('range')"
              />
              {{ t.between }}
            </label>
            <input
              type="date"
              [attr.aria-label]="t.between"
              [value]="f().from"
              [disabled]="f().dateMode !== 'range'"
              [attr.aria-invalid]="invalid('from')"
              (input)="set({ from: text($event) })"
            />
            <span>{{ t.and }}</span>
            <input
              type="date"
              [attr.aria-label]="t.and"
              [value]="f().to"
              [disabled]="f().dateMode !== 'range'"
              [attr.aria-invalid]="invalid('to')"
              (input)="set({ to: text($event) })"
            />
          </fieldset>

          <div class="row">
            <label class="field grow">
              <span>{{ t.content }}</span>
              <input
                type="text"
                spellcheck="false"
                autocomplete="off"
                [placeholder]="t.contentPlaceholder"
                [value]="f().content"
                (input)="set({ content: text($event) })"
              />
            </label>
            <label class="check">
              <input
                type="checkbox"
                [checked]="f().contentCase"
                (change)="set({ contentCase: checked($event) })"
              />
              {{ t.caseSensitive }}
            </label>
            <label class="field num">
              <span>{{ t.maxFileSize }}</span>
              <input
                type="text"
                inputmode="decimal"
                [value]="f().maxFileSizeMb"
                [attr.aria-invalid]="invalid('maxFileSizeMb')"
                (input)="set({ maxFileSizeMb: text($event) })"
              />
            </label>
          </div>

          <div class="row options">
            <label class="check">
              <input
                type="checkbox"
                [checked]="f().includeHidden"
                (change)="set({ includeHidden: checked($event) })"
              />
              {{ t.hidden }}
            </label>
            <label class="check">
              <input
                type="checkbox"
                [checked]="f().followLinks"
                (change)="set({ followLinks: checked($event) })"
              />
              {{ t.followLinks }}
            </label>
            <label class="field num">
              <span>{{ t.depth }}</span>
              <input
                type="text"
                inputmode="numeric"
                [placeholder]="t.depthPlaceholder"
                [value]="f().maxDepth"
                [attr.aria-invalid]="invalid('maxDepth')"
                (input)="set({ maxDepth: text($event) })"
              />
            </label>
            <label class="field grow">
              <span>{{ t.excludes }}</span>
              <input
                type="text"
                spellcheck="false"
                [value]="f().excludes"
                (input)="set({ excludes: text($event) })"
              />
            </label>
            <label class="field num">
              <span>{{ t.maxHits }}</span>
              <input
                type="text"
                inputmode="numeric"
                [value]="f().maxHits"
                [attr.aria-invalid]="invalid('maxHits')"
                (input)="set({ maxHits: text($event) })"
              />
            </label>
          </div>

          <div class="foot">
            <p class="error" role="alert" [id]="errId">{{ find.error()?.message ?? '' }}</p>
            <label class="check">
              <input
                type="checkbox"
                [checked]="find.newTab()"
                [disabled]="!req.reuse"
                (change)="find.newTab.set(checked($event))"
              />
              {{ t.newTab }}
            </label>
            <div class="buttons">
              @if (naming()) {
                <input
                  type="text"
                  class="template-name"
                  [attr.aria-label]="t.templateName"
                  [placeholder]="t.templateName"
                  (keydown.enter)="$event.preventDefault(); saveTemplate(text($event))"
                  (keydown.escape)="$event.stopPropagation(); naming.set(false)"
                />
              } @else {
                <button type="button" class="btn" (click)="naming.set(true)">
                  {{ t.saveTemplate }}
                </button>
              }
              <button type="button" class="btn" (click)="find.close()">{{ t.cancel }}</button>
              <button type="submit" class="btn primary" [disabled]="find.busy()">
                {{ t.find }}
              </button>
            </div>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrls: ['../../shared/dialog/tool-dialog.css', './find-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FindDialog {
  protected readonly t = SEARCH_TEXTS;
  protected readonly find = inject(FindStore);
  protected readonly search = inject(SearchStore);
  protected readonly f = this.find.form;
  protected readonly modes = MODES;
  protected readonly units = UNITS;
  protected readonly presets: readonly Preset[] = PRESETS_BUILT_IN;
  protected readonly errId = ERR;
  protected readonly naming = signal(false);
  private readonly errorField = computed(() => this.find.error()?.field ?? null);

  protected invalid(field: FormField): 'true' | null {
    return this.errorField() === field ? 'true' : null;
  }

  protected set(patch: Partial<FindForm>): void {
    this.find.update(patch);
  }

  /** Glob matches the whole name by default, regex and text a part (design 009 E3). */
  protected setMode(mode: string): void {
    this.set({ nameMode: mode as NameMode, wholeName: mode === 'glob' });
  }

  protected setDate(mode: DateMode): void {
    this.set({ dateMode: mode });
  }

  protected applyTemplate(evt: Event): void {
    const select = evt.target as HTMLSelectElement;
    const v = select.value;
    const i = Number(v.slice(1));
    if (v.startsWith('p')) {
      this.set({ name: presetGlob(this.presets[i]), nameMode: 'glob', wholeName: true });
    } else if (v.startsWith('t')) {
      const tpl = this.search.templates()[i];
      if (tpl) {
        this.find.apply(tpl.form);
      }
    } else if (v.startsWith('r')) {
      const r = this.search.recent()[i];
      if (r) {
        this.find.apply(r);
      }
    }
    select.value = '';
  }

  protected saveTemplate(label: string): void {
    this.find.saveTemplate(label);
    this.naming.set(false);
  }

  protected text(evt: Event): string {
    return (evt.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected checked(evt: Event): boolean {
    return (evt.target as HTMLInputElement).checked;
  }
}
