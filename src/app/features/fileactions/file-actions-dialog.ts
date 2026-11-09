import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import {
  FILE_ACTION_TRIGGERS,
  FileActionModifier,
  FileActionProblem,
  FileActionRule,
  FileActionTrigger,
  MAX_FILE_ACTIONS,
} from '../../core/fileactions/file-actions.models';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { DialogKey } from '../../shared/dialog/dialog-key';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { moveSlot, removeSlot } from '../config/button-config-logic';
import { FileActionsHelp } from './file-actions-help';
import {
  availableModifiers,
  modifierLabel,
  modifierName,
  normalizeModifiers,
  shadowedRules,
} from './file-actions-logic';
import { FILE_ACTIONS_TEXTS } from './file-actions-texts';
import { FileActionsStore } from './file-actions.store';

/**
 * Double-click actions (OPEN_FILE_ACTIONS_DLG, design 072): rules with trigger (kind + keys
 * held, design 073), file pattern, yes/no question and command; a draft that "Save" writes
 * to `file-actions.json`.
 */
@Component({
  selector: 'app-file-actions-dialog',
  imports: [Modal, DialogKey, FileActionsHelp],
  template: `
    <app-modal [heading]="t.title" width="62rem" [compact]="true" (closed)="dialogs.close()">
      <div class="tool">
        <div class="body">
          <p class="intro">{{ t.intro }}</p>
          <div class="editor">
            <div class="field side">
              <span [id]="listLabelId">{{ t.rules }}</span>
              <ul
                class="listbox rules"
                role="listbox"
                tabindex="0"
                data-autofocus
                [attr.aria-labelledby]="listLabelId"
                [attr.aria-describedby]="listHelpId"
                [attr.aria-activedescendant]="rows().length ? rowId(cursor()) : null"
                (keydown)="onListKey($event)"
                (click)="onRowClick($event)"
              >
                @for (r of rows(); track r.id; let i = $index) {
                  <li
                    role="option"
                    [id]="rowId(i)"
                    [attr.aria-selected]="i === cursor()"
                    [attr.aria-invalid]="problemOf(r) ? 'true' : null"
                    [attr.aria-description]="shadowed().has(r.id) ? t.shadowed : null"
                    [class.invalid]="problemOf(r) !== null"
                    [class.shadowed]="shadowed().has(r.id)"
                    [attr.data-index]="i"
                  >
                    <span class="keys">{{ keysOf(r) }}</span>
                    <span class="grow">{{ r.pattern || t.newPattern }}</span>
                    <span class="muted">{{ r.command }}</span>
                    @if (shadowed().has(r.id)) {
                      <span class="fa fa-exclamation-triangle" aria-hidden="true"></span>
                    }
                  </li>
                } @empty {
                  <li class="empty" role="option" aria-selected="false" aria-disabled="true">
                    {{ t.noRules }}
                  </li>
                }
              </ul>
              <p class="help" [id]="listHelpId">{{ t.listHelp }}</p>
            </div>
            @if (current(); as r) {
              <div class="side" role="group" [attr.aria-labelledby]="headingId">
                <h3 class="rule-heading" [id]="headingId">{{ heading() }}</h3>
                <label class="field">
                  <span>{{ t.trigger }}</span>
                  <select class="trigger" (change)="setTrigger(value($event))">
                    @for (k of triggerKinds; track k) {
                      <option [value]="k" [selected]="r.trigger === k">{{ t.triggers[k] }}</option>
                    }
                    @if (!knownTrigger(r)) {
                      <option [value]="r.trigger" selected disabled>{{ r.trigger }}</option>
                    }
                  </select>
                </label>
                <fieldset class="keys-held">
                  <legend>{{ t.keysHeld }}</legend>
                  @for (m of modifiers(); track m) {
                    <label class="check">
                      <input
                        type="checkbox"
                        [attr.data-modifier]="m"
                        [checked]="r.modifiers.includes(m)"
                        (change)="setModifier(m, checked($event))"
                      />
                      <span>{{ modifierText(m) }}</span>
                    </label>
                  }
                </fieldset>
                <label class="field">
                  <span>{{ t.pattern }}</span>
                  <input
                    type="text"
                    class="pattern"
                    spellcheck="false"
                    placeholder="*.js"
                    [value]="r.pattern"
                    [attr.aria-describedby]="patternHelpId + ' ' + problemId"
                    (input)="patch({ pattern: value($event) })"
                  />
                </label>
                <p class="help" [id]="patternHelpId">{{ t.patternHelp }}</p>
                <label class="check">
                  <input
                    type="checkbox"
                    class="confirm"
                    [checked]="r.confirm"
                    (change)="patch({ confirm: checked($event) })"
                  />
                  <span>{{ t.confirm }}</span>
                </label>
                <label class="check">
                  <input
                    type="checkbox"
                    class="terminal"
                    [checked]="r.terminal"
                    (change)="patch({ terminal: checked($event) })"
                  />
                  <span>{{ t.terminal }}</span>
                </label>
                <label class="field">
                  <span>{{ t.command }}</span>
                  <input
                    type="text"
                    class="command"
                    spellcheck="false"
                    placeholder="node %N"
                    [value]="r.command"
                    [attr.aria-describedby]="commandHelpId + ' ' + problemId"
                    (input)="patch({ command: value($event) })"
                  />
                </label>
                <p class="help" [id]="commandHelpId">{{ t.commandHelp }}</p>
                @if (shadowed().has(r.id)) {
                  <p class="help shadowed-hint">{{ t.shadowedHint }}</p>
                }
                <p class="error" [id]="problemId" aria-live="polite">{{ problemText() }}</p>
              </div>
            } @else {
              <p class="side intro">{{ t.noSelection }}</p>
            }
          </div>
        </div>
        <p class="error" role="alert">{{ error() }}</p>
        <div class="foot">
          <button type="button" class="btn help-button" (click)="help.set(true)">
            {{ t.help }}
          </button>
          <button
            appDialogKey="secondary:N"
            type="button"
            class="btn"
            [disabled]="rows().length >= maxRules"
            (click)="add()"
          >
            {{ t.add }}
          </button>
          <button
            appDialogKey="secondary:R"
            type="button"
            class="btn"
            [disabled]="!current()"
            (click)="remove()"
          >
            {{ t.remove }}
          </button>
          <button
            appDialogKey="secondary:U"
            type="button"
            class="btn"
            [disabled]="cursor() <= 0"
            (click)="move(-1)"
          >
            {{ t.moveUp }}
          </button>
          <button
            appDialogKey="secondary:D"
            type="button"
            class="btn"
            [disabled]="cursor() >= rows().length - 1"
            (click)="move(1)"
          >
            {{ t.moveDown }}
          </button>
          <div class="buttons">
            <button appDialogKey="cancel" type="button" class="btn" (click)="dialogs.close()">
              {{ t.cancel }}
            </button>
            <button
              appDialogKey="primary"
              type="button"
              class="btn primary"
              [disabled]="busy()"
              (click)="save()"
            >
              {{ t.save }}
            </button>
          </div>
        </div>
      </div>
    </app-modal>
    @if (help()) {
      <app-file-actions-help (closed)="closeHelp()" />
    }
  `,
  styleUrls: [
    '../../shared/dialog/tool-dialog.css',
    '../config/config-dialog.css',
    './file-actions-dialog.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileActionsDialog {
  protected readonly t = FILE_ACTIONS_TEXTS;
  protected readonly store = inject(FileActionsStore);
  protected readonly dialogs = inject(DialogService);
  protected readonly maxRules = MAX_FILE_ACTIONS;
  protected readonly listLabelId = 'fnf-fa-list-label';
  protected readonly listHelpId = 'fnf-fa-list-help';
  protected readonly patternHelpId = 'fnf-fa-pattern-help';
  protected readonly commandHelpId = 'fnf-fa-command-help';
  protected readonly problemId = 'fnf-fa-problem';
  protected readonly headingId = 'fnf-fa-rule-heading';
  protected readonly triggerKinds = FILE_ACTION_TRIGGERS;
  private readonly platform = inject(ActionService).platform;
  protected readonly modifiers = computed(() => availableModifiers(this.platform()));

  protected readonly rows = signal<readonly FileActionRule[]>(this.store.rules());
  protected readonly cursor = signal(0);
  protected readonly current = computed<FileActionRule | null>(
    () => this.rows()[this.cursor()] ?? null,
  );
  protected readonly problems = signal<readonly FileActionProblem[]>(this.store.problems());
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly help = signal(false);
  protected readonly problemText = computed(() => {
    const r = this.current();
    const code = r ? this.problems().find((p) => p.id === r.id)?.code : undefined;
    return code ? this.t.problems[code] : '';
  });

  /** Rules an identical one above hides (E20): a hint, no error. */
  protected readonly shadowed = computed(() => shadowedRules(this.rows()));
  /** Heading of the right column (E24): "⇧ Double click on *.js". */
  protected readonly heading = computed(() => {
    const r = this.current();
    if (!r) {
      return '';
    }
    const kind = this.knownTrigger(r) ? this.t.triggers[r.trigger] : r.trigger;
    return this.t.ruleHeading(this.keysOf(r), kind, r.pattern);
  });

  private nextId = 1;

  protected knownTrigger(r: FileActionRule): boolean {
    return this.triggerKinds.includes(r.trigger);
  }

  protected keysOf(r: FileActionRule): string {
    return modifierLabel(r.modifiers, this.platform());
  }

  protected modifierText(m: FileActionModifier): string {
    const platform = this.platform();
    return `${modifierName(m, platform)} ${this.t.modifierNames[platform === 'macos' ? 'macos' : 'other'][m]}`.trim();
  }

  protected setTrigger(kind: string): void {
    this.patch({ trigger: kind as FileActionTrigger });
  }

  /** Only known keys are written: unchecking clears an unknown one from a newer file. */
  protected setModifier(m: FileActionModifier, on: boolean): void {
    const r = this.current();
    if (!r) {
      return;
    }
    const rest = r.modifiers.filter((x) => x !== m);
    this.patch({ modifiers: normalizeModifiers(on ? [...rest, m] : rest) });
  }

  protected closeHelp(): void {
    this.help.set(false);
    setTimeout(() =>
      document.querySelector<HTMLElement>('app-file-actions-dialog .help-button')?.focus(),
    );
  }

  protected problemOf(r: FileActionRule): FileActionProblem | null {
    return this.problems().find((p) => p.id === r.id) ?? null;
  }

  protected rowId(i: number): string {
    return `fnf-fa-row-${i}`;
  }

  protected value(evt: Event): string {
    return (evt.target as HTMLInputElement).value;
  }

  protected checked(evt: Event): boolean {
    return (evt.target as HTMLInputElement).checked;
  }

  protected patch(p: Partial<FileActionRule>): void {
    const i = this.cursor();
    const id = this.rows()[i]?.id;
    this.rows.update((rows) => rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
    // the edit may have fixed it: Rust checks again on save
    this.problems.update((list) => list.filter((x) => x.id !== id));
    this.error.set('');
  }

  protected onListKey(evt: KeyboardEvent): void {
    const n = this.rows().length;
    const i = this.cursor();
    if (evt.altKey && (evt.key === 'ArrowUp' || evt.key === 'ArrowDown')) {
      evt.preventDefault();
      this.move(evt.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (evt.key === 'Delete') {
      evt.preventDefault();
      this.remove();
      return;
    }
    const next =
      evt.key === 'ArrowDown'
        ? Math.min(n - 1, i + 1)
        : evt.key === 'ArrowUp'
          ? Math.max(0, i - 1)
          : evt.key === 'Home'
            ? 0
            : evt.key === 'End'
              ? n - 1
              : -1;
    if (next < 0 || n === 0) {
      return;
    }
    evt.preventDefault();
    this.cursor.set(next);
    this.revealCursor();
  }

  /** The cursor row stays visible in the list of ten rows (E16). */
  private revealCursor(): void {
    const i = this.cursor();
    setTimeout(() =>
      document.getElementById(this.rowId(i))?.scrollIntoView?.({ block: 'nearest' }),
    );
  }

  protected onRowClick(evt: MouseEvent): void {
    const li = (evt.target as Element | null)?.closest?.<HTMLElement>('[data-index]');
    if (li) {
      this.cursor.set(Number(li.dataset['index']));
    }
  }

  private newId(): string {
    let id: string;
    do {
      id = `n${this.nextId++}`;
    } while (this.rows().some((r) => r.id === id));
    return id;
  }

  protected add(): void {
    const rows = this.rows();
    if (rows.length >= MAX_FILE_ACTIONS) {
      return;
    }
    const at = rows.length === 0 ? 0 : this.cursor() + 1;
    const rule: FileActionRule = {
      id: this.newId(),
      trigger: 'doubleClick',
      modifiers: [],
      pattern: '',
      // running something is what the user has to switch off, not on
      confirm: true,
      command: '',
      terminal: false,
    };
    this.rows.set([...rows.slice(0, at), rule, ...rows.slice(at)]);
    this.cursor.set(at);
    this.revealCursor();
    // the pattern is the next thing to type
    setTimeout(() =>
      document.querySelector<HTMLInputElement>('app-file-actions-dialog input.pattern')?.focus(),
    );
  }

  protected remove(): void {
    const rows = this.rows();
    if (rows.length === 0) {
      return;
    }
    this.rows.set(removeSlot(rows, this.cursor()));
    this.cursor.set(Math.max(0, Math.min(this.cursor(), rows.length - 2)));
    this.error.set('');
  }

  protected move(delta: number): void {
    const rows = this.rows();
    const moved = moveSlot(rows, this.cursor(), delta);
    if (moved !== rows) {
      this.rows.set(moved);
      this.cursor.update((c) => c + delta);
      this.revealCursor();
    }
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.store.save(this.rows());
      if (result.saved) {
        this.dialogs.close();
        return;
      }
      this.rows.set(result.rules);
      this.problems.set(result.problems);
      const bad = result.rules.findIndex((r) => r.id === result.problems[0]?.id);
      if (bad >= 0) {
        this.cursor.set(bad);
      }
      this.error.set(this.t.fixProblems);
    } catch (err) {
      this.error.set(this.t.saveFailed(errorText(toFsError(err))));
    } finally {
      this.busy.set(false);
    }
  }
}
