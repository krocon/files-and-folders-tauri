import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { ThemeService } from '../../core/theme/theme.service';
import { Theme } from '../../core/theme/theme.models';
import { DialogKey } from '../../shared/dialog/dialog-key';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { groupOf, matchesFilter, PickerCard, PickerGroup } from './theme-picker-logic';
import { THEME_TEXTS } from './theme-texts';
import { ThemeThumb } from './theme-thumb';

/** Columns assumed when the layout cannot be measured (tests without layout). */
const FALLBACK_COLUMNS = 4;

interface Section {
  readonly group: PickerGroup | 'system';
  readonly label: string;
  readonly cards: readonly PickerCard[];
}

/**
 * Colour scheme picker (design 070): a grid of thumbnails, „Follow the system“ first. Arrow
 * keys and the pointer try a scheme at once (the theme service's preview), Enter/OK keeps
 * it, Esc/Cancel goes back to the scheme before; a filter in the head narrows the cards.
 */
@Component({
  selector: 'app-theme-picker',
  imports: [Modal, DialogKey, ThemeThumb],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [heading]="t.pickerTitle" width="min(58rem, 94vw)" (closed)="cancel()">
      <div class="filter">
        <label for="fnf-theme-filter">{{ t.pickerFilter }}</label>
        <input
          id="fnf-theme-filter"
          type="search"
          spellcheck="false"
          autocomplete="off"
          [placeholder]="t.pickerFilterPlaceholder"
          [value]="filter()"
          (input)="onFilter($any($event.target).value)"
          (keydown)="onFilterKey($event)"
        />
        <span class="count" role="status">{{ t.pickerCount(visible().length) }}</span>
      </div>
      <div
        class="grid"
        role="listbox"
        tabindex="-1"
        [attr.aria-label]="t.pickerList"
        [attr.aria-activedescendant]="current() ? optionId(current()!) : null"
        (keydown)="onGridKey($event)"
        (pointerleave)="hovered.set(null)"
      >
        @for (s of sections(); track s.group) {
          <div class="section" role="group" [attr.aria-label]="s.label">
            @if (s.group !== 'system') {
              <div class="section-head" aria-hidden="true">{{ s.label }}</div>
            }
            <div class="cards">
              @for (c of s.cards; track c.id) {
                <div
                  class="card"
                  role="option"
                  [id]="optionId(c.id)"
                  [attr.data-id]="c.id"
                  [attr.aria-selected]="c.id === current()"
                  [class.chosen]="c.id === current()"
                  [tabindex]="c.id === current() ? 0 : -1"
                  (click)="choose(c.id)"
                  (keydown.space)="$event.preventDefault(); choose(c.id)"
                  (dblclick)="ok()"
                  (pointerenter)="hovered.set(c.id)"
                >
                  @if (c.id === 'system') {
                    <div class="split">
                      @if (systemPair(); as pair) {
                        <app-theme-thumb [theme]="pair.light" />
                        <app-theme-thumb [theme]="pair.dark" />
                      }
                    </div>
                  } @else if (themeOf(c.id); as theme) {
                    <app-theme-thumb class="thumb" [theme]="theme" />
                  }
                  <span class="name">{{ c.name }}</span>
                  @if (c.id !== 'system') {
                    <span class="kind">{{ c.dark ? t.wordDark : t.wordLight }}</span>
                  }
                </div>
              }
            </div>
          </div>
        }
        @if (visible().length === 0) {
          <p class="none" role="status">{{ t.pickerNone }}</p>
        }
      </div>
      <p class="hint">{{ t.pickerHint }}</p>
      <div class="buttons">
        <button type="button" class="btn link" appDialogKey="secondary:E" (click)="edit()">
          {{ t.menuEdit }}
        </button>
        <span class="spacer"></span>
        <button type="button" class="btn" appDialogKey="cancel" (click)="cancel()">
          {{ t.cancel }}
        </button>
        <button
          type="button"
          class="btn primary"
          appDialogKey="primary"
          [disabled]="current() === null"
          (click)="ok()"
        >
          {{ t.ok }}
        </button>
      </div>
    </app-modal>
  `,
  styleUrl: './theme-picker.css',
})
export class ThemePicker {
  protected readonly t = THEME_TEXTS;
  private readonly theme = inject(ThemeService);
  private readonly dialogs = inject(DialogService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The scheme on screen before the picker opened (Esc goes back to it). */
  private readonly before =
    this.theme.selection().mode === 'system' ? 'system' : this.theme.active().id;
  protected readonly filter = signal('');
  /** The chosen card (keyboard, click). */
  protected readonly current = signal<string | null>(this.before);
  /** The card under the pointer: tried while it is there. */
  protected readonly hovered = signal<string | null>(null);
  private done = false;

  protected readonly sections = computed<Section[]>(() => {
    const t = this.t;
    const words = (group: string) => ({ light: t.wordLight, dark: t.wordDark, group });
    const card = (th: Theme): PickerCard => ({
      id: th.id,
      name: th.name,
      dark: th.dark,
      group: groupOf(th),
    });
    const f = this.filter();
    const system: PickerCard = { id: 'system', name: t.menuFollow, dark: false, group: 'system' };
    const all: Section[] = [
      { group: 'system', label: t.menuFollow, cards: [system] },
      { group: 'own', label: t.groupOwn, cards: [] },
      { group: 'builtIn', label: t.groupBuiltIn, cards: [] },
      { group: 'classic', label: t.groupClassic, cards: [] },
    ];
    for (const th of this.theme.themes()) {
      const c = card(th);
      (all.find((s) => s.group === c.group)!.cards as PickerCard[]).push(c);
    }
    return all
      .map((s) => ({
        ...s,
        cards: s.cards.filter((c) => f.trim() === '' || matchesFilter(c, f, words(s.label))),
      }))
      .filter((s) => s.cards.length > 0);
  });

  protected readonly visible = computed(() => this.sections().flatMap((s) => s.cards));

  /** The light and dark scheme "Follow the system" uses (for its split thumbnail). */
  protected readonly systemPair = computed(() => {
    const s = this.theme.selection();
    const light = this.theme.find(s.light);
    const dark = this.theme.find(s.dark);
    return light && dark ? { light, dark } : null;
  });

  constructor() {
    // what is tried is shown at once: the pointer wins over the chosen card
    const stop = this.theme.preview;
    inject(DestroyRef).onDestroy(() => stop.set(null));
    afterNextRender(() => this.focusCurrent());
  }

  protected themeOf(id: string): Theme | undefined {
    return this.theme.find(id);
  }

  protected optionId(id: string): string {
    return `fnf-theme-option-${id}`;
  }

  protected onFilter(value: string): void {
    this.filter.set(value);
    const cards = this.visible();
    if (cards.length > 0 && !cards.some((c) => c.id === this.current())) {
      this.try(cards[0].id);
    }
  }

  protected onFilterKey(evt: KeyboardEvent): void {
    if (evt.key === 'ArrowDown' && this.visible().length > 0) {
      evt.preventDefault();
      this.focusCurrent();
    }
  }

  protected onGridKey(evt: KeyboardEvent): void {
    const cards = this.visible();
    const i = cards.findIndex((c) => c.id === this.current());
    const cols = this.columns();
    const move: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: cols,
      ArrowUp: -cols,
    };
    if (evt.key in move) {
      evt.preventDefault();
      const next = Math.min(cards.length - 1, Math.max(0, (i < 0 ? 0 : i) + move[evt.key]));
      if (evt.key === 'ArrowUp' && i >= 0 && i < cols) {
        this.focusFilter();
        return;
      }
      this.try(cards[next]?.id ?? null);
      this.focusCurrent();
    } else if (evt.key === 'Home' || evt.key === 'End') {
      evt.preventDefault();
      this.try(cards[evt.key === 'Home' ? 0 : cards.length - 1]?.id ?? null);
      this.focusCurrent();
    } else if (evt.key === 'Enter' && !evt.repeat) {
      evt.preventDefault();
      this.ok();
    }
  }

  protected choose(id: string): void {
    this.try(id);
    this.focusCurrent();
  }

  /** Enter / OK: keeps the chosen scheme (saved like every choice). */
  protected ok(): void {
    const id = this.current();
    if (id === null) {
      return;
    }
    this.done = true;
    this.theme.preview.set(null);
    void (id === 'system' ? this.theme.followSystem() : this.theme.select(id));
    this.dialogs.close();
  }

  /** Esc / Cancel / closing: the scheme from before stays. */
  protected cancel(): void {
    if (!this.done) {
      this.theme.preview.set(null);
    }
    this.dialogs.close();
  }

  /** "Edit colour schemes…": the editor (it starts from the active scheme). */
  protected edit(): void {
    this.theme.preview.set(null);
    this.done = true;
    this.dialogs.close();
    setTimeout(() => this.dialogs.show('themes'));
  }

  /** Chooses `id` and shows it. */
  private try(id: string | null): void {
    this.current.set(id);
    this.theme.preview.set(id === null ? null : this.draftOf(id));
  }

  private draftOf(id: string): Theme | null {
    if (id !== 'system') {
      return this.theme.find(id) ?? null;
    }
    const pair = this.systemPair();
    return pair ? (this.theme.systemDark() ? pair.dark : pair.light) : null;
  }

  /** Cards per row, measured from the layout (cards of the first row share their top). */
  private columns(): number {
    const cards = [...this.host.nativeElement.querySelectorAll<HTMLElement>('.cards .card')];
    const first = cards.find((c) => c.dataset['id'] !== 'system');
    if (!first) {
      return FALLBACK_COLUMNS;
    }
    const top = first.offsetTop;
    const row = cards.filter((c) => c.dataset['id'] !== 'system' && c.offsetTop === top);
    return row.length === 0 || (top === 0 && row.length === cards.length - 1)
      ? FALLBACK_COLUMNS
      : row.length;
  }

  private focusCurrent(): void {
    const id = this.current();
    const el = id
      ? this.host.nativeElement.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
      : null;
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  }

  private focusFilter(): void {
    this.host.nativeElement.querySelector<HTMLInputElement>('#fnf-theme-filter')?.focus();
  }
}
