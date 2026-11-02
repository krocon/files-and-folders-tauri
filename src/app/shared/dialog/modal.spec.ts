import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { setLanguage } from '../../core/i18n/i18n';
import { Platform } from '../../core/actions/platform';
import {
  DIALOG_PLATFORM,
  DialogKey,
  DialogKeySpec,
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

function setup(platform: Platform = 'linux') {
  TestBed.configureTestingModule({ providers: [{ provide: DIALOG_PLATFORM, useValue: platform }] });
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
  return { fixture, el, q, key, cmp: fixture.componentInstance };
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

  it('holding Mod shows the letters on the buttons, releasing hides them', () => {
    const { q, key, fixture } = setup('linux');
    expect(q('.other').hasAttribute('data-dialog-key')).toBe(false);
    key(q('.text'), { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    expect(q('.other').dataset['dialogKey']).toBe('B');
    expect(q('.danger').dataset['dialogKey']).toBe('Shift+D');
    expect(q('.primary').hasAttribute('data-dialog-key')).toBe(false);
    document.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', ctrlKey: true }),
    );
    fixture.detectChanges();
    expect(q('.other').hasAttribute('data-dialog-key')).toBe(false);
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
