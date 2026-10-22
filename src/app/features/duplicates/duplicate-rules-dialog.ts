import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Modal } from '../../shared/dialog/modal';
import { otherSide, WorkspaceStore } from '../workspace/workspace.store';
import { MAX_RULES } from './duplicates-presets';
import { Prefer, Rule, RULE_KINDS, RuleKind, validateRuleSet } from './duplicates-rules';
import { DUP_TEXTS } from './duplicates-texts';
import { DuplicatesStore } from './duplicates.store';

/**
 * "Which file stays?" (DUP_RULES_DLG, design 042 E2): the rules in order, each with its
 * fields; Alt+↑/↓ (or the buttons) move the focused rule. A live count shows how many
 * groups the rules decide on the current result. Saved under a name, a set can be
 * chosen again later; "Apply" marks the copies (nothing is deleted).
 */
@Component({
  selector: 'app-duplicate-rules-dialog',
  imports: [Modal],
  template: `
    @if (dup.rules(); as d) {
      <app-modal [heading]="t.rulesTitle" width="min(48rem, 96vw)" (closed)="dup.closeRules()">
        <form class="tool" (submit)="$event.preventDefault(); apply()">
          <p class="hint">{{ t.rulesIntro }}</p>
          <ol class="rules" [attr.aria-label]="t.rulesList">
            @for (r of d.set.rules; track $index; let i = $index; let last = $last) {
              <li class="rule" tabindex="-1" (keydown)="moveKey($event, i)">
                <span class="num" aria-hidden="true">{{ i + 1 }}.</span>
                <select
                  [attr.aria-label]="t.rulesList + ' ' + (i + 1)"
                  [attr.data-autofocus]="i === 0 ? '' : null"
                  (change)="setKind(i, $any($event.target).value)"
                >
                  @for (k of kinds; track k) {
                    <option [value]="k" [selected]="k === r.kind">{{ t.rule[k] }}</option>
                  }
                </select>
                @if (r.kind === 'pathPattern') {
                  <input
                    type="text"
                    spellcheck="false"
                    class="grow"
                    [attr.aria-label]="t.pattern"
                    [placeholder]="t.pattern"
                    [value]="r.pattern ?? ''"
                    (input)="patch(i, { pattern: $any($event.target).value })"
                  />
                  <select
                    [attr.aria-label]="t.pattern"
                    (change)="patch(i, { syntax: $any($event.target).value })"
                  >
                    <option value="glob" [selected]="r.syntax !== 'regex'">{{ t.glob }}</option>
                    <option value="regex" [selected]="r.syntax === 'regex'">{{ t.regex }}</option>
                  </select>
                  <label class="check">
                    <input
                      type="checkbox"
                      [checked]="r.caseSensitive === true"
                      (change)="patch(i, { caseSensitive: $any($event.target).checked })"
                    />
                    {{ t.caseSensitive }}
                  </label>
                }
                @if (r.kind === 'inFolder') {
                  <input
                    type="text"
                    spellcheck="false"
                    class="grow"
                    [attr.aria-label]="t.folder"
                    [placeholder]="t.folder"
                    [value]="r.folder ?? ''"
                    (input)="patch(i, { folder: $any($event.target).value })"
                  />
                  <button
                    type="button"
                    class="btn"
                    [disabled]="otherFolder() === null"
                    (click)="patch(i, { folder: otherFolder() ?? '' })"
                  >
                    {{ t.folderFromOther }}
                  </button>
                }
                @if (r.kind === 'pathPattern' || r.kind === 'inFolder') {
                  <select
                    [attr.aria-label]="t.rule[r.kind]"
                    (change)="patch(i, { prefer: $any($event.target).value })"
                  >
                    <option value="keep" [selected]="(r.prefer ?? 'keep') === 'keep'">
                      {{ t.preferKeep }}
                    </option>
                    <option value="delete" [selected]="r.prefer === 'delete'">
                      {{ t.preferDelete }}
                    </option>
                  </select>
                }
                <span class="tools">
                  <button
                    type="button"
                    class="btn icon"
                    [attr.aria-label]="t.moveUp"
                    [attr.title]="t.moveUp + ' (Alt+↑)'"
                    [disabled]="i === 0"
                    (click)="move(i, -1)"
                  >
                    <i class="fa fa-arrow-up" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    class="btn icon"
                    [attr.aria-label]="t.moveDown"
                    [attr.title]="t.moveDown + ' (Alt+↓)'"
                    [disabled]="last"
                    (click)="move(i, 1)"
                  >
                    <i class="fa fa-arrow-down" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    class="btn icon"
                    [attr.aria-label]="t.removeRule"
                    [attr.title]="t.removeRule"
                    (click)="remove(i)"
                  >
                    <i class="fa fa-times" aria-hidden="true"></i>
                  </button>
                </span>
              </li>
            }
          </ol>
          <div class="row">
            <button
              type="button"
              class="btn"
              [disabled]="d.set.rules.length >= maxRules"
              (click)="add()"
            >
              <i class="fa fa-plus" aria-hidden="true"></i> {{ t.addRule }}
            </button>
            <span class="grow"></span>
            <span class="hint" role="status">{{ preview() }}</span>
          </div>
          <div class="row">
            <label class="field grow">
              <span>{{ t.presetName }}</span>
              <input
                type="text"
                maxlength="100"
                [value]="d.name"
                (input)="dup.setRulesName($any($event.target).value)"
              />
            </label>
            <button
              type="button"
              class="btn"
              [disabled]="d.name.trim() === '' || problem() !== null"
              (click)="dup.saveRules()"
            >
              {{ t.save }}
            </button>
            @if (d.from.startsWith('u:')) {
              <button type="button" class="btn danger" (click)="dup.deleteUserSet(d.from.slice(2))">
                {{ t.deletePreset }}
              </button>
            }
          </div>
          <p class="error" role="alert">{{ problem() ?? '' }}</p>
          <div class="buttons">
            <button type="button" class="btn" (click)="dup.closeRules()">{{ t.close }}</button>
            <button type="submit" class="btn primary" [disabled]="problem() !== null">
              {{ t.applyAndClose }}
            </button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrls: ['../../shared/dialog/tool-dialog.css'],
  styles: `
    .rules {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      max-height: 20rem;
      overflow: auto;
    }
    .rule {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-1);
    }
    .num {
      min-width: 2ch;
      text-align: end;
      color: var(--color-muted);
    }
    .grow {
      flex: 1;
      min-width: 8rem;
    }
    .tools {
      display: flex;
      gap: 2px;
      margin-left: auto;
    }
    .btn.icon {
      min-width: 0;
      padding: 0 var(--spacing-2);
    }
    .hint {
      margin: 0;
      color: var(--color-muted);
      font-size: var(--font-size-sm);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DuplicateRulesDialog {
  protected readonly t = DUP_TEXTS;
  protected readonly dup = inject(DuplicatesStore);
  private readonly ws = inject(WorkspaceStore);
  protected readonly kinds: readonly RuleKind[] = RULE_KINDS;
  protected readonly maxRules = MAX_RULES;

  protected readonly problem = computed(() => {
    const d = this.dup.rules();
    const p = d ? validateRuleSet(d.set) : null;
    return p ? DUP_TEXTS.ruleError(p.reason, p.rule + 1) : null;
  });

  protected readonly preview = computed(() => {
    const d = this.dup.rules();
    const p = d ? this.dup.previewRules(d.set, d.side) : null;
    return p ? DUP_TEXTS.rulesPreview(p.decided, p.undecided) : '';
  });

  /** The folder the other side shows (for "lies in a folder"). */
  protected readonly otherFolder = computed(() => {
    const d = this.dup.rules();
    const store = d ? this.ws.panel(otherSide(d.side))?.store : undefined;
    return store && store.searchKey() === null ? store.path() : null;
  });

  private rules(): readonly Rule[] {
    return this.dup.rules()?.set.rules ?? [];
  }

  private set(rules: readonly Rule[]): void {
    this.dup.updateRules({ rules });
  }

  protected setKind(i: number, kind: RuleKind): void {
    const next: Rule =
      kind === 'pathPattern'
        ? { kind, pattern: '', syntax: 'glob', prefer: 'delete' }
        : kind === 'inFolder'
          ? { kind, folder: this.otherFolder() ?? '', prefer: 'keep' }
          : { kind };
    this.set(this.rules().map((r, k) => (k === i ? next : r)));
  }

  protected patch(i: number, change: Partial<Rule> & { prefer?: Prefer }): void {
    this.set(this.rules().map((r, k) => (k === i ? { ...r, ...change } : r)));
  }

  protected add(): void {
    this.set([...this.rules(), { kind: 'oldest' }]);
  }

  protected remove(i: number): void {
    this.set(this.rules().filter((_, k) => k !== i));
  }

  protected move(i: number, delta: -1 | 1): void {
    const rules = [...this.rules()];
    const j = i + delta;
    if (j < 0 || j >= rules.length) {
      return;
    }
    [rules[i], rules[j]] = [rules[j], rules[i]];
    this.set(rules);
  }

  /** Alt+↑/↓ inside a rule moves it (a widget key of the dialog, not an app action). */
  protected moveKey(evt: KeyboardEvent, i: number): void {
    if (evt.altKey && (evt.key === 'ArrowUp' || evt.key === 'ArrowDown')) {
      evt.preventDefault();
      this.move(i, evt.key === 'ArrowUp' ? -1 : 1);
    }
  }

  protected apply(): void {
    void this.dup.applyRules();
  }
}
