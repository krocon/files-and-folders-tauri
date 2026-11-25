import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, beforeEach } from 'vitest';
import { setLanguage } from '../../core/i18n/i18n';
import { Platform } from '../../core/actions/platform';
import {
  DIALOG_KEY_STYLE,
  DIALOG_PLATFORM,
  DialogKeyStyle,
  DialogKey,
  DialogKeySpec,
  displayKeysFor,
  letterFor,
  parseDialogKey,
  RESERVED_DIALOG_LETTERS,
} from './dialog-key';
import { Modal } from './modal';

/** A dialog like the delete dialog, with a form like the copy dialog. */
@Component({
  selector: 'app-test-dialog',
  imports: [Modal, DialogKey],
  template: `
    <app-modal heading="Test" (closed)="log.push('closed')">
      <form (submit)="onSubmit($event)">
        <input class="text" type="text" />
        <input class="check" type="checkbox" />
        <input class="radio" type="radio" />
        <select class="select">
          <option>a</option>
        </select>
        <textarea class="area"></textarea>
        <div role="listbox" tabindex="0" class="list"></div>
        <button type="button" class="btn cancel" appDialogKey="cancel" (click)="log.push('cancel')">
          Cancel
        </button>
        <button
          type="button"
          class="btn danger"
          title="Gone"
          [appDialogKey]="secondary()"
          (click)="log.push('forever')"
        >
          Delete permanently
        </button>
        <button type="button" class="btn other" appDialogKey="secondary:B" (click)="log.push('b')">
          Back
        </button>
        <button
          type="submit"
          class="btn primary"
          [appDialogKey]="primary()"
          [disabled]="disabled()"
          aria-keyshortcuts="Control+Enter"
          (click)="log.push('primary')"
        >
          OK
        </button>
      </form>
    </app-modal>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestDialog {
  readonly log: string[] = [];
  readonly primary = signal<DialogKeySpec>('primary');
  readonly secondary = signal<DialogKeySpec>('destructive:D');
  readonly disabled = signal(false);
  onSubmit(evt: Event): void {
    evt.preventDefault();
    this.log.push('submit');
  }
}

function setup(platform: Platform = 'linux', style: DialogKeyStyle = 'keycap') {
  TestBed.configureTestingModule({
    providers: [
      { provide: DIALOG_PLATFORM, useValue: platform },
      { provide: DIALOG_KEY_STYLE, useValue: signal(style) },
    ],
  });
  const fixture = TestBed.createComponent(TestDialog);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const key = (target: HTMLElement, init: KeyboardEventInit) => {
    const evt = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(evt);
    fixture.detectChanges();
    return evt;
  };
  const modal = fixture.debugElement.query(By.directive(Modal)).componentInstance as Modal;
  return { fixture, el, q, key, modal, cmp: fixture.componentInstance };
}

describe('Modal: dialog keys (057)', () => {
  beforeEach(() => setLanguage('en'));

  it('Enter clicks the primary button from a text field, checkbox, radio or select – once', () => {
    const { q, key, cmp } = setup();
    for (const sel of ['.text', '.check', '.radio', '.select']) {
      const evt = key(q(sel), { key: 'Enter', code: 'Enter' });
      expect(evt.defaultPrevented).toBe(true);
    }
    // the submit button's click submits the form: one click, one submit per Enter
    expect(cmp.log.filter((x) => x === 'primary')).toHaveLength(4);
    expect(cmp.log.filter((x) => x === 'submit')).toHaveLength(4);
  });

  it('Enter is left alone: textarea, own lists, IME, auto-repeat, disabled, modifiers', () => {
    const { q, key, cmp, fixture } = setup();
    key(q('.area'), { key: 'Enter' });
    key(q('.list'), { key: 'Enter' });
    key(q('.text'), { key: 'Enter', isComposing: true });
    key(q('.text'), { key: 'Enter', shiftKey: true });
    const repeat = key(q('.text'), { key: 'Enter', repeat: true });
    expect(repeat.defaultPrevented).toBe(true); // swallowed, not repeated
    cmp.disabled.set(true);
    fixture.detectChanges();
    key(q('.text'), { key: 'Enter' });
    expect(cmp.log).toEqual([]);
  });

  it('Enter on a focused other button is that button (native), not the primary', () => {
    const { q, key, cmp } = setup();
    const evt = key(q('.cancel'), { key: 'Enter' });
    expect(evt.defaultPrevented).toBe(false);
    expect(cmp.log).toEqual([]);
  });

  it('an inner handler that took Enter wins (defaultPrevented)', () => {
    const { q, key, cmp } = setup();
    q('.text').addEventListener('keydown', (e) => e.preventDefault());
    key(q('.text'), { key: 'Enter' });
    expect(cmp.log).toEqual([]);
  });

  it('a destructive main button never reacts to Enter, only to Mod+Shift+letter', () => {
    const { q, key, cmp, fixture } = setup();
    cmp.primary.set('destructive:P');
    cmp.secondary.set(null);
    fixture.detectChanges();
    // no implicit submit of the form either
    expect(key(q('.text'), { key: 'Enter' }).defaultPrevented).toBe(true);
    key(q('.check'), { key: 'p', code: 'KeyP', ctrlKey: true });
    expect(cmp.log).toEqual([]);
    key(q('.check'), { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true });
    expect(cmp.log).toEqual(['primary', 'submit']);
  });

  it('071: a `confirm` button takes Mod+Enter only – never Enter, never a letter', () => {
    const { q, key, cmp, fixture } = setup('linux');
    cmp.primary.set('confirm');
    cmp.secondary.set(null);
    fixture.detectChanges();
    // Enter from a field: nothing, and no implicit submit of the form
    for (const sel of ['.text', '.check', '.select']) {
      expect(key(q(sel), { key: 'Enter' }).defaultPrevented).toBe(true);
    }
    key(q('.text'), { key: 'Enter', shiftKey: true });
    key(q('.text'), { key: 'Enter', ctrlKey: true, shiftKey: true });
    key(q('.text'), { key: 'Enter', metaKey: true }); // ⌘ is not the modifier here
    expect(cmp.log).toEqual([]);
    const evt = key(q('.text'), { key: 'Enter', ctrlKey: true });
    expect(evt.defaultPrevented).toBe(true);
    expect(cmp.log).toEqual(['primary', 'submit']);
    // held down: swallowed, not repeated
    key(q('.text'), { key: 'Enter', ctrlKey: true, repeat: true });
    expect(cmp.log).toHaveLength(2);
    // a dialog that handles Mod+Enter itself comes first – no second click
    q('.area').addEventListener('keydown', (e) => e.preventDefault());
    key(q('.area'), { key: 'Enter', ctrlKey: true });
    expect(cmp.log).toHaveLength(2);
    // disabled (a proposal is locked right after it appeared): nothing
    cmp.disabled.set(true);
    fixture.detectChanges();
    key(q('.text'), { key: 'Enter', ctrlKey: true });
    expect(cmp.log).toHaveLength(2);
    expect(parseDialogKey('confirm')).toEqual({ role: 'confirm', letter: null });
    expect(displayKeysFor({ role: 'confirm', letter: null }, 'linux')).toBe('Ctrl+Enter');
    expect(q('.primary').getAttribute('aria-keyshortcuts')).toContain('Control+Enter');
  });

  it('071: Mod+Enter is ⌘+Enter on macOS, and a `confirm` button gets no Alt letter', () => {
    const mac = setup('macos', 'underline');
    mac.cmp.primary.set('confirm');
    mac.cmp.secondary.set(null);
    mac.fixture.detectChanges();
    mac.modal.refreshMnemonics();
    mac.key(mac.q('.text'), { key: 'Enter', ctrlKey: true });
    expect(mac.cmp.log).toEqual([]);
    mac.key(mac.q('.text'), { key: 'Enter', metaKey: true });
    expect(mac.cmp.log).toEqual(['primary', 'submit']);
    expect(mac.q('.primary').getAttribute('data-mnemonic')).toBeNull();
    mac.key(mac.q('.text'), { key: 'o', code: 'KeyO', altKey: true });
    expect(mac.cmp.log).toHaveLength(2);
  });

  it('Mod+letter clicks a secondary, Mod+Shift+letter a destructive one (Ctrl / ⌘)', () => {
    const linux = setup('linux');
    linux.key(linux.q('.text'), { key: 'b', code: 'KeyB', ctrlKey: true });
    linux.key(linux.q('.text'), { key: 'd', code: 'KeyD', ctrlKey: true }); // no Shift: nothing
    linux.key(linux.q('.text'), { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    linux.key(linux.q('.text'), { key: 'b', code: 'KeyB', metaKey: true, altKey: true });
    expect(linux.cmp.log).toEqual(['b', 'forever']);
    linux.fixture.destroy();
    TestBed.resetTestingModule();

    const mac = setup('macos');
    mac.key(mac.q('.text'), { key: 'b', code: 'KeyB', ctrlKey: true }); // ⌃ is not ⌘
    mac.key(mac.q('.text'), { key: 'b', code: 'KeyB', metaKey: true });
    expect(mac.cmp.log).toEqual(['b']);
  });

  it('text editing keys stay with the field (Mod+A/C/V/X/Z are never roles)', () => {
    const { q, key } = setup();
    for (const k of ['a', 'c', 'v', 'x', 'z']) {
      const evt = key(q('.text'), { key: k, code: `Key${k.toUpperCase()}`, ctrlKey: true });
      expect(evt.defaultPrevented).toBe(false);
    }
    expect(parseDialogKey('secondary:C')).toBeNull();
    expect(parseDialogKey('destructive:Z')).toBeNull();
    expect([...RESERVED_DIALOG_LETTERS].sort().join('')).toBe('ACHMQVWXYZ');
  });

  it('Esc closes; an inner popup that took Esc keeps the dialog open', () => {
    const { q, key, cmp } = setup();
    q('.list').addEventListener('keydown', (e) => e.key === 'Escape' && e.preventDefault());
    key(q('.list'), { key: 'Escape' });
    expect(cmp.log).toEqual([]);
    key(q('.text'), { key: 'Escape' });
    expect(cmp.log).toEqual(['closed']);
  });

  it('tooltip and aria-keyshortcuts per role, own values kept', () => {
    const { q } = setup('macos');
    expect(q('.primary').getAttribute('aria-keyshortcuts')).toBe('Enter Control+Enter');
    expect(q('.primary').title).toBe('Shortcut: ↩');
    expect(q('.cancel').getAttribute('aria-keyshortcuts')).toBe('Escape');
    expect(q('.danger').getAttribute('aria-keyshortcuts')).toBe('Meta+Shift+D');
    expect(q('.danger').title).toBe('Gone (Shortcut: ⇧⌘D)');
    expect(q('.other').title).toBe('Shortcut: ⌘B');
  });

  it('tooltips follow the language; Ctrl elsewhere', () => {
    const { q, fixture } = setup('windows');
    expect(q('.other').title).toBe('Shortcut: Ctrl+B');
    expect(q('.danger').getAttribute('aria-keyshortcuts')).toBe('Control+Shift+D');
    setLanguage('de');
    fixture.detectChanges();
    expect(q('.other').title).toBe('Tastenkürzel: Ctrl+B');
    setLanguage('en');
  });

  it('every button with a role shows its key permanently (076 E1)', () => {
    const { q } = setup('linux');
    expect(q('.other').dataset['dialogKey']).toBe('Ctrl+B');
    expect(q('.danger').dataset['dialogKey']).toBe('Ctrl+Shift+D');
    expect(q('.primary').dataset['dialogKey']).toBe('Enter');
    expect(q('.cancel').dataset['dialogKey']).toBe('Esc');
  });

  it('shows the keys in the Apple notation on macOS', () => {
    const { q } = setup('macos');
    expect(q('.other').dataset['dialogKey']).toBe('⌘B');
    expect(q('.danger').dataset['dialogKey']).toBe('⇧⌘D');
  });
});

describe('Modal: underlined letters (076 E4)', () => {
  beforeEach(() => setLanguage('en'));

  function underlined() {
    const t = setup('macos', 'underline');
    t.modal.refreshMnemonics();
    t.fixture.detectChanges();
    return t;
  }

  it('main button and Cancel first, destructive keeps its keycap', () => {
    const { q } = underlined();
    expect(q('.primary').dataset['mnemonic']).toBe('O');
    expect(q('.cancel').dataset['mnemonic']).toBe('C');
    expect(q('.other').dataset['mnemonic']).toBe('B');
    expect(q('.danger').hasAttribute('data-mnemonic')).toBe(false);
    expect(q('.danger').dataset['dialogKey']).toBe('⇧⌘D');
    expect(q('.other').hasAttribute('data-dialog-key')).toBe(false);
    expect(q('.other').title).toBe('Shortcut: ⌥B');
    expect(q('.other').getAttribute('aria-keyshortcuts')).toBe('Meta+B Alt+B');
  });

  it('Alt+letter clicks the button, also from a text field (⌥ changes the key on macOS)', () => {
    const { q, key, cmp } = underlined();
    const evt = key(q('.text'), { key: '∫', code: 'KeyB', altKey: true });
    expect(evt.defaultPrevented).toBe(true);
    key(q('.text'), { key: 'ç', code: 'KeyC', altKey: true });
    expect(cmp.log).toEqual(['b', 'cancel']);
  });

  it('Alt+letter does nothing with keycaps', () => {
    const { q, key, cmp } = setup('macos', 'keycap');
    expect(key(q('.text'), { key: '∫', code: 'KeyB', altKey: true }).defaultPrevented).toBe(false);
    expect(cmp.log).toEqual([]);
  });

  it('Alt+letter nobody has is left alone', () => {
    const { q, key, cmp } = underlined();
    expect(key(q('.text'), { key: 'j', code: 'KeyJ', altKey: true }).defaultPrevented).toBe(false);
    expect(cmp.log).toEqual([]);
  });

  it('follows the language of the labels', () => {
    const { q, modal, fixture } = underlined();
    q('.other').firstChild!.textContent = ' Zurück ';
    modal.refreshMnemonics();
    fixture.detectChanges();
    expect(q('.other').dataset['mnemonic']).toBe('Z');
  });
});

describe('hint role (076 E3)', () => {
  it('parses keys the dialog handles itself, rejects bad notation', () => {
    expect(parseDialogKey('hint:Shift+F7')).toEqual({
      role: 'hint',
      letter: null,
      keys: 'Shift+F7',
    });
    expect(parseDialogKey('hint:0')?.role).toBe('hint');
    expect(parseDialogKey('hint:')).toBeNull();
    expect(parseDialogKey('hint:Foo+Bar')).toBeNull();
  });

  it('shows the keys in the platform notation', () => {
    const role = parseDialogKey('hint:Shift+F7')!;
    expect(displayKeysFor(role, 'macos')).toBe('⇧F7');
    expect(displayKeysFor(role, 'windows')).toBe('Shift+F7');
  });
});

describe('letterFor (057)', () => {
  it('takes the first letter of a label that may be a key', () => {
    expect(letterFor('Delete')).toBe('D');
    expect(letterFor('Remove')).toBe('R');
    expect(letterFor('Close all')).toBe('L'); // C is reserved
    expect(letterFor('Überschreiben')).toBe('U');
    expect(letterFor('…')).toBeNull();
  });
});
