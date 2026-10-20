import { TestBed } from '@angular/core/testing';
import { SessionApi } from '../../core/session/session-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { FsApi } from '../../core/fs/fs-api';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FakeFsApi } from '../../../testing/fs-fixtures';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { TabBar } from './tab-bar';
import { insertionIndex, placeIndex, tabDragCopies, tabDropCheck } from './tab-drag-logic';
import { TabDragStore } from './tab-drag.store';
import { MAX_TABS, newTab, WorkspaceStore } from './workspace.store';

describe('tab drag logic (design 031)', () => {
  it('inserts before the first tab whose middle is right of the pointer', () => {
    const middles = [50, 150, 250];
    expect(insertionIndex(middles, 10)).toBe(0);
    expect(insertionIndex(middles, 60)).toBe(1);
    expect(insertionIndex(middles, 249)).toBe(2);
    expect(insertionIndex(middles, 400)).toBe(3);
    expect(insertionIndex([], 5)).toBe(0);
  });

  it('corrects the index after taking the tab out', () => {
    expect(placeIndex(0, 3)).toBe(2);
    expect(placeIndex(3, 0)).toBe(0);
    expect(placeIndex(1, 1)).toBe(1);
  });

  it('refuses no-ops, moving the last tab away and a full side', () => {
    const q = {
      from: 'left' as const,
      fromIndex: 1,
      fromCount: 3,
      to: 'left' as const,
      toCount: 3,
      index: 1,
      copy: false,
    };
    expect(tabDropCheck(q)).toBe('noop');
    expect(tabDropCheck({ ...q, index: 2 })).toBe('noop');
    expect(tabDropCheck({ ...q, index: 3 })).toBeNull();
    expect(tabDropCheck({ ...q, index: 2, copy: true })).toBeNull(); // a copy next to it
    const other = { ...q, to: 'right' as const, toCount: 1, index: 0 };
    expect(tabDropCheck(other)).toBeNull();
    expect(tabDropCheck({ ...other, fromCount: 1 })).toBe('lastTab');
    expect(tabDropCheck({ ...other, fromCount: 1, copy: true })).toBeNull();
    expect(tabDropCheck({ ...other, toCount: MAX_TABS })).toBe('full');
  });

  it('copies with ⌥ on macOS and Ctrl elsewhere', () => {
    expect(tabDragCopies({ ctrlKey: false, altKey: true }, true)).toBe(true);
    expect(tabDragCopies({ ctrlKey: true, altKey: false }, true)).toBe(false);
    expect(tabDragCopies({ ctrlKey: true, altKey: false }, false)).toBe(true);
    expect(tabDragCopies({ ctrlKey: false, altKey: true }, false)).toBe(false);
  });
});

describe('dragging tabs (design 031)', () => {
  let ws: WorkspaceStore;
  let drag: TabDragStore;

  async function render() {
    TestBed.configureTestingModule({
      imports: [TabBar],
      providers: [
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: FsApi, useValue: new FakeFsApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    });
    ws = TestBed.inject(WorkspaceStore);
    drag = TestBed.inject(TabDragStore);
    ws.restore({
      ...ws.snapshot(),
      panels: {
        left: { activeTab: 0, tabs: [newTab('/a', 'a'), newTab('/b', 'b'), newTab('/c', 'c')] },
        right: { activeTab: 0, tabs: [newTab('/r', 'r')] },
      },
    });
    const bars = (['left', 'right'] as const).map((side) => {
      const fixture = TestBed.createComponent(TabBar);
      fixture.componentRef.setInput('side', side);
      fixture.detectChanges();
      return { fixture, el: fixture.nativeElement as HTMLElement };
    });
    // after both: TestBed removes earlier root elements when it creates a component
    bars.forEach((b) => document.body.appendChild(b.el));
    // jsdom has no layout: every tab is 100 px wide, side by side
    const tabs = (i: number) => [...bars[i].el.querySelectorAll<HTMLElement>('[role="tab"]')];
    const layout = () => {
      for (const i of [0, 1]) {
        tabs(i).forEach((t, n) => {
          t.getBoundingClientRect = () => ({ left: n * 100, width: 100 }) as DOMRect;
        });
      }
    };
    layout();
    let under: Element | null = null;
    drag.elementAt = () => under;
    const detect = () => {
      bars.forEach((b) => b.fixture.detectChanges());
      layout();
    };
    const pointer = (type: string, target: EventTarget, x: number, init: MouseEventInit = {}) => {
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: x,
          clientY: 5,
          ...init,
        }),
      );
      detect();
    };
    return {
      bars,
      tabs,
      detect,
      pointer,
      over: (el: Element | null) => (under = el),
      cleanup: () => bars.forEach((b) => b.el.remove()),
    };
  }

  const ids = (side: 'left' | 'right') => ws.panels()[side].tabs.map((t) => t.path);

  it('reorders a tab within its bar, shows the insertion mark and selects it', async () => {
    const t = await render();
    const [a] = t.tabs(0);
    t.pointer('pointerdown', a, 10);
    t.over(t.tabs(0)[2]);
    t.pointer('pointermove', window, 12); // below the threshold: no drag yet
    expect(drag.drag()).toBeNull();
    t.pointer('pointermove', window, 260);
    expect(drag.drag()?.target).toEqual({ side: 'left', index: 3 });
    expect(t.tabs(0)[2].classList).toContain('insert-after');
    expect(t.tabs(0)[0].classList).toContain('dragged');
    expect(t.bars[0].el.querySelector('.live')?.textContent).toContain(
      'Move tab a → left, position 4',
    );
    t.pointer('pointerup', window, 260);
    expect(ids('left')).toEqual(['/b', '/c', '/a']);
    expect(ws.panels().left.activeTab).toBe(2);
    expect(drag.drag()).toBeNull();
    // the click after the drop selects nothing else
    t.tabs(0)[0].click();
    expect(ws.panels().left.activeTab).toBe(2);
    t.cleanup();
  });

  it('moves a tab to the other side (its panel, at the end); Ctrl copies', async () => {
    const t = await render();
    const panel = document.createElement('app-file-panel');
    panel.appendChild(t.bars[1].el);
    const list = document.createElement('div');
    panel.appendChild(list);
    document.body.appendChild(panel);
    t.detect();
    // a copy onto the other tab bar, before "r"
    t.pointer('pointerdown', t.tabs(0)[1], 150);
    t.over(t.tabs(1)[0]);
    t.pointer('pointermove', window, 20, { ctrlKey: true });
    expect(drag.drag()?.copy).toBe(true);
    expect(t.tabs(1)[0].classList).toContain('insert-before');
    t.pointer('pointerup', window, 20, { ctrlKey: true });
    expect(ids('left')).toEqual(['/a', '/b', '/c']);
    expect(ids('right')).toEqual(['/b', '/r']);
    expect(ws.panels().left.tabs[1].id).not.toBe(ws.panels().right.tabs[0].id);
    expect(ws.activeSide()).toBe('right');
    // moved onto the other panel's list: at the end
    t.pointer('pointerdown', t.tabs(0)[2], 250);
    t.over(list);
    t.pointer('pointermove', window, 900);
    expect(drag.drag()?.target).toEqual({ side: 'right', index: 2 });
    t.pointer('pointerup', window, 900);
    expect(ids('left')).toEqual(['/a', '/b']);
    expect(ids('right')).toEqual(['/b', '/r', '/c']);
    expect(ws.panels().right.activeTab).toBe(2);
    panel.remove();
    t.cleanup();
  });

  it('the last tab of a side stays; Esc cancels; a plain click only selects', async () => {
    const t = await render();
    t.pointer('pointerdown', t.tabs(1)[0], 10);
    t.over(t.tabs(0)[0]);
    t.pointer('pointermove', window, 30);
    expect(drag.drag()?.target).toBeNull();
    expect(drag.drag()?.blocked).toBe('lastTab');
    expect(t.bars[1].el.querySelector('.live')?.textContent).toContain(
      'The last tab of a side stays',
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
    t.detect();
    expect(drag.drag()?.target).toEqual({ side: 'left', index: 0 }); // Ctrl: copy is fine
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', ctrlKey: true }));
    t.detect();
    expect(drag.drag()).toBeNull();
    t.pointer('pointerup', window, 30);
    expect(ids('left')).toEqual(['/a', '/b', '/c']);
    expect(ids('right')).toEqual(['/r']);
    // a click without moving selects as before (once the swallowed click after Esc is gone)
    await new Promise((r) => setTimeout(r));
    t.pointer('pointerdown', t.tabs(0)[2], 250);
    t.pointer('pointerup', window, 250);
    t.tabs(0)[2].click();
    expect(ws.panels().left.activeTab).toBe(2);
    t.cleanup();
  });

  it('keys other than Esc and modifiers are swallowed while dragging', async () => {
    const t = await render();
    t.pointer('pointerdown', t.tabs(0)[0], 10);
    t.over(t.tabs(0)[2]);
    t.pointer('pointermove', window, 260);
    const f8 = new KeyboardEvent('keydown', { key: 'F8', cancelable: true });
    window.dispatchEvent(f8);
    expect(f8.defaultPrevented).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    t.cleanup();
  });
});
