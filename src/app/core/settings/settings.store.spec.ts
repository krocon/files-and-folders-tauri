import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSettingsApi } from '../../../testing/fake-settings-api';
import { language, setLanguage } from '../i18n/i18n';
import { DISPLAY } from './display';
import { SettingsApi } from './settings-api';
import { SAVE_DELAY_MS, SettingsStore } from './settings.store';
import { DEFAULTS, ROW_HEIGHTS, SCHEMA, SETTING_KEYS, acceptsValue } from './settings.models';
import { ROW_HEIGHT } from '../../features/browser/file-list/file-table-model';
// @ts-expect-error – node module in a spec (vitest runs in node)
import { readFileSync } from 'node:fs';

describe('settings schema', () => {
  it('has a valid default for every key and the TS keys match the JSON', () => {
    for (const k of SETTING_KEYS) {
      expect(acceptsValue(SCHEMA[k], DEFAULTS[k]), k).toBe(true);
    }
    const json = JSON.parse(readFileSync('src/app/core/settings/settings-schema.json', 'utf8'));
    expect(Object.keys(json).sort()).toEqual([...SETTING_KEYS].sort());
    expect(DEFAULTS['view.density']).toBe('normal');
  });
});

describe('SettingsStore', () => {
  let api: FakeSettingsApi;
  let store: SettingsStore;

  beforeEach(() => {
    vi.useFakeTimers();
    api = new FakeSettingsApi();
    TestBed.configureTestingModule({ providers: [{ provide: SettingsApi, useValue: api }] });
    store = TestBed.inject(SettingsStore);
  });

  afterEach(() => {
    vi.useRealTimers();
    setLanguage('en');
    DISPLAY.sizeFormat.set('binary');
    DISPLAY.dateFormat.set('locale');
  });

  it('a file that could not be read is never overwritten (review 015 #9)', async () => {
    api.load = () => Promise.reject({ code: 'io', message: 'EACCES', path: null });
    await store.init();
    expect(store.warnings().map((w) => w.code)).toEqual(['unreadable']);
    store.set('view.sizeFormat', 'bytes');
    expect(store.get('view.sizeFormat')).toBe('bytes');
    await store.flush();
    expect(api.saved).toEqual([]);
  });

  it('a reload drops a save that is still waiting (the file wins, review 015 #8)', async () => {
    await store.init();
    store.set('view.sizeFormat', 'bytes');
    api.loaded = { settings: { 'view.sizeFormat': 'decimal' }, warnings: [], persist: true };
    await store.load();
    await vi.runAllTimersAsync();
    expect(api.saved).toEqual([]);
    expect(store.get('view.sizeFormat')).toBe('decimal');
  });

  it('starts with the defaults and merges the file', async () => {
    expect(store.get('view.sizeFormat')).toBe('binary');
    api.loaded = {
      settings: { 'view.sizeFormat': 'decimal', 'view.density': 'nope', 'future.x': 1 },
      warnings: [{ code: 'invalid_value', key: 'view.menuBar', path: null }],
      persist: true,
    };
    await store.init();
    expect(store.get('view.sizeFormat')).toBe('decimal');
    expect(store.get('view.density')).toBe('normal');
    expect(DISPLAY.sizeFormat()).toBe('decimal');
    expect(store.warnings()).toHaveLength(1);
    expect(store.isChanged('view.sizeFormat')).toBe(true);
  });

  it('applies at once and saves debounced, only the differences, unknown keys kept', async () => {
    api.loaded = { settings: { 'future.x': 1 }, warnings: [], persist: true };
    await store.init();
    store.set('view.dateFormat', 'iso');
    store.set('view.folderBrackets', true);
    store.set('view.folderBrackets', false);
    expect(DISPLAY.dateFormat()).toBe('iso');
    expect(api.saved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(api.saved).toEqual([{ 'future.x': 1, 'view.dateFormat': 'iso' }]);
  });

  it('ignores invalid values', async () => {
    await store.init();
    store.set('view.density', 'huge' as never);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(store.get('view.density')).toBe('normal');
    expect(api.saved).toHaveLength(0);
  });

  it('resets a section and everything', async () => {
    await store.init();
    store.set('view.sizeFormat', 'bytes');
    store.set('view.menuBar', false);
    store.set('behavior.confirmTrash', false);
    store.reset(['view.sizeFormat', 'view.menuBar']);
    expect(store.get('view.sizeFormat')).toBe('binary');
    expect(store.get('behavior.confirmTrash')).toBe(false);
    store.resetAll();
    expect(store.get('behavior.confirmTrash')).toBe(true);
    await store.flush();
    expect(api.saved.at(-1)).toEqual({});
  });

  it('switches the language (system resolves via navigator)', async () => {
    await store.init();
    store.set('general.language', 'de');
    expect(language()).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    store.set('general.language', 'en');
    expect(language()).toBe('en');
  });

  it('does not write when the file must not be overwritten', async () => {
    api.loaded = {
      settings: {},
      warnings: [{ code: 'newer_version', key: null, path: 'x' }],
      persist: false,
    };
    await store.init();
    store.set('view.menuBar', false);
    expect(store.get('view.menuBar')).toBe(false);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 10);
    expect(api.saved).toHaveLength(0);
  });

  it('reports a failed save', async () => {
    await store.init();
    api.failSave = true;
    store.set('view.menuBar', false);
    await store.flush();
    expect(store.saveError()).toBe('disk full');
  });
});

describe('row heights (design 015)', () => {
  it('density "normal" is the height the file list is built with', () => {
    expect(ROW_HEIGHTS.normal).toBe(ROW_HEIGHT);
  });
});
