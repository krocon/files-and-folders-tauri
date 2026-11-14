import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { UpdateInfo, UpdateState } from './update.models';

/**
 * Facade of the update check (Rust `update_check.rs`, design 075). Only Rust talks to
 * GitHub, at a fixed URL – nothing here sends a URL to fetch. Rejects with an `FsError`.
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriUpdateApi() })
export abstract class UpdateApi {
  abstract check(): Promise<UpdateInfo>;
  abstract loadState(): Promise<UpdateState>;
  /** `null` = skip nothing. */
  abstract skip(version: string | null): Promise<void>;
  /** Opens a page of our releases (anything else → the release list, checked in Rust). */
  abstract openReleasePage(url: string | null): Promise<void>;
}

@Injectable()
export class TauriUpdateApi extends UpdateApi {
  private async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (!isTauri()) {
      throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
    }
    try {
      return await invoke<T>(cmd, args);
    } catch (err) {
      throw toFsError(err);
    }
  }

  check(): Promise<UpdateInfo> {
    return this.call('check_for_update');
  }

  loadState(): Promise<UpdateState> {
    return this.call('load_update_state');
  }

  skip(version: string | null): Promise<void> {
    return this.call('skip_update_version', { version });
  }

  openReleasePage(url: string | null): Promise<void> {
    return this.call('open_release_page', { url });
  }
}
