import { Injectable } from '@angular/core';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';

/**
 * Files dragged from the system over the window (design 012 E6). Position in
 * CSS pixels relative to the viewport (Tauri reports physical pixels).
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
    return getCurrentWebview().onDragDropEvent(({ payload }) => {
      const ratio = window.devicePixelRatio || 1;
      switch (payload.type) {
        case 'enter':
        case 'drop':
          handler({
            type: payload.type,
            paths: payload.paths,
            x: payload.position.x / ratio,
            y: payload.position.y / ratio,
          });
          break;
        case 'over':
          handler({ type: 'over', x: payload.position.x / ratio, y: payload.position.y / ratio });
          break;
        case 'leave':
          handler({ type: 'leave' });
          break;
      }
    });
  }
}
