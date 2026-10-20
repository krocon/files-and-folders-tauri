import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import { ConfigApi } from '../../core/config/config-api';
import { FsApi } from '../../core/fs/fs-api';
import { setLanguage } from '../../core/i18n/i18n';
import { JobsApi } from '../../core/jobs/jobs-api';
import { MrImportApi } from '../../core/mrimport/mr-import-api';
import { MrApply, MrApplyReport } from '../../core/mrimport/mr-import.models';
import { OsApi } from '../../core/os/os-api';
import { RenameApi } from '../../core/rename/rename-api';
import { SessionApi } from '../../core/session/session-api';
import { SettingsApi } from '../../core/settings/settings-api';
import { ThemeApi } from '../../core/theme/theme-api';
import { ThemeService } from '../../core/theme/theme.service';
import { ConfirmService } from '../../shared/dialog/confirm.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { FakeConfigApi } from '../../../testing/fake-config-api';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { area, emptyScan, FakeMrImportApi } from '../../../testing/fake-mr-import-api';
import { FakeOsApi } from '../../../testing/fake-os-api';
import { FakeRenameApi } from '../../../testing/fake-rename-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeSettingsApi } from '../../../testing/fake-settings-api';
import { FakeThemeApi } from '../../../testing/fake-theme-api';
import { FakeFsApi } from '../../../testing/fs-fixtures';
import { MrImportDialog } from './mr-import-dialog';
import { MrImportStore } from './mr-import.store';

const sc = (id: string, shortcut: string) => ({ id, shortcut, source: `${shortcut} → ${id}` });

describe('mr import (design 026)', () => {
  let api: FakeMrImportApi;
  let keymap: FakeKeymapApi;
  let themes: FakeThemeApi;

  async function setup() {
    api = new FakeMrImportApi();
    keymap = new FakeKeymapApi();
    themes = new FakeThemeApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: MrImportApi, useValue: api },
        { provide: KeymapApi, useValue: keymap },
        { provide: ThemeApi, useValue: themes },
        { provide: ConfigApi, useValue: new FakeConfigApi() },
        { provide: SettingsApi, useValue: new FakeSettingsApi() },
        { provide: FsApi, useValue: new FakeFsApi() },
        { provide: OsApi, useValue: new FakeOsApi() },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: RenameApi, useValue: new FakeRenameApi() },
        { provide: SessionApi, useValue: new FakeSessionApi() },
      ],
    });
    const actions = TestBed.inject(ActionService);
    actions.platform.set('linux');
    await actions.init();
    await TestBed.inject(ThemeService).init();
    return TestBed.inject(MrImportStore);
  }

  afterEach(() => setLanguage('en'));

  it('scans, plans, asks before replacing, writes and reloads the keymap', async () => {
    const store = await setup();
    api.result = emptyScan({
      shortcuts: area([sc('OPEN_COMMAND_PALETTE', 'Mod+F'), sc('CLONE_TAB', 'Mod+T')], {
        skipped: [{ item: 'cmd+alt+up → NAVIGATE_BACK', reason: 'never_fired' }],
      }),
      tools: area([
        { id: 'meld', label: 'Meld', program: 'meld', args: [], perFile: false, fileLimit: 10 },
      ]),
    });
    store.path.set(' /old/fnf ');
    await store.find();
    expect(api.scanned).toEqual(['/old/fnf']);
    expect(store.message()).toBe('Found: /old/apps/fnf-api/src/assets');
    const shortcuts = store.plans()[0];
    expect(shortcuts.count).toBe(1);
    expect(shortcuts.unchanged).toBe(1);
    expect(store.conflictText('shortcuts', shortcuts.conflicts[0])).toBe(
      'Ctrl+F: Find… → Go to anything…',
    );
    // tools are not checked by default (they start programs)
    expect([...store.chosen()]).toEqual(['shortcuts']);
    expect(store.conflictCount()).toBe(1);

    let written: MrApply | null = null;
    api.apply = (plan: MrApply): Promise<MrApplyReport> => {
      written = plan;
      keymap.loaded = { bindings: { ...plan.keymap }, warning: null };
      return Promise.resolve({
        imported: ['keymap'],
        warnings: [],
        backups: ['/cfg/keymap.json.bak'],
      });
    };
    const confirm = TestBed.inject(ConfirmService);
    const running = store.run();
    await Promise.resolve();
    expect(confirm.request()?.message).toBe(
      '1 existing entry changes (see “Details”). Backups are kept next to the files.',
    );
    confirm.answer(true);
    await running;
    expect(TestBed.inject(DialogService).open()).toBe('mr-import');
    expect(written!.keymap).toEqual({
      OPEN_FIND_DLG: ['Alt+F7'],
      OPEN_COMMAND_PALETTE: ['Mod+Shift+P', 'Mod+F'],
    });
    expect(written!.toolsFrom).toBeUndefined();
    const actions = TestBed.inject(ActionService);
    expect(actions.keymap().lookup.get('Mod+F')).toBe('OPEN_COMMAND_PALETTE');
    expect(store.message()).toBe('Imported: Keyboard shortcuts. 1 backup made.');
    // after the import the plan sees the new state: nothing left to do
    expect(store.plans()[0].count).toBe(0);
    expect(store.canImport()).toBe(false);
  });

  it('a declined question writes nothing; replace always asks', async () => {
    const store = await setup();
    api.result = emptyScan({ setup: area({ 'view.density': 'condensed' }) });
    store.path.set('/old');
    await store.find();
    store.mode.set('replace');
    const confirm = TestBed.inject(ConfirmService);
    const running = store.run();
    await Promise.resolve();
    expect(confirm.request()?.message).toContain('Replace:');
    confirm.answer(false);
    await running;
    expect(api.applied).toEqual([]);
  });

  it('not found, errors and stale answers', async () => {
    const store = await setup();
    api.failScan = { code: 'not_found', message: 'x', path: '/nope' };
    store.path.set('/nope');
    await store.find();
    expect(store.error()).toBe('No configuration of the old version was found in /nope.');
    expect(store.plans()).toEqual([]);
    api.failScan = null;
    store.path.set('/a');
    const first = store.find();
    api.result = emptyScan({ root: '/b/assets' });
    store.path.set('/b');
    await Promise.all([first, store.find()]);
    expect(store.scan()?.root).toBe('/b/assets');
  });

  it('colour files go through the theme import without switching the scheme', async () => {
    const store = await setup();
    const theme = TestBed.inject(ThemeService);
    const active = theme.active().id;
    themes.files.set('/old/color/custom/mine.json', {
      name: 'Mine',
      colors: { '--fnf-panel-bg-color': '#202020', '--fnf-text-color': '#f0f0f0' },
    });
    api.result = emptyScan({
      colors: area([
        { name: 'Mine', path: '/old/color/custom/mine.json' },
        { name: 'Gone', path: '/old/color/custom/gone.json' },
      ]),
    });
    store.path.set('/old');
    await store.find();
    await store.run();
    expect(api.applied[0]).toEqual({ backupThemes: true });
    expect(theme.userThemes().map((t) => t.name)).toEqual(['Mine']);
    expect(theme.active().id).toBe(active);
    expect(store.message()).toContain('Imported: Colour schemes.');
    expect(store.message()).toContain('/old/color/custom/gone.json');
    // a second look: "Mine" is an own scheme now and is not offered again
    const colors = store.plans().find((p) => p.area === 'colors')!;
    expect(colors.unchanged).toBe(1);
    expect(colors.colorPaths).toEqual(['/old/color/custom/gone.json']);
    expect(store.mode()).toBe('merge');
  });

  it('dialog: folder field, areas as checkboxes with summary and details, German texts', async () => {
    const store = await setup();
    setLanguage('de');
    api.result = emptyScan({
      shortcuts: area([sc('OPEN_COMMAND_PALETTE', 'Mod+F')], {
        unchanged: 4,
        skipped: [{ item: 'ctrl+up → ARROW_UP', reason: 'table_navigation' }],
      }),
      buttons: { ...area({}), error: 'broken' },
    });
    store.path.set('/old');
    const fixture = TestBed.createComponent(MrImportDialog);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    const input = el.querySelector<HTMLInputElement>('input.folder')!;
    expect(input.value).toBe('/old');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.scanned).toEqual(['/old']);
    const boxes = [...el.querySelectorAll<HTMLInputElement>('.areas input[type="checkbox"]')];
    expect(boxes.length).toBe(7);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].disabled).toBe(true);
    const summaries = [...el.querySelectorAll('.areas .summary')].map((s) => s.textContent?.trim());
    expect(summaries[0]).toBe(
      '1 zu importieren · 1 Konflikt · 1 nicht übertragbar · 4 unverändert',
    );
    expect(summaries[1]).toBe('die Datei ist ungültig');
    expect(summaries[2]).toBe('nicht gefunden');
    expect(boxes[0].getAttribute('aria-describedby')).toBe('fnf-mri-sum-shortcuts');
    expect(el.querySelector('.areas label')?.textContent?.trim()).toBe('Tastenkürzel (Linux)');
    const details = el.querySelector('details')!;
    expect(details.textContent).toContain('Navigationstasten gehören jetzt der Dateiliste');
    expect(details.textContent).toContain('Ctrl+F: Suchen… → Schnellzugriff…');
    const importButton = [...el.querySelectorAll<HTMLButtonElement>('.foot button')].pop()!;
    expect(importButton.disabled).toBe(false);
    boxes[0].click();
    fixture.detectChanges();
    expect(importButton.disabled).toBe(true);
    expect(el.querySelectorAll('input[type="radio"]').length).toBe(2);
  });
});
