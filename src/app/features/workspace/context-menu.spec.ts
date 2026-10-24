import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ContextMenu, MenuItem } from './context-menu';

@Component({
  imports: [ContextMenu],
  template: `<button class="opener">o</button>
    <app-context-menu
      [items]="items()"
      label="Menu"
      [headingLines]="lines()"
      (chosen)="chosen.push($event)"
      (closed)="closed.push($event)"
      (sideways)="sideways.push($event)"
    />`,
})
class Host {
  readonly items = signal<MenuItem[]>([
    { id: 'COPY', label: 'Copy…', shortcut: 'F5' },
    { id: '-1', label: '', separator: true },
    { id: 'PACK', label: 'Pack…', disabled: true, hint: 'Coming in prompt 016' },
    {
      id: 'sub:tools',
      label: 'Open with tool',
      children: [
        { id: 'tool:edit', label: 'edit', shortcut: 'Ctrl+E' },
        { id: 'tool:diff', label: 'diff' },
      ],
    },
  ]);
  readonly lines = signal(false);
  readonly chosen: string[] = [];
  readonly closed: string[] = [];
  readonly sideways: number[] = [];
}

describe('ContextMenu', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const key = async (k: string) => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true }),
      );
      fixture.detectChanges();
      await fixture.whenStable();
    };
    return { fixture, el, host: fixture.componentInstance, key };
  }

  it('shows badges, separators and dimmed entries with their hint', async () => {
    const { el } = await render();
    const items = [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((i) => i.querySelector('.label')?.textContent?.trim())).toEqual([
      'Copy…',
      'Pack…',
      'Open with tool',
    ]);
    expect(items[0].querySelector('kbd')?.textContent).toBe('F5');
    expect(items[1].getAttribute('aria-disabled')).toBe('true');
    expect(items[1].title).toBe('Coming in prompt 016');
    expect(items[2].getAttribute('aria-haspopup')).toBe('menu');
    expect(el.querySelectorAll('[role="separator"]').length).toBe(1);
    expect(document.activeElement).toBe(items[0]);
  });

  it('headings as lines (folder menu): only a line to see, the group keeps its label', async () => {
    const { fixture, el, host } = await render();
    host.items.set([
      { id: 'home', label: 'Home' },
      { id: 'fav-h', label: 'Favourites', heading: true },
      { id: 'fav:0', label: '/home/u' },
    ]);
    host.lines.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('[role="menu"]')!.classList.contains('lines')).toBe(true);
    const group = el.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Favourites');
    expect(group.querySelector('.heading')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens a submenu with → / Enter, chooses inside it and goes back with ←', async () => {
    const { el, host, key } = await render();
    await key('ArrowDown'); // dimmed Pack… is focusable (APG)
    await key('ArrowDown');
    expect(document.activeElement?.textContent).toContain('Open with tool');
    await key('ArrowRight');
    const sub = el.querySelector('app-context-menu app-context-menu')!;
    expect(sub).not.toBeNull();
    await new Promise((r) => setTimeout(r));
    expect(sub.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toContain('edit');
    await key('ArrowLeft');
    expect(el.querySelector('app-context-menu app-context-menu')).toBeNull();
    expect(document.activeElement?.textContent).toContain('Open with tool');
    await key('Enter');
    await new Promise((r) => setTimeout(r));
    await key('ArrowDown');
    await key('Enter');
    expect(host.chosen).toEqual(['tool:diff']);
  });

  it('Esc closes, ←/→ at the top level are passed on (menu bar), disabled entries do nothing', async () => {
    const { el, host, key } = await render();
    await key('ArrowLeft');
    expect(host.sideways).toEqual([-1]);
    el.querySelectorAll<HTMLElement>('[role="menuitem"]')[1].click();
    expect(host.chosen).toEqual([]);
    el.querySelector<HTMLElement>('[role="menuitem"]')!.click();
    expect(host.chosen).toEqual(['COPY']);
    await key('Escape');
    expect(host.closed).toEqual(['key']);
  });

  it('APG: dimmed entries are focusable and describe why; typeahead; Tab leaves (review 014 #5)', async () => {
    const { el, host, key } = await render();
    await key('ArrowDown');
    const pack = document.activeElement as HTMLElement;
    expect(pack.textContent).toContain('Pack…');
    expect(pack.getAttribute('aria-disabled')).toBe('true');
    const hint = document.getElementById(pack.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Coming in prompt 016');
    await key('Enter');
    expect(host.chosen).toEqual([]);
    await key('o');
    expect(document.activeElement?.textContent).toContain('Open with tool');
    await key('C');
    expect(document.activeElement?.textContent).toContain('Copy…');
    await key('p');
    expect(document.activeElement).toBe(pack);
    expect(el.querySelector('app-context-menu app-context-menu')).toBeNull();
    await key('Tab');
    expect(host.closed).toEqual(['tab']);
  });
});
