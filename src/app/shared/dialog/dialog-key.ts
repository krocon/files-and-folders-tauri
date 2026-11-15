import {
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  InjectionToken,
  input,
  Signal,
  signal,
} from '@angular/core';
import { SettingsStore } from '../../core/settings/settings.store';
import type { Mnemonic } from './mnemonic';
import { formatShortcut, formatStroke, parseShortcut } from '../../core/actions/shortcut';
import { detectPlatform, Platform } from '../../core/actions/platform';
import { DIALOG_KEY_TEXTS } from './dialog-key-texts';
import { Modal } from './modal';

/**
 * Keys of dialog buttons (design 057): one declarative role per button, the
 * {@link Modal} evaluates the keys centrally.
 *
 * - `primary` – Enter, wherever the focus is in the dialog (exceptions: design 057 E2).
 * - `cancel` – marker for Esc (the modal's `closed` does the work): tooltip and ARIA only.
 * - `secondary:<L>` – `Mod+<L>` (⌘ on macOS, Ctrl elsewhere).
 * - `destructive:<L>` – `Mod+Shift+<L>`: irreversible actions (delete permanently). Never Enter.
 * - `hint:<keys>` – display only (design 076 E3): the dialog handles the keys itself
 *   (`F7`, `Shift+F7`, `0`); the button just shows them.
 * - `null`/`''` – no role (a role that only applies in some states).
 *
 * Every button with a role shows its key permanently as a small keycap after the label
 * (design 076 E1) – `↩`/`Enter`, `Esc`, `⌘D`/`Ctrl+D`, `⇧⌘D`/`Ctrl+Shift+D`.
 *
 * The letter is fixed in the template (language independent, design 057 E3) and must
 * not be one of {@link RESERVED_DIALOG_LETTERS}.
 */
export type DialogKeySpec =
  | 'primary'
  | 'cancel'
  | `secondary:${string}`
  | `destructive:${string}`
  | `hint:${string}`
  | ''
  | null;

export interface DialogKeyRole {
  readonly role: 'primary' | 'cancel' | 'secondary' | 'destructive' | 'hint';
  /** `A`–`Z` for secondary/destructive. */
  readonly letter: string | null;
  /** The keys of a `hint` in keymap notation (`Shift+F7`). */
  readonly keys?: string;
}

/**
 * Never a dialog shortcut: text editing in fields (`A C V X Y Z`) and macOS system
 * keys (`Q W H M`) (design 057 E3).
 */
export const RESERVED_DIALOG_LETTERS: ReadonlySet<string> = new Set([
  'A',
  'C',
  'V',
  'X',
  'Y',
  'Z',
  'Q',
  'W',
  'H',
  'M',
]);

/** Parses a role; `null` for no role or an invalid/reserved letter. Pure. */
export function parseDialogKey(spec: DialogKeySpec | undefined): DialogKeyRole | null {
  if (spec === 'primary' || spec === 'cancel') {
    return { role: spec, letter: null };
  }
  if (spec?.startsWith('hint:')) {
    const keys = spec.slice(5);
    // any platform will do – this only checks the notation
    return parseShortcut(keys, 'linux') ? { role: 'hint', letter: null, keys } : null;
  }
  const m = /^(secondary|destructive):([A-Za-z])$/.exec(spec ?? '');
  if (!m) {
    return null;
  }
  const letter = m[2].toUpperCase();
  if (RESERVED_DIALOG_LETTERS.has(letter)) {
    return null;
  }
  return { role: m[1] as 'secondary' | 'destructive', letter };
}

/**
 * First letter of a (translated) label that may be a dialog key – for dialogs whose
 * label changes (the confirmation dialog); `null` if there is none. Pure.
 */
export function letterFor(label: string): string | null {
  for (const ch of label.normalize('NFD').toUpperCase()) {
    if (/^[A-Z]$/.test(ch) && !RESERVED_DIALOG_LETTERS.has(ch)) {
      return ch;
    }
  }
  return null;
}

/** The OS for dialog keys (a token so tests can switch to macOS). */
export const DIALOG_PLATFORM = new InjectionToken<Platform>('DIALOG_PLATFORM', {
  providedIn: 'root',
  factory: () => detectPlatform(),
});

/**
 * How buttons show their keys (setting `view.dialogKeys`, design 076 E4): a keycap
 * after the label, or an underlined letter for `Alt+<letter>`. A token so tests can
 * switch without the settings store.
 */
export type DialogKeyStyle = 'keycap' | 'underline';
export const DIALOG_KEY_STYLE = new InjectionToken<Signal<DialogKeyStyle>>('DIALOG_KEY_STYLE', {
  providedIn: 'root',
  factory: () => {
    const settings = inject(SettingsStore);
    return computed(() => settings.get('view.dialogKeys'));
  },
});

/** Roles that get an underlined letter; destructive and hint buttons keep the keycap. */
export function takesMnemonic(role: DialogKeyRole | null): boolean {
  return role?.role === 'primary' || role?.role === 'cancel' || role?.role === 'secondary';
}

/** `aria-keyshortcuts` value of a role (ARIA names: `Meta`, `Control`, `Shift`). */
export function ariaKeysFor(role: DialogKeyRole, platform: Platform): string {
  switch (role.role) {
    case 'primary':
      return 'Enter';
    case 'cancel':
      return 'Escape';
    case 'hint':
      return ''; // the template states its own aria-keyshortcuts
    default: {
      const mod = platform === 'macos' ? 'Meta' : 'Control';
      return `${mod}+${role.role === 'destructive' ? 'Shift+' : ''}${role.letter}`;
    }
  }
}

/** Display of a role's key: `⌘⇧D` / `Ctrl+Shift+D`, `↩`/`Enter`, `Esc`. */
export function displayKeysFor(role: DialogKeyRole, platform: Platform): string {
  if (role.role === 'hint') {
    return formatShortcut(role.keys ?? '', platform);
  }
  const key = role.role === 'primary' ? 'Enter' : role.role === 'cancel' ? 'Escape' : role.letter!;
  const command = role.role === 'secondary' || role.role === 'destructive';
  return formatStroke(
    { mod: command, ctrl: false, alt: false, shift: role.role === 'destructive', key },
    platform,
  );
}

@Directive({
  selector: '[appDialogKey]',
  host: {
    '[attr.aria-keyshortcuts]': 'ariaKeys()',
    '[attr.title]': 'tooltip()',
    '[attr.data-dialog-key]': 'badge()',
    '[attr.data-mnemonic]': 'mnemonic()?.letter ?? null',
    '[class.fnf-dialog-key]': 'true',
  },
})
export class DialogKey {
  readonly appDialogKey = input<DialogKeySpec>(null);
  /** More `aria-keyshortcuts` of the button that change (the conflict dialog's Alt letters). */
  readonly appDialogKeyExtra = input<string | null>(null);
  readonly el = inject<ElementRef<HTMLButtonElement>>(ElementRef).nativeElement;
  private readonly modal = inject(Modal, { optional: true });
  private readonly platform = inject(DIALOG_PLATFORM);
  private readonly style = inject(DIALOG_KEY_STYLE);
  /** The underlined letter, set by the {@link Modal} (design 076 E4). */
  readonly mnemonic = signal<Mnemonic | null>(null);
  /** What the template set statically (kept, the key is added). */
  private readonly ownAria = this.el.getAttribute('aria-keyshortcuts');
  private readonly ownTitle = this.el.getAttribute('title');

  readonly role = computed(() => parseDialogKey(this.appDialogKey()));

  protected readonly ariaKeys = computed(() => {
    const r = this.role();
    const keys = r ? ariaKeysFor(r, this.platform) : null;
    const m = this.mnemonic();
    const alt = m ? `Alt+${m.letter}` : null;
    return [keys, alt, this.ownAria, this.appDialogKeyExtra()].filter(Boolean).join(' ') || null;
  });

  protected readonly tooltip = computed(() => {
    const r = this.role();
    if (!r) {
      return this.ownTitle;
    }
    const m = this.mnemonic();
    const shown = m
      ? formatStroke(
          { mod: false, ctrl: false, alt: true, shift: false, key: m.letter },
          this.platform,
        )
      : displayKeysFor(r, this.platform);
    const keys = DIALOG_KEY_TEXTS.shortcut(shown);
    return this.ownTitle ? `${this.ownTitle} (${keys})` : keys;
  });

  /** The keycap after the label (design 076 E1), always shown. */
  protected readonly badge = computed(() => {
    const r = this.role();
    if (!r || (this.style() === 'underline' && takesMnemonic(r))) {
      return null;
    }
    return displayKeysFor(r, this.platform);
  });

  constructor() {
    if (this.modal) {
      this.modal.register(this);
      inject(DestroyRef).onDestroy(() => this.modal?.unregister(this));
    }
  }

  /**
   * Sets the underlined letter; `node`/`offset` is its character in the label. The line
   * is drawn by CSS (`::before`) at the place the layout gives the character – the
   * label's text nodes belong to Angular and stay untouched.
   */
  setMnemonic(m: Mnemonic | null, node: Text | null = null, offset = 0): void {
    this.mnemonic.set(m);
    const style = this.el.style;
    if (!m || !node || typeof document.createRange !== 'function') {
      style.removeProperty('--fnf-mn-left');
      style.removeProperty('--fnf-mn-top');
      style.removeProperty('--fnf-mn-width');
      return;
    }
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    const ch = range.getBoundingClientRect?.();
    const box = this.el.getBoundingClientRect();
    if (!ch || ch.width === 0) {
      return; // no layout (tests, hidden): only the letter counts
    }
    style.setProperty('--fnf-mn-left', `${ch.left - box.left - this.el.clientLeft}px`);
    style.setProperty('--fnf-mn-top', `${ch.bottom - box.top - this.el.clientTop - 1}px`);
    style.setProperty('--fnf-mn-width', `${ch.width}px`);
  }

  /** Clicks the button unless it is disabled or hidden; true if clicked. */
  trigger(): boolean {
    if (this.el.disabled || !this.el.isConnected || this.el.closest('[hidden]')) {
      return false;
    }
    this.el.click();
    return true;
  }
}
