import { Injectable } from '@angular/core';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { detectPlatform, Platform } from '../actions/platform';

/**
 * Files dragged from the system over the window (design 012 E6). Position in
 * CSS pixels relative to the viewport (see {@link dropPosition}).
 */
export type OsDragEvent =
  | {
      readonly type: 'enter' | 'drop';
      readonly paths: readonly string[];
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'over'; readonly x: number; readonly y: number }
  | { readonly type: 'leave' };

/**
 * CSS pixels of a position Tauri reports for a drag from the system. Tauri calls
 * it physical, but wry passes NSView points on macOS and GTK widget coordinates
 * on Linux – both logical already; only WebView2 (Windows) gives device pixels.
 * Dividing everywhere put every drop on a Retina Mac into the top left quarter,
 * i.e. always onto the left panel.
 */
export function dropPosition(
  pos: { readonly x: number; readonly y: number },
  ratio: number,
  platform: Platform,
): { x: number; y: number } {
  const scale = platform === 'windows' && ratio > 0 ? ratio : 1;
  return { x: pos.x / scale, y: pos.y / scale };
}

/** Facade for the window's drag-and-drop events (no plugin, `core:event:default`). */
export abstract class DragDropApi {
  /** Listens to drags from the system; resolves with the function that stops listening. */
  abstract listen(handler: (event: OsDragEvent) => void): Promise<() => void>;
}

@Injectable()
export class TauriDragDropApi extends DragDropApi {
  async listen(handler: (event: OsDragEvent) => void): Promise<() => void> {
    if (!isTauri()) {
      return () => undefined;
    }
    const platform = detectPlatform();
    return getCurrentWebview().onDragDropEvent(({ payload }) => {
      const ratio = window.devicePixelRatio || 1;
      switch (payload.type) {
        case 'enter':
        case 'drop':
          handler({
            type: payload.type,
            paths: payload.paths,
            ...dropPosition(payload.position, ratio, platform),
          });
          break;
        case 'over':
          handler({ type: 'over', ...dropPosition(payload.position, ratio, platform) });
          break;
        case 'leave':
          handler({ type: 'leave' });
          break;
      }
    });
  }
}
