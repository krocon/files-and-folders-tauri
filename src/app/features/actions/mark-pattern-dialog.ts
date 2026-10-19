import { ACT_TEXTS } from './actions-texts';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { WorkspaceStore } from '../workspace/workspace.store';
import { compilePattern, defaultPattern, PATTERN_PRESETS, PatternMode } from './pattern';

/**
 * Num+ / Num−: mark or unmark the displayed entries whose name matches a glob
 * or regex pattern; presets of the old program; live count.
 */
@Component({
  selector: 'app-mark-pattern-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="mark() ? t.markTitle : t.unmarkTitle" (closed)="dialogs.close()">
      <form class="form" (submit)="apply($event)">
        <label class="field">
          <span>{{ t.pattern }}</span>
          <input
            data-autofocus
            type="text"
            spellcheck="false"
            [value]="text()"
            (input)="text.set($any($event.target).value)"
            [attr.aria-invalid]="compiled().error ? 'true' : null"
            aria-describedby="fnf-pattern-help fnf-pattern-count"
          />
        </label>
        <fieldset class="modes">
          <legend>{{ t.syntax }}</legend>
          <label
            ><input
              type="radio"
              name="mode"
              value="glob"
              [checked]="mode() === 'glob'"
              (change)="mode.set('glob')"
            />
            {{ t.wildcards }}</label
          >
          <label
            ><input
              type="radio"
              name="mode"
              value="regex"
              [checked]="mode() === 'regex'"
              (change)="mode.set('regex')"
            />
            {{ t.regex }}</label
          >
        </fieldset>
        <p id="fnf-pattern-help" class="help">
          {{ mode() === 'glob' ? t.helpGlob : t.helpRegex }}
        </p>
        <div class="presets" role="group" [attr.aria-label]="t.presets">
          @for (p of presets; track p.label) {
            <button type="button" class="btn" (click)="usePreset(p.pattern)">
              {{ t.presetNames[p.label] ?? p.label }}
            </button>
          }
        </div>
        <p id="fnf-pattern-count" class="count" aria-live="polite">
          @if (compiled().error; as e) {
            <span class="error">{{ t.invalid(e) }}</span>
          } @else {
            {{ t.matches(count(), total()) }}
          }
        </p>
        <div class="buttons">
          <button type="button" class="btn" (click)="dialogs.close()">{{ t.cancel }}</button>
          <button type="submit" class="btn primary" [disabled]="!compiled().matches">
            {{ mark() ? t.mark : t.unmark }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
  styleUrl: './dialog-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkPatternDialog {
  readonly mark = input(true);
  protected readonly t = ACT_TEXTS;
  protected readonly dialogs = inject(DialogService);
  private readonly ws = inject(WorkspaceStore);
  protected readonly presets = PATTERN_PRESETS;
  private readonly list = this.ws.panel()?.controller();

  protected readonly text = signal(defaultPattern(this.list?.cursorEntry()?.name));
  protected readonly mode = signal<PatternMode>('glob');
  protected readonly compiled = computed(() => compilePattern(this.text(), this.mode()));
  private readonly names = (this.list?.displayedEntries() ?? []).map((e) => e.name);
  protected readonly total = signal(this.names.length);
  protected readonly count = computed(() => {
    const m = this.compiled().matches;
    return m ? this.names.filter(m).length : 0;
  });

  protected usePreset(pattern: string): void {
    this.mode.set('glob');
    this.text.set(pattern);
  }

  protected apply(evt: Event): void {
    evt.preventDefault();
    const m = this.compiled().matches;
    if (!m) {
      return;
    }
    this.ws.panel()?.controller()?.markMatching(m, this.mark());
    this.dialogs.close();
  }
}
