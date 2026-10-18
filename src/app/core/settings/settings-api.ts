import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { ImportReport, LoadedSettings, SettingsPart, SettingsWarning } from './settings.models';

/**
 * Facade for the settings commands (Rust `settings.rs`, design 015 §3). Rejects
 * with an `FsError`. Without a provider (tests, browser) settings live in memory.
 */
@Injectable({ providedIn: 'root', useFactory: () => new MemorySettingsApi() })
export abstract class SettingsApi {
  abstract load(): Promise<LoadedSettings>;
  /** Writes the values that differ from the defaults; resolves with sanitising warnings. */
  abstract save(settings: Readonly<Record<string, unknown>>): Promise<readonly SettingsWarning[]>;
  /** Writes all settings files as one bundle into `dir`; resolves with the file path. */
  abstract exportAll(dir: string): Promise<string>;
  abstract importAll(path: string, parts: readonly SettingsPart[]): Promise<ImportReport>;
}

/** No persistence (browser without backend, tests that do not care). */
export class MemorySettingsApi extends SettingsApi {
  private stored: Record<string, unknown> = {};

  async load(): Promise<LoadedSettings> {
    return { settings: { ...this.stored }, warnings: [], persist: true };
  }

  async save(settings: Readonly<Record<string, unknown>>): Promise<readonly SettingsWarning[]> {
    this.stored = { ...settings };
    return [];
  }

  exportAll(): Promise<string> {
    return Promise.reject(
      toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null }),
    );
  }

  importAll(): Promise<ImportReport> {
    return this.exportAll() as never;
  }
}

@Injectable()
export class TauriSettingsApi extends SettingsApi {
  load(): Promise<LoadedSettings> {
    return call<LoadedSettings>('load_settings', {});
  }

  save(settings: Readonly<Record<string, unknown>>): Promise<readonly SettingsWarning[]> {
    return call<SettingsWarning[]>('save_settings', { settings });
  }

  exportAll(dir: string): Promise<string> {
    return call<string>('export_settings', { dir });
  }

  importAll(path: string, parts: readonly SettingsPart[]): Promise<ImportReport> {
    return call<ImportReport>('import_settings', { path, parts });
  }
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
  }
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toFsError(err);
  }
}
