import { Injectable } from '@angular/core';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { MenuItemEnabled, NativeMenuEvent, NativeMenuSpec } from './menu.models';

/**
 * Facade for the application menu (Rust `app_menu.rs`, design 014). Root default =
 * Tauri; outside Tauri there is no native menu (`setAppMenu` → false).
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriMenuApi() })
export abstract class MenuApi {
  /** Installs the native menu bar; false = this platform shows the in-app menu bar. */
  abstract setAppMenu(spec: NativeMenuSpec): Promise<boolean>;
  /** Enables/disables items of the installed native menu without rebuilding it. */
  abstract setMenuEnabled(items: readonly MenuItemEnabled[]): Promise<void>;
  /** Ids of chosen native menu items. */
  abstract subscribe(onEvent: (evt: NativeMenuEvent) => void): Promise<void>;
  /** Closes the main window like its close button (Quit of the in-app menu). */
  abstract closeMainWindow(): Promise<void>;
  /** Full screen on/off for the main window (design 022 E9); the new state. */
  abstract toggleFullscreen(): Promise<boolean>;
}

@Injectable()
export class TauriMenuApi extends MenuApi {
  async setAppMenu(spec: NativeMenuSpec): Promise<boolean> {
    if (!isTauri()) {
      return false;
    }
    try {
      return await invoke<boolean>('set_app_menu', { spec });
    } catch (err) {
      throw toFsError(err);
    }
  }

  async setMenuEnabled(items: readonly MenuItemEnabled[]): Promise<void> {
    if (!isTauri()) {
      return;
    }
    try {
      await invoke<void>('set_menu_enabled', { items });
    } catch (err) {
      throw toFsError(err);
    }
  }

  async subscribe(onEvent: (evt: NativeMenuEvent) => void): Promise<void> {
    if (!isTauri()) {
      return;
    }
    const channel = new Channel<NativeMenuEvent>();
    channel.onmessage = onEvent;
    await invoke<void>('subscribe_menu', { onEvent: channel });
  }

  async closeMainWindow(): Promise<void> {
    if (!isTauri()) {
      return;
    }
    try {
      await invoke<void>('close_main_window');
    } catch (err) {
      throw toFsError(err);
    }
  }

  async toggleFullscreen(): Promise<boolean> {
    if (!isTauri()) {
      return false;
    }
    try {
      return await invoke<boolean>('toggle_fullscreen');
    } catch (err) {
      throw toFsError(err);
    }
  }
}
