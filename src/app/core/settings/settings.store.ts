import { computed, inject, Injectable, signal } from '@angular/core';
import { Language, setLanguage, systemLanguage } from '../i18n/i18n';
import { toFsError } from '../fs/fs-error';
import { DISPLAY } from './display';
import { SettingsApi } from './settings-api';
import {
  acceptsValue,
  DEFAULTS,
  isSettingKey,
  LoadedSettings,
  sameValue,
  SCHEMA,
  SettingKey,
  SettingsValues,
  SettingsWarning,
  SETTING_KEYS,
} from './settings.models';

/** Debounce of writes (design 015 E3). */
export const SAVE_DELAY_MS = 300;

/**
 * The user's settings (root store, design 015 E3): defaults + `settings.json`.
 * Every change applies at once (consumers read the signals) and is written
 * debounced; only values that differ from the defaults are stored, unknown keys
 * of a newer version are kept.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly api = inject(SettingsApi);

  /** Values that differ from the defaults (and unknown keys). */
  private readonly stored = signal<Readonly<Record<string, unknown>>>({});
  readonly values = computed<SettingsValues>(() => {
    const out: Record<string, unknown> = { ...DEFAULTS };
    for (const [k, v] of Object.entries(this.stored())) {
      if (isSettingKey(k)) {
        out[k] = v;
      }
    }
    return out as unknown as SettingsValues;
  });
  /** Effective UI language (`system` resolved). */
  readonly language = computed<Language>(() => {
    const l = this.values()['general.language'];
    return l === 'system' ? systemLanguage() : l;
  });
  readonly loaded = signal(false);
  /** Problems while loading or saving (codes, translated by the UI). */
  readonly warnings = signal<readonly SettingsWarning[]>([]);
  /** A save failed (message of the error). */
  readonly saveError = signal<string | null>(null);

  private persist = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loading: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor() {
    if (typeof window !== 'undefined') {
      // a change in the last 300 ms before closing still reaches the file
      window.addEventListener('pagehide', () => void this.flush());
    }
  }

  get<K extends SettingKey>(key: K): SettingsValues[K] {
    return this.values()[key];
  }

  /** True if `key` differs from its default. */
  isChanged(key: SettingKey): boolean {
    return Object.prototype.hasOwnProperty.call(this.stored(), key);
  }

  /** Loads `settings.json` once (later calls wait for the same load). */
  init(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  /** (Re)loads the file – also after an import. */
  async load(): Promise<void> {
    let loaded: LoadedSettings;
    try {
      loaded = await this.api.load();
    } catch (err) {
      this.saveError.set(toFsError(err).message);
      this.loaded.set(true);
      this.apply();
      return;
    }
    this.persist = loaded.persist;
    this.stored.set(clean(loaded.settings));
    this.warnings.set(loaded.warnings);
    this.loaded.set(true);
    this.apply();
  }

  set<K extends SettingKey>(key: K, value: SettingsValues[K]): void {
    if (!acceptsValue(SCHEMA[key], value)) {
      return;
    }
    const next = { ...this.stored() };
    if (sameValue(value, DEFAULTS[key])) {
      delete next[key];
    } else {
      next[key] = value;
    }
    this.update(next);
  }

  /** Back to the defaults for these keys (one section of the dialog). */
  reset(keys: readonly SettingKey[]): void {
    const next = { ...this.stored() };
    for (const k of keys) {
      delete next[k];
    }
    this.update(next);
  }

  /** All known settings back to the defaults (unknown keys stay). */
  resetAll(): void {
    this.reset(SETTING_KEYS);
  }

  /** Writes a pending change now. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.saving = this.saving.then(() => this.write());
    }
    return this.saving;
  }

  dismissWarnings(): void {
    this.warnings.set([]);
    this.saveError.set(null);
  }

  private update(next: Record<string, unknown>): void {
    if (sameValue(next, this.stored())) {
      return;
    }
    this.stored.set(next);
    this.apply();
    if (!this.persist) {
      return;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saving = this.saving.then(() => this.write());
    }, SAVE_DELAY_MS);
  }

  private async write(): Promise<void> {
    try {
      const warnings = await this.api.save(this.stored());
      this.saveError.set(null);
      if (warnings.length > 0) {
        this.warnings.update((w) => [...w, ...warnings]);
      }
    } catch (err) {
      this.saveError.set(toFsError(err).message);
    }
  }

  /** Pushes the values to the plain-function consumers (language, formats). */
  private apply(): void {
    const v = this.values();
    setLanguage(this.language());
    DISPLAY.sizeFormat.set(v['view.sizeFormat']);
    DISPLAY.dateFormat.set(v['view.dateFormat']);
    DISPLAY.folderBrackets.set(v['view.folderBrackets']);
    DISPLAY.hideExtension.set(v['view.hideExtension']);
    DISPLAY.showHidden.set(v['view.showHidden']);
  }
}

/** Known keys with invalid values are dropped (Rust sanitised already – defence in depth). */
function clean(raw: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!isSettingKey(k)) {
      out[k] = v;
    } else if (acceptsValue(SCHEMA[k], v) && !sameValue(v, DEFAULTS[k])) {
      out[k] = v;
    }
  }
  return out;
}
