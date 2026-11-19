import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MenuItem } from './context-menu';
import { FolderMenu } from './folder-menu';
import { folderColumns, splitLabel } from './folder-menu-logic';

const ITEMS: MenuItem[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'vol-h', label: 'Drives', heading: true },
  { id: 'vol:/', label: 'Macintosh HD – /', icon: 'hdd-o' },
  { id: 'fav-h', label: 'Favourites', heading: true },
  { id: 'fav:/Users/me/Projects', label: '/Users/me/Projects', icon: 'star' },
  { id: 'fav:/Users/me/Web', label: '/Users/me/Web', icon: 'star' },
  { id: 'recent-h', label: 'Recent', heading: true },
  { id: 'recent:/Users/me/Web/dist', label: '/Users/me/Web/dist', icon: 'history' },
  { id: 'recent:/tmp', label: '/tmp', icon: 'history' },
];

@Component({
  imports: [FolderMenu],
  template: `<button class="opener">o</button>
    <app-folder-menu
      [items]="items()"
      columnBreak="recent-h"
      label="Folders"
      (chosen)="chosen.push($event)"
      (closed)="closed.push($event)"
    />`,
})
class Host {
  readonly items = signal<MenuItem[]>(ITEMS);
  readonly chosen: string[] = [];
  readonly closed: string[] = [];
}

describe('folder menu logic', () => {
  const ids = (cols: ReturnType<typeof folderColumns>) =>
    cols.map((col) => col.map((g) => g.items.map((i) => i.id)));

  it('puts everything from the break heading on into the right column', () => {
    expect(ids(folderColumns(ITEMS, 'recent-h', ''))).toEqual([
      [['home'], ['vol:/'], ['fav:/Users/me/Projects', 'fav:/Users/me/Web']],
      [['recent:/Users/me/Web/dist', 'recent:/tmp']],
    ]);
  });

  it('filters all sections without case, every word must match, empty sections go', () => {
    expect(ids(folderColumns(ITEMS, 'recent-h', '  WEB '))).toEqual([
      [['fav:/Users/me/Web']],
      [['recent:/Users/me/Web/dist']],
    ]);
    expect(ids(folderColumns(ITEMS, 'recent-h', 'web dist'))).toEqual([
      [],
      [['recent:/Users/me/Web/dist']],
    ]);
  });

  it('keeps the placeholder of an empty section, but not while filtering', () => {
    const items: MenuItem[] = [
      { id: 'fav-h', label: 'Favourites', heading: true },
      { id: 'fav-none', label: '(none)', disabled: true },
    ];
    expect(ids(folderColumns(items, 'recent-h', ''))).toEqual([[['fav-none']], []]);
    expect(ids(folderColumns(items, 'recent-h', 'none'))).toEqual([[], []]);
  });

  it('splits only long labels, the end of the path stays whole', () => {
    expect(splitLabel('/Users/me')).toEqual({ head: '/Users/me', tail: '' });
    const long = '/Users/me/WebstormProjects/videoserien/series/vuejs/dist/preview';
    const { head, tail } = splitLabel(long);
    expect(head + tail).toBe(long);
    expect(tail).toBe('eries/vuejs/dist/preview');
  });
});

describe('FolderMenu', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input')!;
    const key = async (k: string) => {
      const evt = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      input.dispatchEvent(evt);
      fixture.detectChanges();
      await fixture.whenStable();
      return evt;
    };
    const type = async (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
    };
    const active = () => el.querySelector<HTMLElement>('[role="option"].active')?.dataset['id'];
    const shown = () =>
      [...el.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => o.dataset['id']);
    return { fixture, el, input, host: fixture.componentInstance, key, type, active, shown };
  }

  it('focuses the filter field, shows two columns and marks the first entry', async () => {
    const { el, input, active } = await render();
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('role')).toBe('combobox');
    const columns = [...el.querySelectorAll('.column')];
    expect(columns.map((c) => c.querySelectorAll('[role="option"]').length)).toEqual([4, 2]);
    expect(active()).toBe('home');
    const option = el.querySelector<HTMLElement>('[role="option"].active')!;
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id);
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('[role="group"][aria-label="Favourites"]')).not.toBeNull();
    // the tooltip has the whole label
    expect(el.querySelector('[data-id="recent:/tmp"]')?.getAttribute('title')).toBe('/tmp');
  });

  it('moves with the arrow keys through both columns and wraps', async () => {
    const { key, active } = await render();
    await key('ArrowDown');
    expect(active()).toBe('vol:/');
    await key('ArrowUp');
    await key('ArrowUp');
    expect(active()).toBe('recent:/tmp');
    await key('ArrowDown');
    expect(active()).toBe('home');
    await key('End');
    expect(active()).toBe('recent:/tmp');
    await key('Home');
    expect(active()).toBe('home');
  });

  it('changes the column with →/←, which otherwise move the caret', async () => {
    const { key, active, type, input } = await render();
    expect((await key('ArrowLeft')).defaultPrevented).toBe(false); // left column: the caret
    expect((await key('ArrowRight')).defaultPrevented).toBe(true);
    expect(active()).toBe('recent:/Users/me/Web/dist');
    expect((await key('ArrowRight')).defaultPrevented).toBe(false);
    expect((await key('ArrowLeft')).defaultPrevented).toBe(true);
    expect(active()).toBe('home');
    // the caret inside the text: → belongs to the text
    await type('web');
    input.setSelectionRange(1, 1);
    expect((await key('ArrowRight')).defaultPrevented).toBe(false);
    expect(active()).toBe('fav:/Users/me/Web');
    input.setSelectionRange(3, 3);
    await key('ArrowRight');
    expect(active()).toBe('recent:/Users/me/Web/dist');
  });

  it('filters while typing; Enter opens the first hit', async () => {
    const { el, host, key, type, active, shown } = await render();
    await key('ArrowDown');
    await type('DIST');
    expect(shown()).toEqual(['recent:/Users/me/Web/dist']);
    expect(active()).toBe('recent:/Users/me/Web/dist');
    expect(el.querySelector('[role="group"][aria-label="Favourites"]')).toBeNull();
    await key('Enter');
    expect(host.chosen).toEqual(['recent:/Users/me/Web/dist']);
  });

  it('says when nothing matches; Enter does nothing then', async () => {
    const { el, host, key, type } = await render();
    await type('nothing like this');
    expect(el.querySelectorAll('[role="option"]').length).toBe(0);
    expect(el.querySelector('.no-match')?.textContent).toContain('No matches');
    await key('Enter');
    expect(host.chosen).toEqual([]);
  });

  it('closes with Escape and Tab, a click chooses, a press outside closes', async () => {
    const { el, host, key } = await render();
    await key('Escape');
    await key('Tab');
    expect(host.closed).toEqual(['key', 'tab']);
    el.querySelector<HTMLElement>('[data-id="fav:/Users/me/Web"]')!.click();
    expect(host.chosen).toEqual(['fav:/Users/me/Web']);
    el.querySelector('.search')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(host.closed.length).toBe(2);
    el.querySelector('.opener')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(host.closed).toEqual(['key', 'tab', 'outside']);
  });
});
