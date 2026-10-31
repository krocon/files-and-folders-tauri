import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { Modal } from '../../shared/dialog/modal';
import { GridColumn, PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { fileTypeLabel } from '../config/config-texts';
import {
  AGE_UNITS,
  AgeUnit,
  COMBINE_MODES,
  CombineMode,
  CompanionCondition,
  CONDITION_JOINS,
  CONDITION_KINDS,
  ConditionJoin,
  ConditionKind,
  defaultMatcher,
  ENTRY_KINDS,
  EntryKindFilter,
  EXISTENCE_OPERATORS,
  ExistenceOperator,
  MATCHER_KINDS,
  MatcherKind,
  MatcherSpec,
  MAX_CONDITIONS,
  MAX_TEMPLATES,
  MODIFIED_OPERATORS,
  ModifiedCondition,
  ModifiedOperator,
  NAME_MODES,
  NAME_OPERATORS,
  NameCondition,
  NameOperator,
  OTHER_PANEL_COMPARES,
  OtherPanelCompare,
  OtherPanelCondition,
  SIZE_OPERATORS,
  SIZE_UNITS,
  SizeCondition,
  SizeOperator,
  SizeUnit,
  STEM_MATCH_MODES,
  StemMatchMode,
} from './select-if-engine';
import { SELECT_IF_PRESETS } from './select-if-presets';
import { SI_TEXTS } from './select-if-texts';
import { describeProblem, SelectIfGridRow, SelectIfStore } from './select-if.store';

const PREVIEW_LABEL_ID = 'fnf-si-preview-label';
const ERROR_ID = 'fnf-si-error';

function rowClass(row: SelectIfGridRow): string | null {
  return row.role === 'excluded' ? 'fnf-mr-unchanged' : null;
}

/**
 * Conditional / relationship-based selection dialog (OPEN_SELECT_IF_DLG, Mod+Alt+S, design 046 E4/E8).
 *
 * Purely in-memory evaluation over the active panel's displayed entries (and the opposite panel
 * for `otherPanel` criteria), with quick presets, user-saved templates (`selectIf.templates`),
 * remembered last rule (`dialogs.recent`), live summary and virtualised `<app-preview-grid>`.
 */
@Component({
  selector: 'app-select-if-dialog',
  imports: [Modal, PreviewGrid],
  template: `
    @if (store.request(); as req) {
      <app-modal
        [heading]="t.title"
        width="min(62rem, 96vw)"
        height="min(46rem, 92vh)"
        [fill]="true"
        (closed)="store.close()"
      >
        <form class="tool" novalidate (submit)="onSubmit($event)">
          <!-- [1] Presets & user templates -->
          <div class="template-bar">
            <label class="field grow">
              <span>{{ t.template }}</span>
              <select data-autofocus (change)="applyTemplateChoice($event)">
                <option value="">{{ t.templatePlaceholder }}</option>
                <optgroup [attr.label]="t.builtInPresets">
                  @for (p of presets; track p.id; let i = $index) {
                    <option [value]="'p:' + i">{{ t.presets[p.id] }}</option>
                  }
                </optgroup>
                @if (store.templates().length > 0) {
                  <optgroup [attr.label]="t.ownTemplates">
                    @for (tpl of store.templates(); track tpl.label; let i = $index) {
                      <option [value]="'u:' + i">{{ tpl.label }}</option>
                    }
                  </optgroup>
                }
              </select>
            </label>
            @if (chosenUserTemplate(); as tplName) {
              <button type="button" class="btn" (click)="deleteTemplate(tplName)">
                {{ t.deleteTemplate(tplName) }}
              </button>
            }
            @if (naming()) {
              <input
                type="text"
                class="template-name"
                autocorrect="off"
                autocapitalize="off"
                spellcheck="false"
                autocomplete="off"
                [attr.aria-label]="t.templateName"
                [placeholder]="t.templateName"
                (keydown)="onTemplateNameKeydown($event)"
              />
              <button type="button" class="btn" (click)="confirmTemplateName()">
                {{ t.saveTemplateConfirm }}
              </button>
            } @else {
              <button type="button" class="btn" (click)="startNaming()">
                {{ t.saveTemplate }}
              </button>
            }
          </div>

          <!-- [2] Check (Candidate entries & matcher) -->
          <div class="section-box">
            <div class="row">
              <span class="section-title">{{ t.checkSection }}</span>
              <label class="field">
                <span>{{ t.entryKind }}</span>
                <select (change)="setTargetKind(text($event))">
                  @for (ek of entryKinds; track ek) {
                    <option [value]="ek" [selected]="ek === r().targetKind">
                      {{ t.entryKinds[ek] }}
                    </option>
                  }
                </select>
              </label>
              <label class="field">
                <span>{{ t.matcherKind }}</span>
                <select (change)="setTargetMatcherKind(text($event))">
                  @for (mk of matcherKinds; track mk) {
                    <option [value]="mk" [selected]="mk === r().targetMatcher.kind">
                      {{ t.matcherKinds[mk] }}
                    </option>
                  }
                </select>
              </label>
              @if (r().targetMatcher; as tm) {
                @if (tm.kind === 'category') {
                  <label class="field grow">
                    <span>{{ t.categoryLabel }}</span>
                    <select
                      [attr.aria-invalid]="invalidAttr('targetMatcher')"
                      [attr.aria-describedby]="describedBy('targetMatcher')"
                      (change)="setTargetCategory(text($event))"
                    >
                      @if (!hasCategory(tm.category)) {
                        <option [value]="tm.category" selected>{{ tm.category }} (⚠)</option>
                      }
                      @for (cat of categoryOptions(); track cat.id) {
                        <option [value]="cat.id" [selected]="sameCategory(cat.id, tm.category)">
                          {{ cat.label }}
                        </option>
                      }
                    </select>
                  </label>
                } @else if (tm.kind === 'glob' || tm.kind === 'regex') {
                  <label class="field grow">
                    <span>{{ t.patternLabel }}</span>
                    <input
                      type="text"
                      autocorrect="off"
                      autocapitalize="off"
                      spellcheck="false"
                      autocomplete="off"
                      [placeholder]="tm.kind === 'glob' ? t.globPlaceholder : t.regexPlaceholder"
                      [value]="tm.pattern"
                      [attr.aria-invalid]="invalidAttr('targetMatcher')"
                      [attr.aria-describedby]="describedBy('targetMatcher')"
                      (input)="onFieldInput('targetMatcher'); setTargetPattern(text($event))"
                      (blur)="touchField('targetMatcher')"
                    />
                  </label>
                }
              }
            </div>
          </div>

          <!-- [3] When (1..8 Conditions + AND/OR join) -->
          <div class="section-box">
            <div class="section-head">
              <div class="inline">
                <span class="section-title">{{ t.whenSection }}</span>
                @if (r().conditions.length >= 2) {
                  <fieldset class="inline-fieldset">
                    <legend class="sr-only">{{ t.matchModeLegend }}</legend>
                    @for (jm of conditionJoins; track jm) {
                      <label class="check">
                        <input
                          type="radio"
                          name="fnf-si-join"
                          [value]="jm"
                          [checked]="r().matchMode === jm"
                          (change)="setMatchMode(jm)"
                        />
                        {{ t.matchModes[jm] }}
                      </label>
                    }
                  </fieldset>
                }
              </div>
              <button
                type="button"
                class="btn"
                [disabled]="r().conditions.length >= maxConditions"
                (click)="store.addCondition()"
              >
                {{ t.addCondition }}
              </button>
            </div>

            <div class="conditions">
              @for (cond of r().conditions; track cond.id; let idx = $index) {
                <div class="cond-card">
                  <div class="cond-main">
                    <label class="field">
                      <span>{{ t.conditionType }}</span>
                      <select (change)="changeCondKind(cond.id, text($event))">
                        @for (ck of conditionKinds; track ck) {
                          <option [value]="ck" [selected]="ck === cond.kind">
                            {{ t.conditionKinds[ck] }}
                          </option>
                        }
                      </select>
                    </label>

                    @switch (cond.kind) {
                      @case ('companion') {
                        <label class="field">
                          <span>&nbsp;</span>
                          <select
                            (change)="patchCompanion(cond, { operator: asExistence(text($event)) })"
                          >
                            @for (op of existenceOperators; track op) {
                              <option [value]="op" [selected]="op === cond.operator">
                                {{ t.existenceOperators[op] }}
                              </option>
                            }
                          </select>
                        </label>
                        <label class="field">
                          <span>{{ t.partnerKind }}</span>
                          <select
                            (change)="
                              patchCompanion(cond, { partnerKind: asEntryKind(text($event)) })
                            "
                          >
                            @for (ek of entryKinds; track ek) {
                              <option [value]="ek" [selected]="ek === cond.partnerKind">
                                {{ t.entryKinds[ek] }}
                              </option>
                            }
                          </select>
                        </label>
                        <label class="field">
                          <span>{{ t.partnerFilter }}</span>
                          <select (change)="setPartnerMatcherKind(cond, text($event))">
                            @for (mk of matcherKinds; track mk) {
                              <option [value]="mk" [selected]="mk === cond.partnerMatcher.kind">
                                {{ t.matcherKinds[mk] }}
                              </option>
                            }
                          </select>
                        </label>
                        @if (cond.partnerMatcher; as pm) {
                          @if (pm.kind === 'category') {
                            <label class="field grow">
                              <span>{{ t.categoryLabel }}</span>
                              <select
                                [attr.aria-invalid]="
                                  invalidAttr('cond:' + cond.id + ':partnerMatcher')
                                "
                                [attr.aria-describedby]="
                                  describedBy('cond:' + cond.id + ':partnerMatcher')
                                "
                                (change)="
                                  patchCompanion(cond, {
                                    partnerMatcher: { kind: 'category', category: text($event) },
                                  })
                                "
                              >
                                @if (!hasCategory(pm.category)) {
                                  <option [value]="pm.category" selected>
                                    {{ pm.category }} (⚠)
                                  </option>
                                }
                                @for (cat of categoryOptions(); track cat.id) {
                                  <option
                                    [value]="cat.id"
                                    [selected]="sameCategory(cat.id, pm.category)"
                                  >
                                    {{ cat.label }}
                                  </option>
                                }
                              </select>
                            </label>
                          } @else if (pm.kind === 'glob' || pm.kind === 'regex') {
                            <label class="field grow">
                              <span>{{ t.patternLabel }}</span>
                              <input
                                type="text"
                                autocorrect="off"
                                autocapitalize="off"
                                spellcheck="false"
                                autocomplete="off"
                                [placeholder]="
                                  pm.kind === 'glob' ? t.globPlaceholder : t.regexPlaceholder
                                "
                                [value]="pm.pattern"
                                [attr.aria-invalid]="
                                  invalidAttr('cond:' + cond.id + ':partnerMatcher')
                                "
                                [attr.aria-describedby]="
                                  describedBy('cond:' + cond.id + ':partnerMatcher')
                                "
                                (input)="
                                  onFieldInput('cond:' + cond.id + ':partnerMatcher');
                                  patchCompanion(cond, {
                                    partnerMatcher: { kind: pm.kind, pattern: text($event) },
                                  })
                                "
                                (blur)="touchField('cond:' + cond.id + ':partnerMatcher')"
                              />
                            </label>
                          }
                        }
                      }

                      @case ('otherPanel') {
                        <label class="field">
                          <span>&nbsp;</span>
                          <select
                            (change)="
                              patchOtherPanel(cond, { operator: asExistence(text($event)) })
                            "
                          >
                            @for (op of existenceOperators; track op) {
                              <option [value]="op" [selected]="op === cond.operator">
                                {{ t.existenceOperators[op] }}
                              </option>
                            }
                          </select>
                        </label>
                        <label class="field grow">
                          <span>{{ t.otherPanelCompareLabel }}</span>
                          <select
                            (change)="
                              patchOtherPanel(cond, { compare: asOtherCompare(text($event)) })
                            "
                          >
                            @for (cmp of otherPanelCompares; track cmp) {
                              <option [value]="cmp" [selected]="cmp === cond.compare">
                                {{ t.otherPanelCompares[cmp] }}
                              </option>
                            }
                          </select>
                        </label>
                      }

                      @case ('size') {
                        <label class="field">
                          <span>&nbsp;</span>
                          <select (change)="patchSize(cond, { operator: asSizeOp(text($event)) })">
                            @for (op of sizeOperators; track op) {
                              <option [value]="op" [selected]="op === cond.operator">
                                {{ t.sizeOperators[op] }}
                              </option>
                            }
                          </select>
                        </label>
                        @if (cond.operator !== 'empty') {
                          <label class="field num">
                            <span>{{ t.sizeValue }}</span>
                            <input
                              type="text"
                              inputmode="decimal"
                              autocorrect="off"
                              autocapitalize="off"
                              spellcheck="false"
                              autocomplete="off"
                              [value]="cond.min"
                              [attr.aria-invalid]="invalidAttr('cond:' + cond.id + ':min')"
                              [attr.aria-describedby]="describedBy('cond:' + cond.id + ':min')"
                              (input)="
                                onFieldInput('cond:' + cond.id + ':min');
                                patchSize(cond, { min: text($event) })
                              "
                              (blur)="touchField('cond:' + cond.id + ':min')"
                            />
                          </label>
                          @if (cond.operator === 'between') {
                            <span class="help">{{ t.rangeTo }}</span>
                            <label class="field num">
                              <span>{{ t.sizeMax }}</span>
                              <input
                                type="text"
                                inputmode="decimal"
                                autocorrect="off"
                                autocapitalize="off"
                                spellcheck="false"
                                autocomplete="off"
                                [value]="cond.max"
                                [attr.aria-invalid]="invalidAttr('cond:' + cond.id + ':max')"
                                [attr.aria-describedby]="describedBy('cond:' + cond.id + ':max')"
                                (input)="
                                  onFieldInput('cond:' + cond.id + ':max');
                                  patchSize(cond, { max: text($event) })
                                "
                                (blur)="touchField('cond:' + cond.id + ':max')"
                              />
                            </label>
                          }
                          <label class="field">
                            <span>{{ t.sizeUnit }}</span>
                            <select (change)="patchSize(cond, { unit: asSizeUnit(text($event)) })">
                              @for (u of sizeUnits; track u) {
                                <option [value]="u" [selected]="u === cond.unit">{{ u }}</option>
                              }
                            </select>
                          </label>
                        }
                      }

                      @case ('modified') {
                        <label class="field">
                          <span>&nbsp;</span>
                          <select
                            (change)="patchModified(cond, { operator: asModifiedOp(text($event)) })"
                          >
                            @for (op of modifiedOperators; track op) {
                              <option [value]="op" [selected]="op === cond.operator">
                                {{ t.modifiedOperators[op] }}
                              </option>
                            }
                          </select>
                        </label>
                        @if (cond.operator === 'withinLast' || cond.operator === 'olderThan') {
                          <label class="field num">
                            <span>{{ t.ageAmount }}</span>
                            <input
                              type="text"
                              inputmode="decimal"
                              autocorrect="off"
                              autocapitalize="off"
                              spellcheck="false"
                              autocomplete="off"
                              [value]="cond.amount"
                              [attr.aria-invalid]="invalidAttr('cond:' + cond.id + ':amount')"
                              [attr.aria-describedby]="describedBy('cond:' + cond.id + ':amount')"
                              (input)="
                                onFieldInput('cond:' + cond.id + ':amount');
                                patchModified(cond, { amount: text($event) })
                              "
                              (blur)="touchField('cond:' + cond.id + ':amount')"
                            />
                          </label>
                          <label class="field">
                            <span>&nbsp;</span>
                            <select
                              (change)="patchModified(cond, { ageUnit: asAgeUnit(text($event)) })"
                            >
                              @for (au of ageUnits; track au) {
                                <option [value]="au" [selected]="au === cond.ageUnit">
                                  {{ t.ageUnits[au] }}
                                </option>
                              }
                            </select>
                          </label>
                        } @else {
                          <label class="field">
                            <span>{{ t.dateFrom }}</span>
                            <input
                              type="text"
                              class="date-input"
                              autocorrect="off"
                              autocapitalize="off"
                              spellcheck="false"
                              autocomplete="off"
                              [placeholder]="t.datePlaceholder"
                              [value]="cond.dateFrom"
                              [attr.aria-invalid]="invalidAttr('cond:' + cond.id + ':dateFrom')"
                              [attr.aria-describedby]="describedBy('cond:' + cond.id + ':dateFrom')"
                              (input)="
                                onFieldInput('cond:' + cond.id + ':dateFrom');
                                patchModified(cond, { dateFrom: text($event) })
                              "
                              (blur)="touchField('cond:' + cond.id + ':dateFrom')"
                            />
                          </label>
                          @if (cond.operator === 'between') {
                            <label class="field">
                              <span>{{ t.dateTo }}</span>
                              <input
                                type="text"
                                class="date-input"
                                autocorrect="off"
                                autocapitalize="off"
                                spellcheck="false"
                                autocomplete="off"
                                [placeholder]="t.datePlaceholder"
                                [value]="cond.dateTo"
                                [attr.aria-invalid]="invalidAttr('cond:' + cond.id + ':dateTo')"
                                [attr.aria-describedby]="describedBy('cond:' + cond.id + ':dateTo')"
                                (input)="
                                  onFieldInput('cond:' + cond.id + ':dateTo');
                                  patchModified(cond, { dateTo: text($event) })
                                "
                                (blur)="touchField('cond:' + cond.id + ':dateTo')"
                              />
                            </label>
                          }
                        }
                      }

                      @case ('name') {
                        <label class="field">
                          <span>&nbsp;</span>
                          <select (change)="patchName(cond, { operator: asNameOp(text($event)) })">
                            @for (op of nameOperators; track op) {
                              <option [value]="op" [selected]="op === cond.operator">
                                {{ t.nameOperators[op] }}
                              </option>
                            }
                          </select>
                        </label>
                        <label class="field">
                          <span>{{ t.matcherKind }}</span>
                          <select
                            (change)="
                              patchName(cond, { mode: text($event) === 'regex' ? 'regex' : 'glob' })
                            "
                          >
                            @for (nm of nameModes; track nm) {
                              <option [value]="nm" [selected]="nm === cond.mode">
                                {{ t.nameModes[nm] }}
                              </option>
                            }
                          </select>
                        </label>
                        <label class="field grow">
                          <span>{{ t.patternLabel }}</span>
                          <input
                            type="text"
                            autocorrect="off"
                            autocapitalize="off"
                            spellcheck="false"
                            autocomplete="off"
                            [placeholder]="
                              cond.mode === 'glob' ? t.globPlaceholder : t.regexPlaceholder
                            "
                            [value]="cond.pattern"
                            [attr.aria-invalid]="invalidAttr('cond:' + cond.id + ':pattern')"
                            [attr.aria-describedby]="describedBy('cond:' + cond.id + ':pattern')"
                            (input)="
                              onFieldInput('cond:' + cond.id + ':pattern');
                              patchName(cond, { pattern: text($event) })
                            "
                            (blur)="touchField('cond:' + cond.id + ':pattern')"
                          />
                        </label>
                      }
                    }

                    @if (r().conditions.length > 1) {
                      <button
                        type="button"
                        class="btn cond-remove"
                        [attr.aria-label]="t.removeCondition(idx + 1)"
                        [title]="t.removeCondition(idx + 1)"
                        (click)="store.removeCondition(cond.id)"
                      >
                        ×
                      </button>
                    }
                  </div>

                  @if (cond.kind === 'companion') {
                    <div class="cond-sub">
                      <label class="inline">
                        <span>{{ t.stemMatchLabel }}:</span>
                        <select
                          (change)="patchCompanion(cond, { stemMatch: asStemMatch(text($event)) })"
                        >
                          @for (sm of stemMatchModes; track sm) {
                            <option [value]="sm" [selected]="sm === cond.stemMatch">
                              {{ t.stemMatches[sm] }}
                            </option>
                          }
                        </select>
                      </label>
                      @if (cond.operator === 'exists') {
                        <label class="check">
                          <input
                            type="checkbox"
                            [checked]="cond.includeCompanions"
                            (change)="patchCompanion(cond, { includeCompanions: checked($event) })"
                          />
                          {{ t.includeCompanions }}
                        </label>
                      }
                    </div>
                  }
                  @if (cond.kind === 'otherPanel' && !req.hasOtherPanelEntries) {
                    <p class="help">{{ t.noOtherPanelHint }}</p>
                  }
                </div>
              }
            </div>
          </div>

          <!-- [4] Effect on current selection (<fieldset> + visible radio buttons, < 6 choices) -->
          <fieldset class="inline-fieldset">
            <legend class="group-legend">{{ t.effectLegend }}:</legend>
            @for (cm of combineModes; track cm) {
              <label class="check">
                <input
                  type="radio"
                  name="fnf-si-combine"
                  [value]="cm"
                  [checked]="r().combineMode === cm"
                  (change)="setCombineMode(cm)"
                />
                {{ t.combineModes[cm] }}
              </label>
            }
          </fieldset>

          <!-- [5] Virtualised Preview Grid -->
          <div class="preview-head">
            <span [id]="previewLabelId" class="preview-label">{{ t.preview }}</span>
            <label class="check">
              <input
                type="checkbox"
                [checked]="store.showExcluded()"
                (change)="store.showExcluded.set(checked($event))"
              />
              {{ t.showExcluded }}
            </label>
          </div>
          <app-preview-grid
            class="preview"
            [columns]="columns()"
            [rows]="store.previewRows()"
            [rowClass]="rowClass"
            [labelledBy]="previewLabelId"
          />

          <!-- [6] Footer: live summary, deferred alert region, Cancel & Submit -->
          <div class="foot">
            <p class="summary" aria-live="polite">{{ statusMessage() }}</p>
            <p [id]="errorId" class="error" role="alert">{{ visibleErrorText() }}</p>
            <div class="buttons">
              <button type="button" class="btn" (click)="store.close()">{{ t.cancel }}</button>
              <button
                type="submit"
                class="btn primary"
                aria-keyshortcuts="Control+Enter Meta+Enter"
              >
                {{ t.apply }}
              </button>
            </div>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrls: ['../../shared/dialog/tool-dialog.css', './select-if-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
})
export class SelectIfDialog {
  protected readonly t = SI_TEXTS;
  protected readonly store = inject(SelectIfStore);
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly r = this.store.rule;
  protected readonly presets = SELECT_IF_PRESETS;
  protected readonly maxConditions = MAX_CONDITIONS;
  protected readonly entryKinds = ENTRY_KINDS;
  protected readonly matcherKinds = MATCHER_KINDS;
  protected readonly conditionKinds = CONDITION_KINDS;
  protected readonly conditionJoins = CONDITION_JOINS;
  protected readonly combineModes = COMBINE_MODES;
  protected readonly stemMatchModes = STEM_MATCH_MODES;
  protected readonly existenceOperators = EXISTENCE_OPERATORS;
  protected readonly otherPanelCompares = OTHER_PANEL_COMPARES;
  protected readonly sizeOperators = SIZE_OPERATORS;
  protected readonly sizeUnits = SIZE_UNITS;
  protected readonly modifiedOperators = MODIFIED_OPERATORS;
  protected readonly ageUnits = AGE_UNITS;
  protected readonly nameOperators = NAME_OPERATORS;
  protected readonly nameModes = NAME_MODES;

  protected readonly previewLabelId = PREVIEW_LABEL_ID;
  protected readonly errorId = ERROR_ID;
  protected readonly rowClass = rowClass;

  protected readonly naming = signal(false);
  protected readonly chosenUserTemplate = signal<string | null>(null);
  protected readonly savedAnnouncement = signal('');
  protected readonly templateSaveError = signal('');
  private readonly touchedFields = signal<ReadonlySet<string>>(new Set());
  private readonly submitted = signal(false);

  protected readonly categoryOptions = computed(() =>
    this.store.categories().map((c) => ({
      id: c.label,
      label: fileTypeLabel(c.label),
    })),
  );

  protected readonly columns = computed<readonly GridColumn[]>(() => {
    const t = SI_TEXTS;
    const cols: GridColumn[] = [
      { property: 'nr', label: t.colNr, width: 52, align: 'end' },
      { property: 'name', label: t.colName, width: null },
    ];
    if (this.store.request()?.hasSubfolders) {
      cols.push({ property: 'folder', label: t.colFolder, width: 150 });
    }
    cols.push(
      { property: 'roleText', label: t.colRole, width: 165 },
      { property: 'sizeText', label: t.colSize, width: 96, align: 'end' },
    );
    return cols;
  });

  /**
   * Deferred error visibility (`accessible-error-announcement`):
   * - `unknownCategory` from a loaded preset/template is shown immediately;
   * - typing errors (`emptyPattern`, `invalidRegex`, `invalidNumber`, `invalidDate`,
   *   `invalidRange`) appear only after the field was blurred or submit was attempted,
   *   and clear while the user edits the field.
   */
  private readonly visibleProblems = computed(() => {
    const touched = this.touchedFields();
    const didSubmit = this.submitted();
    return this.store
      .evaluation()
      .problems.filter((p) => p.code === 'unknownCategory' || didSubmit || touched.has(p.field));
  });

  protected readonly visibleErrorText = computed(() => {
    const tplErr = this.templateSaveError();
    if (tplErr) {
      return tplErr;
    }
    const first = this.visibleProblems()[0];
    return first ? describeProblem(first) : '';
  });

  protected readonly statusMessage = computed(() => {
    const saved = this.savedAnnouncement();
    const summary = this.store.summaryText();
    return saved && summary ? `${summary} · ${saved}` : saved || summary;
  });

  constructor() {
    this.store.ensurePrepared();
  }

  protected hasCategory(name: string): boolean {
    const wanted = name.trim().toLowerCase();
    return this.store.categories().some((c) => c.label.trim().toLowerCase() === wanted);
  }

  protected sameCategory(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  protected invalidAttr(field: string): 'true' | null {
    return this.visibleProblems().some((p) => p.field === field) ? 'true' : null;
  }

  protected describedBy(field: string): string | null {
    return this.invalidAttr(field) ? this.errorId : null;
  }

  protected touchField(field: string): void {
    const next = new Set(this.touchedFields());
    next.add(field);
    this.touchedFields.set(next);
  }

  protected onFieldInput(field: string): void {
    this.savedAnnouncement.set('');
    this.templateSaveError.set('');
    if (this.touchedFields().has(field) || this.submitted()) {
      const next = new Set(this.touchedFields());
      next.delete(field);
      this.touchedFields.set(next);
      this.submitted.set(false);
    }
  }

  private resetValidationState(): void {
    this.touchedFields.set(new Set());
    this.submitted.set(false);
    this.templateSaveError.set('');
  }

  protected applyTemplateChoice(evt: Event): void {
    const select = evt.target as HTMLSelectElement;
    const raw = select.value;
    select.value = '';
    this.savedAnnouncement.set('');
    this.resetValidationState();
    if (raw.startsWith('p:')) {
      const preset = this.presets[Number(raw.slice(2))];
      if (preset) {
        this.chosenUserTemplate.set(null);
        this.store.setRule(preset.rule);
      }
    } else if (raw.startsWith('u:')) {
      const tpl = this.store.templates()[Number(raw.slice(2))];
      if (tpl) {
        this.chosenUserTemplate.set(tpl.label);
        this.store.setRule(tpl.rule);
      }
    }
  }

  protected startNaming(): void {
    this.naming.set(true);
    this.templateSaveError.set('');
    setTimeout(() =>
      this.hostRef.nativeElement.querySelector<HTMLInputElement>('input.template-name')?.focus(),
    );
  }

  protected onTemplateNameKeydown(evt: KeyboardEvent): void {
    if (evt.isComposing) {
      return;
    }
    if (evt.key === 'Enter') {
      evt.preventDefault();
      evt.stopPropagation();
      this.saveTemplate((evt.target as HTMLInputElement).value);
    } else if (evt.key === 'Escape') {
      evt.preventDefault();
      evt.stopPropagation();
      this.naming.set(false);
    }
  }

  protected confirmTemplateName(): void {
    const input = this.hostRef.nativeElement.querySelector<HTMLInputElement>('input.template-name');
    this.saveTemplate(input?.value ?? '');
  }

  private saveTemplate(rawLabel: string): void {
    const trimmed = rawLabel.trim();
    if (!trimmed) {
      this.naming.set(false);
      return;
    }
    if (this.store.saveTemplate(trimmed)) {
      this.chosenUserTemplate.set(trimmed);
      this.savedAnnouncement.set(this.t.templateSaved(trimmed));
      this.templateSaveError.set('');
      this.naming.set(false);
    } else {
      this.templateSaveError.set(this.t.templatesFull(MAX_TEMPLATES));
    }
  }

  protected deleteTemplate(label: string): void {
    this.store.deleteTemplate(label);
    this.chosenUserTemplate.set(null);
    this.savedAnnouncement.set('');
  }

  protected setTargetKind(raw: string): void {
    this.store.patchRule({ targetKind: this.asEntryKind(raw) });
  }

  protected setTargetMatcherKind(raw: string): void {
    const fallbackCat = this.store.categories()[0]?.label ?? 'movies';
    this.resetValidationState();
    this.store.patchRule({
      targetMatcher: defaultMatcher(raw as MatcherKind, fallbackCat),
    });
  }

  protected setTargetCategory(category: string): void {
    this.store.patchRule({ targetMatcher: { kind: 'category', category } });
  }

  protected setTargetPattern(pattern: string): void {
    const cur = this.r().targetMatcher;
    if (cur.kind === 'glob' || cur.kind === 'regex') {
      this.store.patchRule({ targetMatcher: { kind: cur.kind, pattern } });
    }
  }

  protected setMatchMode(matchMode: ConditionJoin): void {
    this.store.patchRule({ matchMode });
  }

  protected setCombineMode(combineMode: CombineMode): void {
    this.store.patchRule({ combineMode });
  }

  protected changeCondKind(id: string, raw: string): void {
    this.resetValidationState();
    this.store.changeConditionKind(id, raw as ConditionKind);
  }

  protected setPartnerMatcherKind(cond: CompanionCondition, raw: string): void {
    const cats = this.store.categories();
    const fallbackCat =
      cats.find((c) => c.label.toLowerCase() === 'images')?.label ?? cats[0]?.label ?? 'images';
    const partnerMatcher: MatcherSpec = defaultMatcher(raw as MatcherKind, fallbackCat);
    this.patchCompanion(cond, { partnerMatcher });
  }

  protected patchCompanion(cond: CompanionCondition, patch: Partial<CompanionCondition>): void {
    this.store.replaceCondition(cond.id, { ...cond, ...patch });
  }

  protected patchOtherPanel(cond: OtherPanelCondition, patch: Partial<OtherPanelCondition>): void {
    this.store.replaceCondition(cond.id, { ...cond, ...patch });
  }

  protected patchSize(cond: SizeCondition, patch: Partial<SizeCondition>): void {
    this.store.replaceCondition(cond.id, { ...cond, ...patch });
  }

  protected patchModified(cond: ModifiedCondition, patch: Partial<ModifiedCondition>): void {
    this.store.replaceCondition(cond.id, { ...cond, ...patch });
  }

  protected patchName(cond: NameCondition, patch: Partial<NameCondition>): void {
    this.store.replaceCondition(cond.id, { ...cond, ...patch });
  }

  protected onSubmit(evt: Event): void {
    evt.preventDefault();
    this.trySubmit();
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (evt.isComposing) {
      if (evt.key === 'Enter') {
        evt.preventDefault();
      }
      return;
    }
    if ((evt.metaKey || evt.ctrlKey) && evt.key === 'Enter') {
      evt.preventDefault();
      this.trySubmit();
    }
  }

  private trySubmit(): void {
    if (this.store.apply()) {
      return;
    }
    this.submitted.set(true);
    setTimeout(() => {
      this.hostRef.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  }

  protected text(evt: Event): string {
    return (evt.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected checked(evt: Event): boolean {
    return (evt.target as HTMLInputElement).checked;
  }

  protected asEntryKind(v: string): EntryKindFilter {
    return ENTRY_KINDS.includes(v as EntryKindFilter) ? (v as EntryKindFilter) : 'files';
  }

  protected asExistence(v: string): ExistenceOperator {
    return v === 'missing' ? 'missing' : 'exists';
  }

  protected asStemMatch(v: string): StemMatchMode {
    return v === 'prefix' ? 'prefix' : 'exact';
  }

  protected asOtherCompare(v: string): OtherPanelCompare {
    return OTHER_PANEL_COMPARES.includes(v as OtherPanelCompare)
      ? (v as OtherPanelCompare)
      : 'sameName';
  }

  protected asSizeOp(v: string): SizeOperator {
    return SIZE_OPERATORS.includes(v as SizeOperator) ? (v as SizeOperator) : 'gt';
  }

  protected asSizeUnit(v: string): SizeUnit {
    return SIZE_UNITS.includes(v as SizeUnit) ? (v as SizeUnit) : 'MB';
  }

  protected asModifiedOp(v: string): ModifiedOperator {
    return MODIFIED_OPERATORS.includes(v as ModifiedOperator)
      ? (v as ModifiedOperator)
      : 'withinLast';
  }

  protected asAgeUnit(v: string): AgeUnit {
    return v === 'hours' ? 'hours' : 'days';
  }

  protected asNameOp(v: string): NameOperator {
    return v === 'notMatches' ? 'notMatches' : 'matches';
  }
}
