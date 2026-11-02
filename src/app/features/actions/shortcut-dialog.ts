import { ACT_TEXTS } from './actions-texts';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { ACTION_IDS, ACTIONS, ActionId, CATEGORY_LABELS } from '../../core/actions/action-catalog';
import { formatShortcut, strokeFromEvent, strokeToString } from '../../core/actions/shortcut';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { DialogKey } from '../../shared/dialog/dialog-key';
import { DIALOG_KEY_TEXTS } from '../../shared/dialog/dialog-key-texts';
import { fuzzyMatch } from './fuzzy';

/**
 * ⌨ Keyboard shortcuts: every action with its shortcuts on this OS; record a new
 * shortcut, remove it or reset to the default. Changes go to the override file
 * (merged per action, design 002 D4/D5). The full settings UI comes in 015.
 */
@Component({
  selector: 'app-shortcut-dialog',
  imports: [Modal, DialogKey],
  template: `
    <app-modal [heading]="t.shortcutsTitle" width="48rem" (closed)="dialogs.close()">
      <input
        data-autofocus
        class="search"
        type="search"
        [attr.aria-label]="t.searchActionsLabel"
        [placeholder]="t.searchPlaceholder"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{{ t.colAction }}</th>
              <th scope="col">{{ t.colShortcuts }}</th>
              <th scope="col">
                <span class="sr-only">{{ t.colChange }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.id) {
              <tr [class.unavailable]="!row.ready">
                <th scope="row">
                  {{ row.label }}
                  <span class="cat">{{ row.category }}</span>
                </th>
                <td>
                  @if (recording() === row.id) {
                    <em aria-live="assertive">{{ t.pressShortcut }}</em>
                  } @else {
                    @for (s of row.shortcuts; track s) {
                      <kbd>{{ s }}</kbd>
                    } @empty {
                      <span class="none">–</span>
                    }
                    @if (row.overridden) {
                      <span class="changed">{{ t.changed }}</span>
                    }
                  }
                </td>
                <td class="actions">
                  <button
                    type="button"
                    class="btn"
                    [attr.aria-label]="t.recordFor(row.label)"
                    (click)="record(row.id)"
                  >
                    {{ t.record }}
                  </button>
                  <button
                    type="button"
                    class="btn"
                    [attr.aria-label]="t.removeFor(row.label)"
                    [disabled]="row.shortcuts.length === 0"
                    (click)="clear(row.id)"
                  >
                    {{ t.remove }}
                  </button>
                  <button
                    type="button"
                    class="btn"
                    [attr.aria-label]="t.resetFor(row.label)"
                    [disabled]="!row.overridden"
                    (click)="reset(row.id)"
                  >
                    {{ t.reset }}
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <section class="in-dialogs" aria-labelledby="fnf-shortcuts-in-dialogs">
        <h3 id="fnf-shortcuts-in-dialogs">{{ k.inDialogs }}</h3>
        <dl>
          @for (row of dialogKeys(); track row.keys) {
            <dt>
              <kbd>{{ row.keys }}</kbd>
            </dt>
            <dd>{{ row.text }}</dd>
          }
        </dl>
      </section>
      @if (conflicts().length) {
        <ul class="conflicts" role="status">
          @for (c of conflicts(); track c) {
            <li>{{ c }}</li>
          }
        </ul>
      }
      <div class="buttons">
        <button appDialogKey="cancel" type="button" class="btn" (click)="dialogs.close()">
          {{ t.close }}
        </button>
      </div>
    </app-modal>
  `,
  styleUrl: './shortcut-dialog.css',
  host: { '(keydown)': 'onKeydown($event)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShortcutDialog {
  protected readonly t = ACT_TEXTS;
  protected readonly actions = inject(ActionService);
  protected readonly dialogs = inject(DialogService);
  protected readonly query = signal('');
  protected readonly recording = signal<ActionId | null>(null);

  protected readonly rows = computed(() => {
    const q = this.query();
    const platform = this.actions.platform();
    const override = this.actions.override();
    this.actions.keymap();
    return ACTION_IDS.filter((id) => fuzzyMatch(q, ACTIONS[id].label) !== null).map((id) => ({
      id,
      label: ACTIONS[id].label,
      category: CATEGORY_LABELS[ACTIONS[id].category],
      shortcuts: this.actions.shortcuts(id).map((s) => formatShortcut(s, platform)),
      overridden: Object.prototype.hasOwnProperty.call(override, id),
      ready: this.actions.state(id) !== 'unavailable',
    }));
  });

  protected readonly conflicts = computed(() => this.actions.keymap().conflicts);

  protected readonly k = DIALOG_KEY_TEXTS;
  /** Section "In dialogs" (design 057): the one key rule of all dialogs. */
  protected dialogKeys(): { keys: string; text: string }[] {
    const p = this.actions.platform();
    return [
      { keys: formatShortcut('Enter', p), text: this.k.enterKey },
      { keys: formatShortcut('Escape', p), text: this.k.escKey },
      { keys: formatShortcut('Mod+O', p), text: this.k.modKey },
      { keys: formatShortcut('Mod+Shift+D', p), text: this.k.modShiftKey },
    ];
  }

  protected record(id: ActionId): void {
    this.recording.set(id);
  }

  protected clear(id: ActionId): void {
    void this.actions.setOverride(id, []);
  }

  protected reset(id: ActionId): void {
    void this.actions.setOverride(id, null);
  }

  protected onKeydown(evt: KeyboardEvent): void {
    const id = this.recording();
    if (!id) {
      return;
    }
    evt.preventDefault();
    evt.stopPropagation();
    if (evt.key === 'Escape') {
      this.recording.set(null);
      return;
    }
    const stroke = strokeFromEvent(evt, this.actions.platform());
    if (!stroke) {
      return; // a modifier alone – wait for the key
    }
    this.recording.set(null);
    void this.actions.setOverride(id, [strokeToString(stroke)]);
  }
}
