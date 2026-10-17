import { TestBed } from '@angular/core/testing';
import { ActionService } from '../../../core/actions/action.service';
import { KeymapApi } from '../../../core/actions/keymap-api';
import { KeyboardDispatcher } from '../../../core/actions/keyboard-dispatcher';
import { NO_MODIFIERS } from '../../../core/actions/shortcut';
import { FakeKeymapApi } from '../../../../testing/fake-keymap-api';
import { ButtonBar } from './button-bar';

describe('ButtonBar', () => {
  async function render() {
    TestBed.configureTestingModule({
      imports: [ButtonBar],
      providers: [{ provide: KeymapApi, useValue: new FakeKeymapApi() }],
    });
    const actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    const fixture = TestBed.createComponent(ButtonBar);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const labels = () =>
      [...el.querySelectorAll('.functions .fbtn')].map((b) =>
        [...b.children].map((c) => c.textContent?.trim()).join(' '),
      );
    return { fixture, el, labels, actions, keys: TestBed.inject(KeyboardDispatcher) };
  }

  it('shows the default set with shortcut badges, dimmed while the action is missing', async () => {
    const { el, labels } = await render();
    expect(labels()).toEqual(['F4 Edit', 'F5 Copy', 'F6 Move', 'F7 Create folder', 'F8 Delete']);
    const copy = el.querySelectorAll<HTMLButtonElement>('.functions .fbtn')[1];
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    expect(copy.title).toBe('Copy – Coming in prompt 006');
  });

  it('switches the set while Shift is held and shows the badge without Shift', async () => {
    const { fixture, labels, keys } = await render();
    keys.held.set({ ...NO_MODIFIERS, shift: true });
    fixture.detectChanges();
    expect(labels()).toEqual(['F4 Create file', 'Copy', 'F6 Rename', 'F7 Create folder', 'Delete']);
  });

  it('enables and runs a registered action', async () => {
    const { fixture, el, actions } = await render();
    let copies = 0;
    actions.register({ OPEN_COPY_DLG: { run: () => void copies++ } });
    fixture.detectChanges();
    const copy = el.querySelectorAll<HTMLButtonElement>('.functions .fbtn')[1];
    expect(copy.getAttribute('aria-disabled')).toBeNull();
    copy.click();
    await Promise.resolve();
    expect(copies).toBe(1);
  });

  it('opens the Actions menu with four columns', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('.actions-toggle')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[role="menu"] [role="group"]')).toHaveLength(4);
    expect(el.querySelector('.actions-toggle')?.getAttribute('aria-expanded')).toBe('true');
  });
});
