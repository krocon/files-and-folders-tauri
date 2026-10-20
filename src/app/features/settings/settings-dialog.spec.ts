import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { KeymapApi } from '../../core/actions/keymap-api';
import { FsApi } from '../../core/fs/fs-api';
import { setLanguage } from '../../core/i18n/i18n';
import { JobsApi } from '../../core/jobs/jobs-api';
import { OsApi } from '../../core/os/os-api';
import { RenameApi } from '../../core/rename/rename-api';
import { SessionApi } from '../../core/session/session-api';
import { DISPLAY } from '../../core/settings/display';
import { SettingsApi } from '../../core/settings/settings-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { ThemeApi } from '../../core/theme/theme-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeOsApi } from '../../../testing/fake-os-api';
import { FakeRenameApi } from '../../../testing/fake-rename-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeSettingsApi } from '../../../testing/fake-settings-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { FakeFsApi } from '../../../testing/fs-fixtures';
import { SettingsDialog } from './settings-dialog';

describe('SettingsDialog', () => {
  let api: FakeSettingsApi;

  async function render() {
    api = new FakeSettingsApi();
    TestBed.configureTestingModule({
      imports: [SettingsDialog],
      providers: [
        { provide: SettingsApi, useValue: api },
        { provide: FsApi, useValue: new FakeFsApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
        { provide: ThemeApi, useValue: new FakeThemeApi() },
        { provide: OsApi, useValue: new FakeOsApi() },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: RenameApi, useValue: new FakeRenameApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
      ],
    });
    await TestBed.inject(SettingsStore).init();
    const fixture = TestBed.createComponent(SettingsDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => {
    setLanguage('en');
    DISPLAY.sizeFormat.set('binary');
  });

  it('is a modal with vertical tabs (APG) and moves with the arrow keys', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLElement>('[data-section="general"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    const list = el.querySelector('[role="tablist"]')!;
    expect(list.getAttribute('aria-orientation')).toBe('vertical');
    const tabs = [...el.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((t) => t.getAttribute('aria-selected'))[0]).toBe('true');
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    const selected = el.querySelector('[role="tab"][aria-selected="true"]')!;
    expect(selected.textContent?.trim()).toBe('View');
    expect(el.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(
      selected.id,
    );
  });

  it('applies a change at once and resets the section', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLElement>('[data-section="view"]')!.click();
    fixture.detectChanges();
    const select = el.querySelector<HTMLSelectElement>('[data-key="view.sizeFormat"] select')!;
    select.value = 'decimal';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(DISPLAY.sizeFormat()).toBe('decimal');
    expect(el.querySelector('[data-key="view.sizeFormat"] .changed')).not.toBeNull();
    const reset = [...el.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Reset section',
    )!;
    reset.click();
    fixture.detectChanges();
    expect(TestBed.inject(SettingsStore).get('view.sizeFormat')).toBe('binary');
  });

  it('switches the language without a restart', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLElement>('[data-section="general"]')!.click();
    fixture.detectChanges();
    const select = el.querySelector<HTMLSelectElement>('[data-key="general.language"] select')!;
    select.value = 'de';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('h2')?.textContent).toContain('Einstellungen');
    expect(el.querySelector('[data-section="view"]')?.textContent?.trim()).toBe('Ansicht');
  });

  it('searches across the sections', async () => {
    const { fixture, el } = await render();
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'trash';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(el.querySelector('[data-key="behavior.deleteToTrash"]')).not.toBeNull();
    expect(el.querySelector('[data-key="view.sizeFormat"]')).toBeNull();
    expect(el.querySelector('[aria-live="polite"]')?.textContent).toContain('settings found');
  });

  it('exports into the folder and imports the chosen parts (tools off by default)', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLElement>('[data-section="data"]')!.click();
    fixture.detectChanges();
    const inputs = el.querySelectorAll<HTMLInputElement>('.panel input[type="text"]');
    inputs[0].value = '/tmp/out';
    inputs[0].dispatchEvent(new Event('input'));
    inputs[1].value = '/tmp/in.json';
    inputs[1].dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const button = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === label,
      )!;
    button('Export').click();
    await fixture.whenStable();
    expect(api.exports).toEqual(['/tmp/out']);
    api.importReport = { imported: ['settings'], warnings: [] };
    button('Import').click();
    await fixture.whenStable();
    expect(api.imports[0].parts).toEqual([
      'settings',
      'keymap',
      'themes',
      'renamePresets',
      'buttons',
      'fileTypes',
    ]);
    fixture.detectChanges();
    expect(el.querySelector('.message')?.textContent).toContain('Imported: Settings.');
    expect(TestBed.inject(DialogService).open()).toBeNull();
  });

  it('reports every warning of an import: failed parts and reset values (review 015 #4/#12)', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLElement>('[data-section="data"]')!.click();
    fixture.detectChanges();
    const inputs = el.querySelectorAll<HTMLInputElement>('.panel input[type="text"]');
    inputs[1].value = '/tmp/in.json';
    inputs[1].dispatchEvent(new Event('input'));
    fixture.detectChanges();
    api.importReport = {
      imported: ['settings'],
      warnings: [
        { code: 'part_failed', key: 'keymap', path: '/cfg/keymap.json' },
        { code: 'invalid_value', key: 'view.density', path: null },
      ],
    };
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Import')!
      .click();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = el.querySelector('.message')?.textContent ?? '';
    expect(text).toContain('could not be written (/cfg/keymap.json)');
    expect(text).toContain('view.density');
  });
});
