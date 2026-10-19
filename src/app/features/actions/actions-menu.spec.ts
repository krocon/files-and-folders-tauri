import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { setLanguage } from '../../core/i18n/i18n';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { ActionsMenu } from './actions-menu';

describe('Actions menu ▴ (design 020)', () => {
  afterEach(() => setLanguage('en'));

  async function render(platform: 'macos' | 'linux' = 'macos') {
    TestBed.configureTestingModule({
      imports: [ActionsMenu],
      providers: [{ provide: KeymapApi, useValue: new FakeKeymapApi() }],
    });
    const actions = TestBed.inject(ActionService);
    actions.platform.set(platform);
    await actions.init();
    const ran: string[] = [];
    actions.register({
      OPEN_COPY_DLG: { run: () => void ran.push('copy') },
      SELECT_ALL: { run: () => void ran.push('all') },
      DESELECT_ALL: { run: () => void ran.push('none') },
      OPEN_FIND_DLG: { run: () => void ran.push('find') },
    });
    actions.setExtras([
      {
        id: 'tool:edit',
        label: 'Edit',
        shortcut: 'Mod+E',
        enabled: () => true,
        run: () => undefined,
      },
    ]);
    const fixture = TestBed.createComponent(ActionsMenu);
    const closed: string[] = [];
    fixture.componentInstance.closed.subscribe((r) => closed.push(r));
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const item = (id: string) => el.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    const key = (k: string) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true }),
      );
    return { fixture, el, item, key, ran, closed };
  }

  it('four columns without headings, dividers as separators, short labels like the old version', async () => {
    const { el } = await render();
    const groups = el.querySelectorAll('[role="group"]');
    expect(groups).toHaveLength(4);
    expect(el.querySelector('.heading')).toBeNull();
    const labels = (g: Element) =>
      [...g.children].map((c) =>
        c.getAttribute('role') === 'separator' ? '-' : c.querySelector('.label')?.textContent,
      );
    expect(labels(groups[0]).slice(0, 4)).toEqual([
      'Go to anything…',
      '-',
      'Reload',
      'Change Dir…',
    ]);
    expect(labels(groups[1])).toContain('Parent Dir');
    expect(labels(groups[2]).slice(0, 5)).toEqual([
      'Copy',
      'Move',
      'Delete',
      'Delete permanently',
      'MkDir',
    ]);
    expect(labels(groups[3]).slice(0, 1)).toEqual(['Setup…']);
    // the tools after the last divider
    expect(labels(groups[3]).slice(-2)).toEqual(['-', 'Edit']);
    expect(el.querySelectorAll('[role="separator"]').length).toBeGreaterThanOrEqual(8);
  });

  it('shortcuts as badges (^ ⌘ alt ⇧, one badge per stroke), plain text for screen readers', async () => {
    const { item } = await render('macos');
    const badges = (id: string) =>
      [...item(id).querySelectorAll('.badge')].map((b) => b.textContent?.replace(/\s+/g, ''));
    expect(badges('OPEN_COPY_DLG')).toEqual(['f5']);
    expect(badges('TOGGLE_FILTER')).toEqual(['⌘+alt+f']);
    expect(badges('tool:edit')).toEqual(['⌘+e']);
    expect(item('TOGGLE_FILTER').getAttribute('aria-keyshortcuts')).toBe('⌥⌘F');
  });

  it('↓/↑ skip the dividers, ←/→ change the column, Home/End, Enter runs and closes', async () => {
    vi.useFakeTimers();
    try {
      const { item, key, ran, closed } = await render();
      expect(document.activeElement).toBe(item('OPEN_COMMAND_PALETTE'));
      key('ArrowDown');
      expect(document.activeElement).toBe(item('RELOAD_DIR'));
      key('ArrowRight');
      expect(document.activeElement).toBe(item('OPEN_MARK_PATTERN_DLG'));
      key('ArrowUp');
      expect(document.activeElement).toBe(item('OPEN_FIND_DLG'));
      key('End');
      expect(document.activeElement).toBe(item('CLOSE_TAB'));
      key('Home');
      key('Enter');
      vi.runAllTimers();
      expect(ran).toEqual(['find']);
      expect(closed).toEqual(['chosen']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Esc closes without running; a dimmed entry does nothing', async () => {
    const { item, key, ran, closed } = await render();
    item('OPEN_BUTTON_CONFIG_DLG').click();
    expect(closed).toEqual([]);
    key('Escape');
    expect(closed).toEqual(['key']);
    expect(ran).toEqual([]);
  });

  it('labels follow the language', async () => {
    const { fixture, item } = await render();
    setLanguage('de');
    fixture.detectChanges();
    expect(item('OPEN_MKDIR_DLG').querySelector('.label')?.textContent).toBe('Ordner anlegen');
  });
});
