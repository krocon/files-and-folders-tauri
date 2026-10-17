import { TestBed } from '@angular/core/testing';
import { SessionApi } from '../../core/session/session-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { TabBar } from './tab-bar';
import { newTab, WorkspaceStore } from './workspace.store';

describe('TabBar', () => {
  let ws: WorkspaceStore;

  async function render() {
    TestBed.configureTestingModule({
      imports: [TabBar],
      providers: [{ provide: SessionApi, useValue: new FakeSessionApi() }],
    });
    ws = TestBed.inject(WorkspaceStore);
    ws.restore({
      ...ws.snapshot(),
      activeSide: 'right',
      panels: {
        left: {
          activeTab: 1,
          tabs: [newTab('/a', 'a'), newTab('/Users/jörg/Mein Ordner', 'Mein Ordner'), newTab(null)],
        },
        right: { activeTab: 0, tabs: [newTab('/r', 'r')] },
      },
    });
    const fixture = TestBed.createComponent(TabBar);
    fixture.componentRef.setInput('side', 'left');
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const tabs = () => [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    return { fixture, el, tabs };
  }

  it('renders a tablist with titles, tooltips and roving tabindex', async () => {
    const { el, tabs } = await render();
    expect(el.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      'Tabs, left panel',
    );
    expect(tabs().map((t) => t.textContent?.trim())).toEqual(['a', 'Mein Ordner', 'Home']);
    expect(tabs()[1].title).toBe('/Users/jörg/Mein Ordner');
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('selects a tab on click and activates the side', async () => {
    const { fixture, tabs } = await render();
    tabs()[0].click();
    fixture.detectChanges();
    expect(ws.panels().left.activeTab).toBe(0);
    expect(ws.activeSide()).toBe('left');
  });

  it('moves the selection with the arrow keys, Home/End, and closes with Delete', async () => {
    const { fixture, tabs } = await render();
    const press = (key: string, i: number, init: KeyboardEventInit = {}) => {
      tabs()[i].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
      fixture.detectChanges();
    };
    press('ArrowRight', 1);
    expect(ws.panels().left.activeTab).toBe(2);
    press('ArrowRight', 2);
    expect(ws.panels().left.activeTab).toBe(0);
    press('End', 0);
    expect(ws.panels().left.activeTab).toBe(2);
    press('Home', 2);
    expect(ws.panels().left.activeTab).toBe(0);
    press('Delete', 0);
    expect(tabs()).toHaveLength(2);
  });

  it('clones with + and closes with −, the last tab stays', async () => {
    const { fixture, el, tabs } = await render();
    const [plus, minus] = [...el.querySelectorAll<HTMLButtonElement>('.icon-btn')];
    plus.click();
    fixture.detectChanges();
    expect(tabs()).toHaveLength(4);
    expect(tabs()[2].textContent?.trim()).toBe('Mein Ordner');
    for (let i = 0; i < 5; i++) {
      minus.click();
      fixture.detectChanges();
    }
    expect(tabs()).toHaveLength(1);
    expect(minus.disabled).toBe(true);
  });

  it('closes a tab on middle click', async () => {
    const { fixture, tabs } = await render();
    tabs()[0].dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
    fixture.detectChanges();
    expect(tabs().map((t) => t.textContent?.trim())).toEqual(['Mein Ordner', 'Home']);
  });

  it('opens the context menu and runs its entries', async () => {
    const { fixture, el, tabs } = await render();
    const openMenu = (i: number) => {
      tabs()[i].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5 }));
      fixture.detectChanges();
      return [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    };
    let items = openMenu(0);
    expect(el.querySelector('[role="menu"]')).not.toBeNull();
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Reload',
      'Close tab',
      'Move tab to right panel',
      'Clone tab for right panel',
      'Move tab to the left',
      'Move tab to the right',
    ]);
    expect(items[4].getAttribute('aria-disabled')).toBe('true');

    items[5].click(); // move right
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(ws.panels().left.tabs.map((t) => t.path)).toEqual([
      '/Users/jörg/Mein Ordner',
      '/a',
      null,
    ]);

    items = openMenu(1);
    items[3].click(); // clone for right panel
    fixture.detectChanges();
    expect(ws.panels().right.tabs.map((t) => t.path)).toEqual(['/r', '/a']);

    items = openMenu(1);
    items[2].click(); // move to right panel
    fixture.detectChanges();
    expect(ws.panels().left.tabs.map((t) => t.path)).toEqual(['/Users/jörg/Mein Ordner', null]);
    expect(ws.panels().right.tabs.map((t) => t.path)).toEqual(['/r', '/a', '/a']);
  });

  it('opens the context menu with Shift+F10 and closes it with Escape', async () => {
    const { fixture, el, tabs } = await render();
    tabs()[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }),
    );
    fixture.detectChanges();
    const menu = el.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('reloads on double click', async () => {
    const { fixture, tabs } = await render();
    tabs()[2].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    expect(ws.panels().left.activeTab).toBe(2);
    expect(ws.reloadRequest()?.side).toBe('left');
  });
});
