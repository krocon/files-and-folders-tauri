import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { AppInfo } from './about.models';

/**
 * Facade for the About data (Rust `about.rs`, design 017). Rejects with an `FsError`
 * (`no_backend` outside Tauri).
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriAboutApi() })
export abstract class AboutApi {
  abstract getAppInfo(): Promise<AppInfo>;
}

@Injectable()
export class TauriAboutApi extends AboutApi {
  async getAppInfo(): Promise<AppInfo> {
    if (!isTauri()) {
      throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
    }
    try {
      return await invoke<AppInfo>('get_app_info');
    } catch (err) {
      throw toFsError(err);
    }
  }
}
