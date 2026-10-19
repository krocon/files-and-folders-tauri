import { inject, Injectable, signal } from '@angular/core';
import { DialogService } from '../../shared/dialog/dialog.service';
import { ActionId } from './action-catalog';
import { ActionService } from './action.service';
import {
  hasCommandModifier,
  HeldModifiers,
  isFunctionKey,
  KeyEventLike,
  modifiersAfter,
  NO_MODIFIERS,
  strokeFromEvent,
  strokeToString,
} from './shortcut';

/** Actions that may run on auto-repeat (key held down). */
const REPEATABLE: ReadonlySet<ActionId> = new Set<ActionId>([
  'MARK_DOWN',
  'MARK_UP',
  'TOGGLE_MARK_AND_ADVANCE',
  'TOGGLE_MARK_AND_RETREAT',
  'NEXT_TAB',
  'PREV_TAB',
]);

/**
 * Actions about the focused element (design 014 E4): like plain keys they only fire
 * in the file list (or with no focus) – the tab bar keeps its own Shift+F10.
 */
const FOCUS_SCOPED: ReadonlySet<ActionId> = new Set<ActionId>(['OPEN_CONTEXT_MENU']);

export const CHORD_TIMEOUT_MS = 1500;

export interface DispatchEvent extends KeyEventLike {
  readonly target: EventTarget | null;
  readonly repeat: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * The one global keyboard handler (capture phase on `document`, design 002 §3.4):
 * dialog open → keys belong to the dialog; plain keys (no Mod/Ctrl/Alt, no
 * F-key) only act while the file list (or nothing) has the focus, so buttons,
 * the tab bar and inputs keep Space/Enter/arrows; navigation keys are never
 * bound and reach the table.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardDispatcher {
  private readonly actions = inject(ActionService);
  private readonly dialogs = inject(DialogService);
  private chord: { first: string; timer: ReturnType<typeof setTimeout> } | null = null;

  /** Modifiers held right now (button bar sets). */
  readonly held = signal<HeldModifiers>(NO_MODIFIERS);

  attach(doc: Document): () => void {
    const down = (e: KeyboardEvent) => {
      this.updateHeld(e);
      this.handle(e);
    };
    const up = (e: KeyboardEvent) =>
      this.updateHeld({ ...pickKey(e), ...modifiersAfter(e, 'keyup') });
    const reset = () => this.held.set(NO_MODIFIERS);
    doc.addEventListener('keydown', down, true);
    doc.addEventListener('keyup', up, true);
    doc.defaultView?.addEventListener('blur', reset);
    return () => {
      doc.removeEventListener('keydown', down, true);
      doc.removeEventListener('keyup', up, true);
      doc.defaultView?.removeEventListener('blur', reset);
    };
  }

  /** Returns the action that was started (for tests), or null. */
  handle(evt: DispatchEvent): ActionId | null {
    if (this.dialogs.open() !== null) {
      return null;
    }
    const platform = this.actions.platform();
    const stroke = strokeFromEvent(evt, platform);
    if (!stroke) {
      return null;
    }
    const text = strokeToString(stroke);
    const lookup = this.actions.keymap().lookup;
    const target = evt.target instanceof Element ? evt.target : null;

    if (target?.closest('[role="menu"], [role="menubar"]')) {
      // an open menu or the menu bar owns the keys, like a native menu (review 014 #3):
      // no action behind the open menu, and no native accelerator either
      this.clearChord();
      const id = lookup.get(text) ?? this.actions.extraFor(text)?.id;
      if (id) {
        this.actions.noteKeySuppressed(id);
        if (hasCommandModifier(stroke) || isFunctionKey(stroke.key)) {
          evt.preventDefault(); // no WebView default (reload, find) either
        }
      }
      return null;
    }

    if (this.chord) {
      const combo = `${this.chord.first} ${text}`;
      this.clearChord();
      const id = lookup.get(combo);
      if (id) {
        return this.fire(id, evt);
      }
      return null;
    }

    const plain = !hasCommandModifier(stroke) && !isFunctionKey(stroke.key);
    if (plain && !inFileListOrNowhere(target)) {
      return null;
    }
    if (isTextInput(target) && !isFunctionKey(stroke.key)) {
      // the text field keeps the key – and a native accelerator must not run it (review 014 #1)
      this.noteSuppressed(lookup.get(text));
      return null;
    }
    if ([...lookup.keys()].some((k) => k.startsWith(`${text} `))) {
      evt.preventDefault();
      evt.stopPropagation();
      this.chord = { first: text, timer: setTimeout(() => this.clearChord(), CHORD_TIMEOUT_MS) };
      return null;
    }
    const id = lookup.get(text);
    if (!id) {
      const extra = this.actions.extraFor(text);
      if (extra && !evt.repeat) {
        evt.preventDefault();
        evt.stopPropagation();
        this.actions.noteKeyRun(extra.id);
        void this.actions.runExtra(extra.id);
      }
      return null;
    }
    if (FOCUS_SCOPED.has(id) && !inFileListOrNowhere(target)) {
      this.noteSuppressed(id);
      return null;
    }
    if (evt.repeat && !REPEATABLE.has(id)) {
      evt.preventDefault();
      evt.stopPropagation();
      return null;
    }
    return this.fire(id, evt);
  }

  private fire(id: ActionId, evt: DispatchEvent): ActionId {
    evt.preventDefault();
    evt.stopPropagation();
    this.actions.noteKeyRun(id);
    void this.actions.run(id);
    return id;
  }

  private noteSuppressed(id: string | undefined): void {
    if (id) {
      this.actions.noteKeySuppressed(id);
    }
  }

  private clearChord(): void {
    if (this.chord) {
      clearTimeout(this.chord.timer);
      this.chord = null;
    }
  }

  private updateHeld(e: KeyEventLike): void {
    const mac = this.actions.platform() === 'macos';
    const next: HeldModifiers = {
      mod: mac ? e.metaKey : e.ctrlKey,
      ctrl: mac ? e.ctrlKey : false,
      alt: e.altKey,
      shift: e.shiftKey,
    };
    const cur = this.held();
    if (
      cur.mod !== next.mod ||
      cur.ctrl !== next.ctrl ||
      cur.alt !== next.alt ||
      cur.shift !== next.shift
    ) {
      this.held.set(next);
    }
  }
}

function inFileListOrNowhere(target: Element | null): boolean {
  if (
    !target ||
    target === target.ownerDocument?.body ||
    target === target.ownerDocument?.documentElement
  ) {
    return true;
  }
  return target.closest('app-file-list') !== null;
}

function isTextInput(target: Element | null): boolean {
  if (!target) {
    return false;
  }
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(target.type);
  }
  return (target as HTMLElement).isContentEditable === true;
}

function pickKey(e: KeyboardEvent): Pick<KeyboardEvent, 'key' | 'code'> {
  return { key: e.key, code: e.code };
}
