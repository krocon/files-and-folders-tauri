import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ACTION_IDS, ACTIONS, ActionId, shortLabel } from '../../core/actions/action-catalog';
import { ActionService } from '../../core/actions/action.service';
import { badgeFor, HeldModifiers, NO_MODIFIERS } from '../../core/actions/shortcut';
import { MAX_BUTTON_SLOTS } from '../../core/config/config.models';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { fuzzyMatch } from '../actions/fuzzy';
import { ModifierSet, setsForPlatform } from '../workspace/button-bar/button-config';
import {
  addProblem,
  ButtonSets,
  insertSlot,
  moveSlot,
  removeSlot,
  replaceSlot,
  sameIds,
} from './button-config-logic';
import { ButtonConfigStore } from './button-config.store';
import { CONFIG_TEXTS } from './config-texts';

const MAX_MATCHES = 50;

/** Modifiers held for a set (badge of the preview). */
const HELD: Readonly<Record<ModifierSet, HeldModifiers>> = {
  default: NO_MODIFIERS,
  shift: { ...NO_MODIFIERS, shift: true },
  ctrl: { ...NO_MODIFIERS, mod: true },
  cmd: { ...NO_MODIFIERS, mod: true },
  alt: { ...NO_MODIFIERS, alt: true },
};

/**
 * Button configuration (OPEN_BUTTON_CONFIG_DLG, design 022 E3): per modifier set the
 * slots of the bar – a draft that "Save" writes to `buttons.json`. APG tabs for the
 * sets, a listbox for the slots, a combobox to choose an action.
 */
@Component({
  selector: 'app-button-config-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.buttonsTitle" width="46rem" (closed)="dialogs.close()">
      <div class="tool">
        <div class="body">
          <p class="intro">{{ t.buttonsIntro }}</p>
          @if (store.unknown().length > 0) {
            <p class="notice" role="note">{{ t.unknownNotice(store.unknown().join(', ')) }}</p>
          }
          <div class="tabs" role="tablist" [attr.aria-label]="t.setsLabel">
            @for (s of shownSets; track s) {
              <button
                type="button"
                role="tab"
                [id]="tabId(s)"
                [attr.aria-selected]="s === current()"
                [attr.aria-controls]="panelId"
                [attr.tabindex]="s === current() ? 0 : -1"
                [attr.data-set]="s"
                (click)="selectSet(s)"
                (keydown)="onTabKey($event)"
              >
                {{ t.setName(s, platform) }}
                @if (changed(s)) {
                  <span class="mark">({{ t.changed }})</span>
                }
              </button>
            }
          </div>
          <div
            class="panel"
            role="tabpanel"
            [id]="panelId"
            [attr.aria-labelledby]="tabId(current())"
          >
            <div class="field">
              <span class="preview-label">{{ t.preview }}</span>
              <div class="preview-bar" aria-hidden="true">
                @for (b of preview(); track $index) {
                  <span class="pbtn">
                    @if (b.badge) {
                      <kbd>{{ b.badge }}</kbd>
                    }
                    {{ b.label }}
                  </span>
                }
              </div>
            </div>
            <div class="editor">
              <div class="field side">
                <span [id]="slotsLabelId">{{ t.slots }}</span>
                <ul
                  class="listbox slots"
                  role="listbox"
                  tabindex="0"
                  [attr.aria-labelledby]="slotsLabelId"
                  [attr.aria-describedby]="slotsHelpId"
                  [attr.aria-activedescendant]="slots().length ? slotId(cursor()) : null"
                  (keydown)="onSlotKey($event)"
                  (click)="onSlotClick($event)"
                >
                  @for (id of slots(); track $index; let i = $index) {
                    <li
                      role="option"
                      [id]="slotId(i)"
                      [attr.aria-selected]="i === cursor()"
                      [attr.data-index]="i"
                    >
                      <span class="num" aria-hidden="true">{{ i + 1 }}</span>
                      <span class="grow">{{ label(id) }}</span>
                      @if (actions.shortcutLabel(id); as k) {
                        <kbd>{{ k }}</kbd>
                      }
                    </li>
                  } @empty {
                    <li class="empty" role="option" aria-selected="false" aria-disabled="true">
                      {{ t.noSlots }}
                    </li>
                  }
                </ul>
                <p class="help" [id]="slotsHelpId">{{ t.slotsHelp }}</p>
                <div class="stack">
                  <button type="button" class="btn" [disabled]="cursor() <= 0" (click)="move(-1)">
                    {{ t.moveUp }}
                  </button>
                  <button
                    type="button"
                    class="btn"
                    [disabled]="cursor() >= slots().length - 1"
                    (click)="move(1)"
                  >
                    {{ t.moveDown }}
                  </button>
                  <button
                    type="button"
                    class="btn"
                    [disabled]="slots().length === 0"
                    (click)="remove()"
                  >
                    {{ t.remove }}
                  </button>
                </div>
              </div>
              <div class="side">
                <label class="field combo">
                  <span>{{ t.action }}</span>
                  <input
                    data-autofocus
                    type="text"
                    role="combobox"
                    spellcheck="false"
                    autocomplete="off"
                    aria-autocomplete="list"
                    [attr.aria-expanded]="popup()"
                    [attr.aria-controls]="popup() ? listId : null"
                    [attr.aria-activedescendant]="
                      popup() && matches().length ? optionId(active()) : null
                    "
                    [attr.aria-describedby]="problemId"
                    [placeholder]="t.actionPlaceholder"
                    [value]="query()"
                    (input)="onInput($event)"
                    (keydown)="onComboKey($event)"
                    (blur)="popup.set(false)"
                  />
                  @if (popup()) {
                    <ul class="popup" role="listbox" [id]="listId" [attr.aria-label]="t.action">
                      @for (m of matches(); track m.id; let i = $index) {
                        <li
                          role="option"
                          [id]="optionId(i)"
                          [class.active]="i === active()"
                          [attr.aria-selected]="i === active()"
                          [attr.data-pick]="i"
                        >
                          <span>{{ m.label }}</span>
                          <span class="muted">{{ m.id }}</span>
                        </li>
                      } @empty {
                        <li class="empty" role="option" aria-selected="false" aria-disabled="true">
                          {{ t.noMatch }}
                        </li>
                      }
                    </ul>
                  }
                </label>
                <div class="stack">
                  <button
                    type="button"
                    class="btn"
                    [disabled]="addBlocked() !== null"
                    (click)="add()"
                  >
                    {{ t.add }}
                  </button>
                  <button type="button" class="btn" [disabled]="!canReplace()" (click)="replace()">
                    {{ t.replace }}
                  </button>
                </div>
                <p class="help" [id]="problemId">{{ problemText() }}</p>
              </div>
            </div>
          </div>
        </div>
        <p class="error" role="alert">{{ error() }}</p>
        <div class="foot">
          <button type="button" class="btn" [disabled]="!changed(current())" (click)="resetSet()">
            {{ t.resetSet }}
          </button>
          <button type="button" class="btn" [disabled]="!anyChanged()" (click)="resetAll()">
            {{ t.resetAll }}
          </button>
          <div class="buttons">
            <button type="button" class="btn" (click)="dialogs.close()">{{ t.cancel }}</button>
            <button type="button" class="btn primary" [disabled]="busy()" (click)="save()">
              {{ t.save }}
            </button>
          </div>
        </div>
      </div>
    </app-modal>
  `,
  styleUrls: ['../../shared/dialog/tool-dialog.css', './config-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(pointerdown)': 'onPointerDown($event)',
    '(click)': 'onPickClick($event)',
  },
})
export class ButtonConfigDialog {
  protected readonly t = CONFIG_TEXTS;
  protected readonly store = inject(ButtonConfigStore);
  protected readonly actions = inject(ActionService);
  protected readonly dialogs = inject(DialogService);
  protected readonly platform = this.actions.platform();
  protected readonly shownSets = setsForPlatform(this.platform);
  protected readonly panelId = 'fnf-btncfg-panel';
  protected readonly listId = 'fnf-btncfg-actions';
  protected readonly slotsLabelId = 'fnf-btncfg-slots-label';
  protected readonly slotsHelpId = 'fnf-btncfg-slots-help';
  protected readonly problemId = 'fnf-btncfg-problem';

  /** The sets being edited ("Save" writes them). */
  protected readonly draft = signal<ButtonSets>({ ...this.store.sets() });
  protected readonly current = signal<ModifierSet>('default');
  protected readonly cursor = signal(0);
  protected readonly slots = computed(() => this.draft()[this.current()]);

  protected readonly query = signal('');
  protected readonly popup = signal(false);
  protected readonly active = signal(0);
  protected readonly picked = signal<ActionId | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  protected readonly matches = computed(() => {
    const q = this.query();
    const rows: { id: ActionId; label: string; score: number }[] = [];
    for (const id of ACTION_IDS) {
      const label = ACTIONS[id].label;
      const m = fuzzyMatch(q, `${label} ${id}`);
      if (m) {
        rows.push({ id, label, score: m.score });
      }
    }
    if (q.trim()) {
      rows.sort((a, b) => b.score - a.score);
    }
    return rows.slice(0, MAX_MATCHES);
  });

  protected readonly preview = computed(() => {
    const held = HELD[this.current()];
    this.actions.keymap();
    return this.slots().map((id) => ({
      label: shortLabel(id),
      badge: badgeFor(this.actions.shortcuts(id), held, this.platform),
    }));
  });

  protected readonly addBlocked = computed(() => addProblem(this.slots(), this.picked()));
  protected readonly canReplace = computed(() => {
    const id = this.picked();
    const list = this.slots();
    return id !== null && list.length > 0 && replaceSlot(list, this.cursor(), id) !== list;
  });
  protected readonly problemText = computed(() => {
    switch (this.addBlocked()) {
      case 'none':
        return this.t.problemNone;
      case 'full':
        return this.t.problemFull(MAX_BUTTON_SLOTS);
      case 'present':
        return this.t.problemPresent;
      default:
        return '';
    }
  });

  protected label(id: ActionId): string {
    return ACTIONS[id].label;
  }

  protected tabId(set: ModifierSet): string {
    return `fnf-btncfg-tab-${set}`;
  }

  protected slotId(i: number): string {
    return `fnf-btncfg-slot-${i}`;
  }

  protected optionId(i: number): string {
    return `${this.listId}-${i}`;
  }

  protected changed(set: ModifierSet): boolean {
    return !sameIds(this.draft()[set], this.store.builtIn[set]);
  }

  protected anyChanged(): boolean {
    return this.shownSets.some((s) => this.changed(s));
  }

  protected selectSet(set: ModifierSet): void {
    this.current.set(set);
    this.cursor.set(0);
  }

  /** APG tabs: arrows/Home/End move the selection and the focus. */
  protected onTabKey(evt: KeyboardEvent): void {
    const i = this.shownSets.indexOf(this.current());
    const n = this.shownSets.length;
    const next =
      evt.key === 'ArrowRight'
        ? (i + 1) % n
        : evt.key === 'ArrowLeft'
          ? (i - 1 + n) % n
          : evt.key === 'Home'
            ? 0
            : evt.key === 'End'
              ? n - 1
              : -1;
    if (next < 0) {
      return;
    }
    evt.preventDefault();
    const set = this.shownSets[next];
    this.selectSet(set);
    (evt.currentTarget as HTMLElement)
      .closest('[role="tablist"]')
      ?.querySelector<HTMLElement>(`[data-set="${set}"]`)
      ?.focus();
  }

  private setSlots(list: readonly ActionId[]): void {
    this.draft.update((d) => ({ ...d, [this.current()]: list }));
  }

  protected onSlotKey(evt: KeyboardEvent): void {
    const n = this.slots().length;
    const i = this.cursor();
    if (evt.altKey && (evt.key === 'ArrowUp' || evt.key === 'ArrowDown')) {
      evt.preventDefault();
      this.move(evt.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    let next: number;
    switch (evt.key) {
      case 'ArrowDown':
        next = Math.min(n - 1, i + 1);
        break;
      case 'ArrowUp':
        next = Math.max(0, i - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = n - 1;
        break;
      case 'Delete':
      case 'Backspace':
        evt.preventDefault();
        this.remove();
        return;
      default:
        return;
    }
    evt.preventDefault();
    if (n > 0) {
      this.cursor.set(next);
      this.scrollTo(this.slotId(next));
    }
  }

  protected onSlotClick(evt: MouseEvent): void {
    const li = (evt.target as Element | null)?.closest?.<HTMLElement>('[data-index]');
    if (li) {
      this.cursor.set(Number(li.dataset['index']));
    }
  }

  /** A suggestion keeps the focus in the combobox (pointerdown) and is picked on click. */
  protected onPointerDown(evt: PointerEvent): void {
    if ((evt.target as Element | null)?.closest?.('[data-pick]')) {
      evt.preventDefault();
    }
  }

  protected onPickClick(evt: MouseEvent): void {
    const li = (evt.target as Element | null)?.closest?.<HTMLElement>('[data-pick]');
    if (li) {
      this.pick(Number(li.dataset['pick']));
    }
  }

  protected move(delta: number): void {
    const list = this.slots();
    const moved = moveSlot(list, this.cursor(), delta);
    if (moved !== list) {
      this.setSlots(moved);
      this.cursor.update((c) => c + delta);
    }
  }

  protected remove(): void {
    const list = this.slots();
    if (list.length === 0) {
      return;
    }
    this.setSlots(removeSlot(list, this.cursor()));
    this.cursor.set(Math.max(0, Math.min(this.cursor(), list.length - 2)));
  }

  protected onInput(evt: Event): void {
    this.query.set((evt.target as HTMLInputElement).value);
    this.picked.set(null);
    this.active.set(0);
    this.popup.set(true);
  }

  /** APG combobox: ↓/↑ in the list, Enter picks (or adds the picked action), Esc closes the list first. */
  protected onComboKey(evt: KeyboardEvent): void {
    const n = this.matches().length;
    switch (evt.key) {
      case 'ArrowDown':
        evt.preventDefault();
        if (!this.popup()) {
          this.popup.set(true);
        } else if (n > 0) {
          this.active.set((this.active() + 1) % n);
        }
        break;
      case 'ArrowUp':
        evt.preventDefault();
        if (this.popup() && n > 0) {
          this.active.set((this.active() - 1 + n) % n);
        }
        break;
      case 'Enter':
        evt.preventDefault();
        if (this.popup() && n > 0) {
          this.pick(this.active());
        } else if (this.addBlocked() === null) {
          this.add();
        }
        break;
      case 'Escape':
        if (this.popup()) {
          evt.preventDefault();
          evt.stopPropagation();
          this.popup.set(false);
        }
        break;
    }
    if (this.popup() && (evt.key === 'ArrowDown' || evt.key === 'ArrowUp')) {
      this.scrollTo(this.optionId(this.active()));
    }
  }

  protected pick(i: number): void {
    const m = this.matches()[i];
    if (!m) {
      return;
    }
    this.picked.set(m.id);
    this.query.set(m.label);
    this.popup.set(false);
  }

  protected add(): void {
    const id = this.picked();
    if (id === null || this.addBlocked() !== null) {
      return;
    }
    const list = this.slots();
    const at = list.length === 0 ? -1 : this.cursor();
    this.setSlots(insertSlot(list, at, id));
    this.cursor.set(at + 1);
  }

  protected replace(): void {
    const id = this.picked();
    if (id !== null) {
      this.setSlots(replaceSlot(this.slots(), this.cursor(), id));
    }
  }

  protected resetSet(): void {
    this.setSlots(this.store.builtIn[this.current()]);
    this.cursor.set(0);
  }

  protected resetAll(): void {
    const d = { ...this.draft() };
    for (const s of this.shownSets) {
      d[s] = this.store.builtIn[s];
    }
    this.draft.set(d);
    this.cursor.set(0);
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.store.save(this.draft());
      this.dialogs.close();
    } catch (err) {
      this.error.set(this.t.saveFailed(errorText(toFsError(err))));
    } finally {
      this.busy.set(false);
    }
  }

  private scrollTo(id: string): void {
    setTimeout(() => document.getElementById(id)?.scrollIntoView?.({ block: 'nearest' }));
  }
}
