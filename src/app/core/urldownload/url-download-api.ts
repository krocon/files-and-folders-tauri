import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import {
  DownloadCheck,
  DownloadOptions,
  DownloadTools,
  LoadedDownloadPresets,
} from './url-download.models';

/**
 * Facade of "Download from URLs" (Rust `commands/url_download.rs`, design 078). Nothing
 * here starts yt-dlp against a URL – that is the job `download` (`JobsStore.start`) –
 * and nothing sends a program or an argument. Rejects with an `FsError`.
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriUrlDownloadApi() })
export abstract class UrlDownloadApi {
  /** Which of yt-dlp, ffmpeg and a JavaScript runtime are there (runs their `--version`). */
  abstract tools(): Promise<DownloadTools>;
  /** The own presets of `url-download.json` (ids and labels). */
  abstract presets(): Promise<LoadedDownloadPresets>;
  /** Checks the text of the URL field and the template; no network. */
  abstract check(text: string, options: DownloadOptions): Promise<DownloadCheck>;
  /** The yt-dlp command for `url` as a person would type it. */
  abstract commandLine(url: string, options: DownloadOptions): Promise<string>;
}

@Injectable()
export class TauriUrlDownloadApi extends UrlDownloadApi {
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

  tools(): Promise<DownloadTools> {
    return this.call('download_tools');
  }

  presets(): Promise<LoadedDownloadPresets> {
    return this.call('download_presets');
  }

  check(text: string, options: DownloadOptions): Promise<DownloadCheck> {
    return this.call('download_check', { text, options });
  }

  commandLine(url: string, options: DownloadOptions): Promise<string> {
    return this.call('download_command_line', { url, options });
  }
}
