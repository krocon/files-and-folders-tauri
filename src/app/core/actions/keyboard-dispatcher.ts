import { inject, Injectable, signal } from '@angular/core';
import { DialogService } from '../../shared/dialog/dialog.service';
import { ActionId } from './action-catalog';
import { ActionService } from './action.service';
import {
  hasCommandModifier,
  HeldModifiers,
  isFunctionKey,
  KeyEventLike,
  NO_MODIFIERS,
  strokeFromEvent,
  strokeToString,
} from './shortcut';

/** Actions that may run on auto-repeat (key held down). */
const REPEATABLE: ReadonlySet<ActionId> = new Set<ActionId>([
  'MARK_DOWN',
  'MARK_UP',
  'TOGGLE_MARK_AND_ADVANCE',
  'NEXT_TAB',
  'PREV_TAB',
]);

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
    const up = (e: KeyboardEvent) => this.updateHeld(e);
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
    const target = evt.target instanceof Element ? evt.target : null;
    if (plain && !inFileListOrNowhere(target)) {
      return null;
    }
    if (isTextInput(target) && !isFunctionKey(stroke.key)) {
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
    void this.actions.run(id);
    return id;
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
