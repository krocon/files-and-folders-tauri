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
    <app-modal
      [heading]="mark() ? 'Mark by pattern' : 'Unmark by pattern'"
      (closed)="dialogs.close()"
    >
      <form class="form" (submit)="apply($event)">
        <label class="field">
          <span>Pattern</span>
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
          <legend>Syntax</legend>
          <label
            ><input
              type="radio"
              name="mode"
              value="glob"
              [checked]="mode() === 'glob'"
              (change)="mode.set('glob')"
            />
            Wildcards</label
          >
          <label
            ><input
              type="radio"
              name="mode"
              value="regex"
              [checked]="mode() === 'regex'"
              (change)="mode.set('regex')"
            />
            Regular expression</label
          >
        </fieldset>
        <p id="fnf-pattern-help" class="help">
          @if (mode() === 'glob') {
            Terms separated by spaces, <code>*</code> and <code>?</code> as wildcards,
            <code>a|b</code> either, <code>-term</code> excludes. Without wildcard a term matches
            anywhere in the name.
          } @else {
            JavaScript regular expression, not case-sensitive, e.g. <code>\\.(jpe?g|png)$</code>.
          }
        </p>
        <div class="presets" role="group" aria-label="Presets">
          @for (p of presets; track p.label) {
            <button type="button" class="btn" (click)="usePreset(p.pattern)">{{ p.label }}</button>
          }
        </div>
        <p id="fnf-pattern-count" class="count" aria-live="polite">
          @if (compiled().error; as e) {
            <span class="error">Invalid: {{ e }}</span>
          } @else {
            Matches {{ count() }} of {{ total() }} displayed entries.
          }
        </p>
        <div class="buttons">
          <button type="button" class="btn" (click)="dialogs.close()">Cancel</button>
          <button type="submit" class="btn primary" [disabled]="!compiled().matches">
            {{ mark() ? 'Mark' : 'Unmark' }}
          </button>
        </div>
      </form>
    </app-modal>
  `,
  styleUrl: './dialog-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkPatternDialog {
  readonly mark = input(true);
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
