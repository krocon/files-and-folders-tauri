import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActionService } from '../../core/actions/action.service';
import { KeymapApi } from '../../core/actions/keymap-api';
import linuxKeymap from '../../core/actions/keymaps/linux.json';
import macosKeymap from '../../core/actions/keymaps/macos.json';
import windowsKeymap from '../../core/actions/keymaps/windows.json';
import { DirEntry, EntryKind } from '../../core/fs/fs.models';
import { FsApi } from '../../core/fs/fs-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { SessionApi } from '../../core/session/session-api';
import { SettingsApi } from '../../core/settings/settings-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { GridColumn, PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { FakeJobsApi } from '../../../testing/fake-jobs-api';
import { FakeKeymapApi } from '../../../testing/fake-keymap-api';
import { FakeSessionApi } from '../../../testing/fake-session-api';
import { FakeSettingsApi } from '../../../testing/fake-settings-api';
import { entry, FakeFsApi } from '../../../testing/fs-fixtures';
import { ACTIONS_MENU_COLUMNS } from '../actions/actions-menu-def';
import { FileBrowserStore } from '../browser/file-browser.store';
import { FileTypesStore } from '../config/file-types.store';
import { contextMenuFor, MENU_BAR } from '../menus/menu-model';
import { WorkspaceStore } from '../workspace/workspace.store';
import { registerSelectIfActions } from './select-if-actions';
import { SelectIfDialog } from './select-if-dialog';
import catalog from './select-if-engine.cases.json';
import { SELECT_IF_PRESETS } from './select-if-presets';
import { SelectIfStore } from './select-if.store';

/** Lightweight PreviewGrid stub for jsdom (GuiExpert Table needs layout / ResizeObserver). */
@Component({ selector: 'app-preview-grid', template: '{{ rows().length }} rows' })
class StubPreviewGrid {
  readonly columns = input.required<readonly GridColumn[]>();
  readonly rows = input.required<readonly unknown[]>();
  readonly rowClass = input<(row: never) => string | null>();
  readonly labelledBy = input<string | null>(null);
}

interface RawFixtureEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: string;
  readonly size?: number | null;
  readonly modifiedMs?: number | null;
}

const DL = '/Users/marc/Downloads';

function buildMarcEntries(): DirEntry[] {
  const raw = catalog.fixtures.marcDownloads as readonly RawFixtureEntry[];
  return raw
    .filter((r) => r.name !== '..')
    .map((r) =>
      entry(r.name, {
        path: r.path,
        kind: r.kind as EntryKind,
        size: r.size ?? null,
        modifiedMs: r.modifiedMs ?? null,
      }),
    );
}

describe('SelectIfStore, actions and SelectIfDialog (design 046)', () => {
  let fsApi: FakeFsApi;
  let settingsApi: FakeSettingsApi;
  let settings: SettingsStore;
  let actions: ActionService;
  let dialogs: DialogService;
  let store: SelectIfStore;
  let fileTypes: FileTypesStore;
  let left: FileBrowserStore;
  let right: FileBrowserStore;

  beforeEach(async () => {
    fsApi = new FakeFsApi();
    const marcEntries = buildMarcEntries();
    fsApi.handler = (path?: string) => {
      const p = path ?? DL;
      return Promise.resolve({
        path: p,
        parent: p === '/' ? null : '/',
        segments: [{ name: '/', path: '/' }, ...(p === '/' ? [] : [{ name: p.slice(1), path: p }])],
        entries:
          p === DL
            ? marcEntries
            : p === '/empty'
              ? []
              : [
                  entry('By Any Means (2026).mkv', {
                    path: `${p}/By Any Means (2026).mkv`,
                    size: 7_086_696_038,
                    modifiedMs: 1_793_421_960_000,
                  }),
                ],
        unreadableEntries: 0,
      });
    };
    settingsApi = new FakeSettingsApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: FsApi, useValue: fsApi },
        { provide: JobsApi, useValue: new FakeJobsApi() },
        { provide: SettingsApi, useValue: settingsApi },
        { provide: SessionApi, useValue: new FakeSessionApi() },
        { provide: KeymapApi, useValue: new FakeKeymapApi() },
      ],
    }).overrideComponent(SelectIfDialog, {
      remove: { imports: [PreviewGrid] },
      add: { imports: [StubPreviewGrid] },
    });
    settings = TestBed.inject(SettingsStore);
    await settings.init();
    actions = TestBed.inject(ActionService);
    dialogs = TestBed.inject(DialogService);
    store = TestBed.inject(SelectIfStore);
    fileTypes = TestBed.inject(FileTypesStore);
    const ws = TestBed.inject(WorkspaceStore);
    left = TestBed.runInInjectionContext(() => new FileBrowserStore());
    right = TestBed.runInInjectionContext(() => new FileBrowserStore());
    ws.registerPanel('left', { store: left, controller: () => undefined });
    ws.registerPanel('right', { store: right, controller: () => undefined });
    registerSelectIfActions(actions, store);
  });

  it('enables OPEN_SELECT_IF_DLG only when selectable entries are displayed', async () => {
    expect(actions.state('OPEN_SELECT_IF_DLG')).toBe('disabled');
    await left.load('/empty');
    expect(actions.state('OPEN_SELECT_IF_DLG')).toBe('disabled');
    await left.load(DL);
    expect(actions.state('OPEN_SELECT_IF_DLG')).toBe('ready');
  });

  it('reproduces Marc’s screenshot workflow (18 = 9 movies + 9 covers), excluded toggle, presets and remembers last rule', async () => {
    await left.load(DL);
    await right.load('/backup');
    await actions.run('OPEN_SELECT_IF_DLG');
    expect(dialogs.open()).toBe('select-if');

    // Default rule is Preset 1: Movies with cover image (select both)
    expect(store.evaluation().rulePrimaryPaths.size).toBe(9);
    expect(store.evaluation().ruleCompanionPaths.size).toBe(9);
    expect(store.evaluation().nextMarkedPaths.size).toBe(18);
    expect(store.summaryText()).toContain(
      '18 of 35 entries will be marked (9 primary + 9 companions',
    );
    expect(store.previewRows().length).toBe(18);

    // Toggling showExcluded shows non-matching candidates too, including Meine Schwester und ich (2005).mkv
    store.showExcluded.set(true);
    const excludedMovie = store
      .previewRows()
      .find((r) => r.name === 'Meine Schwester und ich (2005).mkv');
    expect(excludedMovie?.role).toBe('excluded');

    // Preset 2: Movies without cover image -> 1 entry
    const withoutCover = SELECT_IF_PRESETS.find((p) => p.id === 'moviesWithoutCover')!;
    store.setRule(withoutCover.rule);
    store.showExcluded.set(false);
    expect(store.previewRows().map((r) => r.name)).toEqual(['Meine Schwester und ich (2005).mkv']);

    // Preset 4: Orphaned images without matching movie -> mainboard_1.webp
    const orphaned = SELECT_IF_PRESETS.find((p) => p.id === 'orphanedImages')!;
    store.setRule(orphaned.rule);
    expect(store.previewRows().map((r) => r.name)).toEqual(['mainboard_1.webp']);

    // Switch back to Preset 1 and apply
    const withCover = SELECT_IF_PRESETS.find((p) => p.id === 'moviesWithCover')!;
    store.setRule(withCover.rule);
    expect(store.apply()).toBe(true);
    expect(dialogs.open()).toBeNull();
    expect(left.marked().size).toBe(18);
    expect(left.marked().has(`${DL}/By Any Means (2026).mkv`)).toBe(true);
    expect(left.marked().has(`${DL}/By Any Means (2026).jpg`)).toBe(true);
    expect(left.marked().has(`${DL}/Meine Schwester und ich (2005).mkv`)).toBe(false);
    expect(left.marked().has(`${DL}/mainboard_1.webp`)).toBe(false);

    // Verify last rule was saved in dialogs.recent and restores on a fresh SelectIfStore session
    store.open();
    store.setRule(orphaned.rule);
    expect(store.apply()).toBe(true);
    expect([...left.marked()]).toEqual([`${DL}/mainboard_1.webp`]);

    const freshStore = TestBed.runInInjectionContext(() => new SelectIfStore());
    freshStore.open();
    expect(freshStore.rule().targetMatcher).toEqual({ kind: 'category', category: 'images' });
    expect(freshStore.previewRows().map((r) => r.name)).toEqual(['mainboard_1.webp']);
  });

  it('supports add, remove and intersect combine modes on existing marks', async () => {
    await left.load(DL);
    left.replaceMarks(
      left.visibleEntries().map((e) => e.path),
      new Set([`${DL}/Kronberg_Marc.pdf`, `${DL}/Coup (2019).mkv`]),
    );

    // Add: 2 existing + 18 (with 1 overlap: Coup (2019).mkv) = 19
    store.open();
    store.patchRule({ combineMode: 'add' });
    expect(store.apply()).toBe(true);
    expect(left.marked().size).toBe(19);
    expect(left.marked().has(`${DL}/Kronberg_Marc.pdf`)).toBe(true);

    // Remove: unmark the 18 movies+covers -> only Kronberg_Marc.pdf remains
    store.open();
    store.patchRule({ combineMode: 'remove' });
    expect(store.apply()).toBe(true);
    expect([...left.marked()]).toEqual([`${DL}/Kronberg_Marc.pdf`]);

    // Intersect: mark 2 again, intersect with movies+covers -> only Coup (2019).mkv remains
    left.replaceMarks(
      left.visibleEntries().map((e) => e.path),
      new Set([`${DL}/Kronberg_Marc.pdf`, `${DL}/Coup (2019).mkv`]),
    );
    store.open();
    store.patchRule({ combineMode: 'intersect' });
    expect(store.apply()).toBe(true);
    expect([...left.marked()]).toEqual([`${DL}/Coup (2019).mkv`]);
  });

  it('saves, overwrites and deletes user templates and warns when a category was deleted', async () => {
    await left.load(DL);
    fileTypes.user.set([
      ...fileTypes.builtIn,
      { label: 'custom-raw', extensions: ['arw', 'cr3'], icon: null, color: null },
    ]);
    store.open();
    store.patchRule({
      targetMatcher: { kind: 'category', category: 'custom-raw' },
    });

    expect(store.saveTemplate('My RAW Rule')).toBe(true);
    expect(store.templates().map((t) => t.label)).toEqual(['My RAW Rule']);

    // Overwriting same name (case-insensitive) updates in place without duplicating
    store.patchRule({ combineMode: 'add' });
    expect(store.saveTemplate('my raw rule')).toBe(true);
    expect(store.templates().length).toBe(1);
    expect(store.templates()[0].rule.combineMode).toBe('add');

    // Now delete the user category 'custom-raw' from FileTypesStore -> rule immediately warns & blocks apply
    fileTypes.user.set(null);
    expect(store.evaluation().problems[0]?.code).toBe('unknownCategory');
    expect(store.canApply()).toBe(false);

    // Delete template
    store.deleteTemplate('my raw rule');
    expect(store.templates()).toEqual([]);
  });

  it('renders accessible form controls, defers aria-invalid until blur/submit and guards IME Enter', async () => {
    await left.load(DL);
    store.open();
    const fixture = TestBed.createComponent(SelectIfDialog);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    // Combine mode radio group uses <fieldset> + <legend> (< 6 choices)
    const combineRadios = [
      ...el.querySelectorAll<HTMLInputElement>('input[type="radio"][name="fnf-si-combine"]'),
    ];
    expect(combineRadios.map((r) => r.value)).toEqual(['replace', 'add', 'remove', 'intersect']);

    // Switch target matcher from 'category' to 'regex'
    const selects = [...el.querySelectorAll<HTMLSelectElement>('.section-box select')];
    const matcherKindSelect = selects[1];
    matcherKindSelect.value = 'regex';
    matcherKindSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const patternInput = el.querySelector<HTMLInputElement>('.section-box input[type="text"]')!;
    expect(patternInput.getAttribute('autocorrect')).toBe('off');
    expect(patternInput.getAttribute('autocapitalize')).toBe('off');
    expect(patternInput.getAttribute('spellcheck')).toBe('false');
    expect(patternInput.getAttribute('autocomplete')).toBe('off');

    // Type an invalid regex: aria-invalid MUST NOT appear prematurely while typing
    patternInput.value = '[unclosed';
    patternInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(store.canApply()).toBe(false);
    expect(patternInput.getAttribute('aria-invalid')).toBeNull();
    expect(el.querySelector('#fnf-si-error')?.textContent?.trim()).toBe('');

    // Blur the field: aria-invalid="true" and inline error message appear simultaneously
    patternInput.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(patternInput.getAttribute('aria-invalid')).toBe('true');
    expect(patternInput.getAttribute('aria-describedby')).toBe('fnf-si-error');
    expect(el.querySelector('#fnf-si-error')?.textContent).toContain('Invalid regular expression');

    // Resuming typing clears aria-invalid immediately; entering a valid regex allows submission
    patternInput.value = '^Real Genius.*\\.mkv$';
    patternInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(patternInput.getAttribute('aria-invalid')).toBeNull();
    expect(store.canApply()).toBe(true);

    // IME composition guard: Mod+Enter with isComposing: true must NOT submit
    const composingEvt = new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    el.dispatchEvent(composingEvt);
    fixture.detectChanges();
    expect(dialogs.open()).toBe('select-if');
    expect(left.marked().size).toBe(0);

    // Mod+Enter with isComposing: false submits and marks Real Genius + its cover jpg
    const submitEvt = new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
      cancelable: true,
      isComposing: false,
    });
    el.dispatchEvent(submitEvt);
    fixture.detectChanges();
    expect(dialogs.open()).toBeNull();
    expect([...left.marked()].sort()).toEqual([
      `${DL}/Real Genius (1985).jpg`,
      `${DL}/Real Genius (1985).mkv`,
    ]);
  });

  it('wires Mod+Alt+S without collisions across all keymaps and exposes OPEN_SELECT_IF_DLG in menus', () => {
    for (const [name, km] of [
      ['macos', macosKeymap],
      ['windows', windowsKeymap],
      ['linux', linuxKeymap],
    ] as const) {
      const record = km as Record<string, readonly string[]>;
      expect(record['OPEN_SELECT_IF_DLG'], `${name} OPEN_SELECT_IF_DLG`).toEqual(['Mod+Alt+S']);
      const owners: string[] = [];
      for (const [actionId, keys] of Object.entries(record)) {
        if (keys.includes('Mod+Alt+S')) {
          owners.push(actionId);
        }
      }
      expect(owners, `${name} Mod+Alt+S owners`).toEqual(['OPEN_SELECT_IF_DLG']);
    }

    const editMenu = MENU_BAR.find((m) => m.id === 'edit')!;
    expect(editMenu.items).toContain('OPEN_SELECT_IF_DLG');
    expect(ACTIONS_MENU_COLUMNS[1]).toContain('OPEN_SELECT_IF_DLG');
    expect(contextMenuFor('marked', 2)).toContain('OPEN_SELECT_IF_DLG');
    expect(contextMenuFor('empty')).toContain('OPEN_SELECT_IF_DLG');
    expect(contextMenuFor('archive')).toContain('OPEN_SELECT_IF_DLG');
  });
});
