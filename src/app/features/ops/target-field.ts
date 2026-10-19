import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { ContextMenu, MenuCloseReason, MenuItem } from '../workspace/context-menu';
import { TargetOption } from './ops-logic';

let fieldCounter = 0;

/**
 * Target folder of Copy/Move, Pack and Unpack: a text field and a "…" button right of it
 * that opens the suggestions (other panel, tabs, favourites, recent) as a menu grouped by
 * origin. Replaces the separate "Suggestions" select (Marc 2026-10-19).
 */
@Component({
  selector: 'app-target-field',
  imports: [ContextMenu],
  template: `
    <div class="field">
      <label [attr.for]="inputId">{{ label() }}</label>
      <div class="row">
        <input
          [id]="inputId"
          [attr.data-autofocus]="autofocus() ? '' : null"
          type="text"
          spellcheck="false"
          autocomplete="off"
          [value]="value()"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [attr.aria-describedby]="describedBy() || null"
          (input)="valueChange.emit($any($event.target).value)"
        />
        @if (targets().length > 0) {
          <button
            type="button"
            class="btn pick"
            aria-haspopup="menu"
            [attr.aria-expanded]="menu() !== null"
            [attr.aria-label]="suggestionsLabel()"
            (click)="toggle($event)"
          >
            …
          </button>
        }
      </div>
    </div>
    @if (menu(); as m) {
      <app-context-menu
        [items]="items()"
        [x]="m.x"
        [y]="m.y"
        [label]="suggestionsLabel()"
        [anchor]="m.anchor"
        (chosen)="choose($event)"
        (closed)="onClosed($event)"
      />
    }
  `,
  styleUrls: ['./ops-dialog.css', './target-field.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TargetField {
  readonly label = input.required<string>();
  readonly suggestionsLabel = input.required<string>();
  readonly value = input('');
  readonly targets = input<readonly TargetOption[]>([]);
  readonly autofocus = input(false);
  readonly invalid = input(false);
  readonly describedBy = input('');
  readonly valueChange = output<string>();

  protected readonly inputId = `fnf-target-${++fieldCounter}`;
  protected readonly menu = signal<{ x: number; y: number; anchor: Element } | null>(null);

  /** Suggestions grouped by origin, each group with a heading. */
  protected readonly items = computed<MenuItem[]>(() => {
    const out: MenuItem[] = [];
    let group: string | null = null;
    this.targets().forEach((o, i) => {
      if (o.group !== group) {
        group = o.group;
        out.push({ id: `h:${i}`, label: o.group, heading: true });
      }
      out.push({ id: `t:${i}`, label: o.path });
    });
    return out;
  });

  protected toggle(evt: MouseEvent): void {
    if (this.menu()) {
      this.menu.set(null);
      return;
    }
    const anchor = evt.currentTarget as HTMLElement;
    // under the text field, left-aligned with it (long paths have room)
    const field = document.getElementById(this.inputId) ?? anchor;
    const rect = field.getBoundingClientRect();
    this.menu.set({ x: rect.left, y: rect.bottom + 2, anchor });
  }

  protected choose(id: string): void {
    const path = this.targets()[Number(id.slice(2))]?.path;
    this.menu.set(null);
    if (path !== undefined) {
      this.valueChange.emit(path);
    }
    this.focusInput();
  }

  protected onClosed(reason: MenuCloseReason): void {
    const anchor = this.menu()?.anchor as HTMLElement | undefined;
    this.menu.set(null);
    if (reason !== 'outside') {
      anchor?.focus();
    }
  }

  private focusInput(): void {
    setTimeout(() => document.getElementById(this.inputId)?.focus());
  }
}
