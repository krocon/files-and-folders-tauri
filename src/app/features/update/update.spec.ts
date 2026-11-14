import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsApi } from '../../core/settings/settings-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { UpdateApi } from '../../core/update/update-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { MENU_BAR } from '../menus/menu-model';
import { FakeSettingsApi } from '../../../testing/fake-settings-api';
import { FakeUpdateApi, updateInfo } from '../../../testing/fake-update-api';
import { openUpdateCheck, openUpdateHint } from './update-actions';
import { releaseDate, UpdateDialog } from './update-dialog';
import {
  AUTO_FIRST_DELAY_MS,
  AUTO_INTERVAL_MS,
  AUTO_TICK_MS,
  autoCheckDue,
  UpdateStore,
} from './update.store';

const flush = () => new Promise((r) => setTimeout(r));

describe('update check (075)', () => {
  let api: FakeUpdateApi;
  let settingsApi: FakeSettingsApi;

  async function setup(auto = false): Promise<UpdateStore> {
    api = new FakeUpdateApi();
    settingsApi = new FakeSettingsApi();
    if (auto) {
      settingsApi.loaded = { ...settingsApi.loaded, settings: { 'general.checkForUpdates': true } };
    }
    TestBed.configureTestingModule({
      providers: [
        { provide: UpdateApi, useValue: api },
        { provide: SettingsApi, useValue: settingsApi },
      ],
    });
    await TestBed.inject(SettingsStore).init();
    return TestBed.inject(UpdateStore);
  }

  afterEach(() => vi.useRealTimers());

  describe('autoCheckDue', () => {
    it('is due without a check, after a day, or with a clock set back', () => {
      const now = 10 * AUTO_INTERVAL_MS;
      expect(autoCheckDue(undefined, now)).toBe(true);
      expect(autoCheckDue(now - AUTO_INTERVAL_MS, now)).toBe(true);
      expect(autoCheckDue(now - AUTO_INTERVAL_MS + 1, now)).toBe(false);
      expect(autoCheckDue(now + 1000, now)).toBe(true);
    });
  });

  describe('manual check', () => {
    it('shows checking, then the result, and clears a hint', async () => {
      const store = await setup();
      store.hint.set(updateInfo());
      const done = store.check();
      expect(store.view().kind).toBe('checking');
      await done;
      expect(store.view()).toEqual({ kind: 'done', info: updateInfo() });
      expect(store.hint()).toBeNull();
    });

    it('errors are shown as FsError', async () => {
      const store = await setup();
      api.answer = { error: { code: 'update_offline', message: 'x', path: null } };
      await store.check();
      const v = store.view();
      expect(v.kind === 'error' && v.error.code).toBe('update_offline');
    });

    it('a cancelled check drops its late answer', async () => {
      const store = await setup();
      let release!: () => void;
      api.gate = new Promise((r) => (release = r));
      const done = store.check();
      store.cancel();
      expect(store.view().kind).toBe('idle');
      release();
      await done;
      expect(store.view().kind).toBe('idle');
    });

    it('a second check makes the first one stale', async () => {
      const store = await setup();
      let release!: () => void;
      api.gate = new Promise((r) => (release = r));
      api.answer = updateInfo({ latest: '1.5.0' });
      const first = store.check();
      api.gate = null;
      api.answer = updateInfo({ latest: '1.6.0' });
      await store.check();
      release();
      await first;
      const v = store.view();
      expect(v.kind === 'done' && v.info.latest).toBe('1.6.0');
    });

    it('skip remembers the version and removes its hint; null forgets', async () => {
      const store = await setup();
      store.hint.set(updateInfo());
      await store.skip('1.5.0');
      expect(api.state.skipped).toBe('1.5.0');
      expect(store.skipped()).toBe('1.5.0');
      expect(store.hint()).toBeNull();
      await store.skip(null);
      expect(api.state.skipped).toBeUndefined();
    });

    it('opens the release page of the result (Rust checks it)', async () => {
      const store = await setup();
      await store.check();
      await store.openReleasePage();
      expect(api.opened).toEqual([updateInfo().releaseUrl]);
    });
  });

  describe('automatic check', () => {
    it('is off by default: no request ever', async () => {
      vi.useFakeTimers();
      const store = await setup(false);
      const stop = store.startAuto();
      await vi.advanceTimersByTimeAsync(AUTO_FIRST_DELAY_MS + 3 * AUTO_TICK_MS);
      expect(api.checks).toBe(0);
      stop();
    });

    it('when on: 30 s after the start, then at most once a day', async () => {
      vi.useFakeTimers();
      const store = await setup(true);
      const stop = store.startAuto();
      await vi.advanceTimersByTimeAsync(AUTO_FIRST_DELAY_MS - 1);
      expect(api.checks).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(api.checks).toBe(1);
      expect(store.hint()?.latest).toBe('1.5.0');
      await vi.advanceTimersByTimeAsync(23 * AUTO_TICK_MS);
      expect(api.checks).toBe(1);
      await vi.advanceTimersByTimeAsync(AUTO_TICK_MS);
      expect(api.checks).toBe(2);
      stop();
      await vi.advanceTimersByTimeAsync(2 * AUTO_INTERVAL_MS);
      expect(api.checks).toBe(2);
    });

    it('respects a recent check from the last run of the app', async () => {
      const store = await setup(true);
      api.state = { lastCheck: Date.now() - 1000 };
      await store.autoCheck();
      expect(api.checks).toBe(0);
    });

    it('no hint for a skipped, an equal version or on errors', async () => {
      const store = await setup(true);
      api.state = { skipped: '1.5.0' };
      await store.autoCheck();
      expect(api.checks).toBe(1);
      expect(store.hint()).toBeNull();

      api.state = {};
      api.answer = updateInfo({ newer: false, latest: '1.4.0' });
      await store.autoCheck();
      expect(store.hint()).toBeNull();

      api.state = {};
      api.answer = { error: { code: 'update_rate_limited', message: 'x', path: null } };
      await store.autoCheck();
      expect(store.hint()).toBeNull();
      expect(store.view().kind).toBe('idle');
    });
  });

  describe('actions', () => {
    it('CHECK_FOR_UPDATES opens the dialog and checks; the hint shows without a request', async () => {
      const store = await setup();
      const dialogs = TestBed.inject(DialogService);
      openUpdateCheck(store, dialogs);
      expect(dialogs.open()).toBe('update');
      await flush();
      expect(api.checks).toBe(1);
      dialogs.close();

      store.hint.set(updateInfo({ latest: '2.0.0' }));
      openUpdateHint(store, dialogs);
      expect(dialogs.open()).toBe('update');
      expect(api.checks).toBe(1);
      const v = store.view();
      expect(v.kind === 'done' && v.info.latest).toBe('2.0.0');
    });

    it('menu: macOS app menu under About, elsewhere Help before About', () => {
      const app = MENU_BAR.find((m) => m.id === 'app')!;
      expect(app.items.slice(0, 2)).toEqual([{ native: 'about' }, 'CHECK_FOR_UPDATES']);
      const help = MENU_BAR.find((m) => m.id === 'help')!;
      expect(JSON.stringify(help.items)).toContain('"CHECK_FOR_UPDATES","OPEN_ABOUT_DLG"');
    });
  });

  describe('dialog', () => {
    async function render(store: UpdateStore) {
      const fixture = TestBed.createComponent(UpdateDialog);
      fixture.detectChanges();
      await fixture.whenStable();
      await flush();
      fixture.detectChanges();
      void store;
      return { fixture, el: fixture.nativeElement as HTMLElement };
    }
    const buttons = (el: HTMLElement) =>
      [...el.querySelectorAll('button')].map((b) => b.textContent?.trim());

    it('a newer version: headline, notes as text, release page on Enter', async () => {
      const store = await setup();
      api.answer = updateInfo({ notes: '<b>bold</b>\n- item', notesTruncated: true });
      await store.check();
      const { el } = await render(store);
      expect(el.textContent).toContain('Version 1.5.0 is available.');
      expect(el.textContent).toContain('You have version 1.4.0.');
      const notes = el.querySelector('[data-testid="update-notes"]')!;
      expect(notes.textContent).toBe('<b>bold</b>\n- item');
      expect(notes.querySelector('b')).toBeNull();
      expect(el.textContent).toContain('shortened');
      expect(buttons(el)).toEqual(['Skip this version', 'Close', 'Open release page']);
      const open = el.querySelector('button.primary') as HTMLButtonElement;
      expect(open.textContent?.trim()).toBe('Open release page');
      open.click();
      await flush();
      expect(api.opened.length).toBe(1);
    });

    it('up to date: only Close, as the primary button', async () => {
      const store = await setup();
      api.answer = updateInfo({ newer: false, latest: '1.4.0' });
      await store.check();
      const { el } = await render(store);
      expect(el.textContent).toContain('You have the latest version (1.4.0).');
      expect(buttons(el)).toEqual(['Close']);
      expect(el.querySelector('button.primary')?.textContent?.trim()).toBe('Close');
    });

    it('an error: message and Try again', async () => {
      const store = await setup();
      api.answer = { error: { code: 'update_offline', message: 'x', path: null } };
      await store.check();
      const { el } = await render(store);
      expect(el.textContent).toContain('GitHub cannot be reached');
      expect(buttons(el)).toContain('Try again');
    });

    it('a skipped version offers "Remind me again"', async () => {
      const store = await setup();
      api.state = { skipped: '1.5.0' };
      await store.check();
      const { el } = await render(store);
      expect(el.textContent).toContain('You chose to skip this version.');
      expect(buttons(el)).toContain('Remind me again');
    });

    it('Close cancels and closes', async () => {
      const store = await setup();
      const dialogs = TestBed.inject(DialogService);
      dialogs.show('update');
      let release!: () => void;
      api.gate = new Promise((r) => (release = r));
      const done = store.check();
      const { el } = await render(store);
      expect(el.textContent).toContain('Asking GitHub');
      [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close')!.click();
      expect(dialogs.open()).toBeNull();
      release();
      await done;
      expect(store.view().kind).toBe('idle');
    });
  });

  it('releaseDate formats ISO times and keeps odd values', () => {
    expect(releaseDate('2026-11-20T10:00:00Z', 'en-GB')).toBe('20 November 2026');
    expect(releaseDate('soon', 'en-GB')).toBe('soon');
  });
});

describe('UpdateStore without auto setting loaded', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: UpdateApi, useValue: new FakeUpdateApi() },
        { provide: SettingsApi, useValue: new FakeSettingsApi() },
      ],
    });
  });

  it('does nothing before the settings are loaded', async () => {
    const store = TestBed.inject(UpdateStore);
    const api = TestBed.inject(UpdateApi) as FakeUpdateApi;
    await store.autoCheck();
    expect(api.checks).toBe(0);
  });
});
