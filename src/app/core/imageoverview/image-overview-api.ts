import { Injectable } from '@angular/core';
import { Channel, convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { OverviewEvent } from './image-overview.models';

/** URI scheme of the thumbnails (Rust `image_overview::SCHEME`). */
export const THUMB_SCHEME = 'fnfthumb';

/**
 * Facade for the image overview (design 074, Rust `commands/image_overview.rs`). `open`
 * resolves with the overview's id at once; the images come over the channel in parts.
 * Thumbnails are plain URLs of the `fnfthumb` scheme – no call per tile. Rejects with an
 * `FsError`.
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriImageOverviewApi() })
export abstract class ImageOverviewApi {
  abstract open(
    root: string,
    recursive: boolean,
    onEvent: (e: OverviewEvent) => void,
  ): Promise<string>;
  /** Stops collecting; the thumbnails of that id are no longer served. */
  abstract close(id: string): Promise<void>;
  /** URL of the thumbnail of item `index` in `step`; `version` (mtime) makes it unique. */
  abstract thumbUrl(id: string, index: number, step: number, version: number | null): string;
}

@Injectable()
export class TauriImageOverviewApi extends ImageOverviewApi {
  open(root: string, recursive: boolean, onEvent: (e: OverviewEvent) => void): Promise<string> {
    const channel = new Channel<OverviewEvent>();
    channel.onmessage = onEvent;
    return call('image_overview_open', { root, recursive, onEvent: channel });
  }

  close(id: string): Promise<void> {
    return isTauri() ? call('image_overview_close', { id }) : Promise.resolve();
  }

  thumbUrl(id: string, index: number, step: number, version: number | null): string {
    return `${convertFileSrc(`${id}.${index}.${step}`, THUMB_SCHEME)}?v=${version ?? 0}`;
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
