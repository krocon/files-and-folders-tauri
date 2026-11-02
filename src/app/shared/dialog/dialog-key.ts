import {
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  InjectionToken,
  input,
} from '@angular/core';
import { formatStroke } from '../../core/actions/shortcut';
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
 * - `null`/`''` – no role (a role that only applies in some states).
 *
 * The letter is fixed in the template (language independent, design 057 E3) and must
 * not be one of {@link RESERVED_DIALOG_LETTERS}.
 */
export type DialogKeySpec =
  'primary' | 'cancel' | `secondary:${string}` | `destructive:${string}` | '' | null;

export interface DialogKeyRole {
  readonly role: 'primary' | 'cancel' | 'secondary' | 'destructive';
  /** `A`–`Z` for secondary/destructive. */
  readonly letter: string | null;
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

/** `aria-keyshortcuts` value of a role (ARIA names: `Meta`, `Control`, `Shift`). */
export function ariaKeysFor(role: DialogKeyRole, platform: Platform): string {
  switch (role.role) {
    case 'primary':
      return 'Enter';
    case 'cancel':
      return 'Escape';
    default: {
      const mod = platform === 'macos' ? 'Meta' : 'Control';
      return `${mod}+${role.role === 'destructive' ? 'Shift+' : ''}${role.letter}`;
    }
  }
}

/** Display of a role's key: `⌘⇧D` / `Ctrl+Shift+D`, `↩`/`Enter`, `Esc`. */
export function displayKeysFor(role: DialogKeyRole, platform: Platform): string {
  const key = role.role === 'primary' ? 'Enter' : role.role === 'cancel' ? 'Escape' : role.letter!;
  const command = role.role === 'secondary' || role.role === 'destructive';
  return formatStroke(
    { mod: command, ctrl: false, alt: false, shift: role.role === 'destructive', key },
    platform,
  );
}

/** Badge while the modifier is held: the rest of the shortcut (`D`, `⇧D`, `Shift+D`). */
export function badgeKeysFor(role: DialogKeyRole, platform: Platform): string {
  return formatStroke(
    { mod: false, ctrl: false, alt: false, shift: role.role === 'destructive', key: role.letter! },
    platform,
  );
}

@Directive({
  selector: '[fnfDialogKey]',
  host: {
    '[attr.aria-keyshortcuts]': 'ariaKeys()',
    '[attr.title]': 'tooltip()',
    '[attr.data-dialog-key]': 'badge()',
    '[class.fnf-dialog-key]': 'true',
  },
})
export class DialogKey {
  readonly fnfDialogKey = input<DialogKeySpec>(null);
  /** More `aria-keyshortcuts` of the button that change (the conflict dialog's Alt letters). */
  readonly fnfDialogKeyExtra = input<string | null>(null);
  readonly el = inject<ElementRef<HTMLButtonElement>>(ElementRef).nativeElement;
  private readonly modal = inject(Modal, { optional: true });
  private readonly platform = inject(DIALOG_PLATFORM);
  /** What the template set statically (kept, the key is added). */
  private readonly ownAria = this.el.getAttribute('aria-keyshortcuts');
  private readonly ownTitle = this.el.getAttribute('title');

  readonly role = computed(() => parseDialogKey(this.fnfDialogKey()));

  protected readonly ariaKeys = computed(() => {
    const r = this.role();
    const keys = r ? ariaKeysFor(r, this.platform) : null;
    return [keys, this.ownAria, this.fnfDialogKeyExtra()].filter(Boolean).join(' ') || null;
  });

  protected readonly tooltip = computed(() => {
    const r = this.role();
    if (!r) {
      return this.ownTitle;
    }
    const keys = DIALOG_KEY_TEXTS.shortcut(displayKeysFor(r, this.platform));
    return this.ownTitle ? `${this.ownTitle} (${keys})` : keys;
  });

  protected readonly badge = computed(() => {
    const r = this.role();
    if (!r?.letter || !this.modal?.modHeld()) {
      return null;
    }
    return badgeKeysFor(r, this.platform);
  });

  constructor() {
    if (this.modal) {
      this.modal.register(this);
      inject(DestroyRef).onDestroy(() => this.modal?.unregister(this));
    }
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
