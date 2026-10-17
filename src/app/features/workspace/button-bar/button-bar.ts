import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TEXTS } from '../texts';
import { buttonsFor } from './button-config';

interface ToolButton {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly prompt: string;
}

/**
 * Button bar (row 6 of `docs/ui-layout.md`) – skeleton: the function buttons of
 * the default set and the tool buttons on the right. None of the actions exist
 * yet, so all are dimmed (`aria-disabled`, still focusable) with a hint which
 * prompt brings them. Prompt 002 binds the actions and switches the modifier sets.
 */
@Component({
  selector: 'app-button-bar',
  template: `
    <div class="functions" role="toolbar" aria-label="Functions">
      @for (b of buttons; track b.id) {
        <button
          type="button"
          class="fbtn"
          aria-disabled="true"
          [attr.title]="b.label + ' – ' + texts.comingIn(b.prompt)"
        >
          <kbd class="badge">{{ b.key }}</kbd>
          <span>{{ b.label }}</span>
        </button>
      }
    </div>
    <div class="tools" role="toolbar" aria-label="Tools">
      @for (t of tools; track t.id) {
        <button
          type="button"
          class="fbtn"
          aria-disabled="true"
          [attr.aria-label]="t.label"
          [attr.title]="t.label + ' – ' + texts.comingIn(t.prompt)"
        >
          <span aria-hidden="true">{{ t.icon }}</span>
          @if (t.id !== 'theme' && t.id !== 'keys') {
            <span aria-hidden="true">{{ t.label }}</span>
          }
        </button>
      }
    </div>
  `,
  styleUrl: './button-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ButtonBar {
  protected readonly texts = TEXTS;
  protected readonly buttons = buttonsFor('default');
  protected readonly tools: readonly ToolButton[] = [
    { id: 'actions', label: 'Actions', icon: '▴', prompt: '002' },
    { id: 'tasks', label: 'Tasks', icon: '⚙', prompt: '005' },
    { id: 'theme', label: 'Theme', icon: '🎨', prompt: '013' },
    { id: 'keys', label: 'Keyboard shortcuts', icon: '⌨', prompt: '002' },
  ];
}
