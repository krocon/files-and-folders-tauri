import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Shortcut as dark badges like the old version (mr `fnf-shortcut`, design 020 E2):
 * one badge per stroke, tokens joined by a dimmed `+`. Purely visual – the
 * accessible text is the plain shortcut on the host (`aria-label` of the item).
 */
@Component({
  selector: 'app-shortcut-badges',
  template: `
    @for (stroke of strokes(); track $index) {
      <b class="badge">
        @for (tok of stroke; track $index; let i = $index) {
          @if (i > 0) {
            <span class="plus">+</span>
          }
          <span>{{ tok }}</span>
        }
      </b>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      gap: 4px;
      flex: none;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      line-height: 16px;
      color: var(--color-shortcut-text);
      background: var(--color-shortcut-bg);
      border-radius: 4px;
    }
    .plus {
      font-weight: 300;
      opacity: 0.5;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
})
export class ShortcutBadges {
  readonly strokes = input.required<readonly (readonly string[])[]>();
}
