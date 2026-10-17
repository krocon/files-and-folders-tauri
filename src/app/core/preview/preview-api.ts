import { Injectable } from '@angular/core';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { Preview, PreviewOptions, Properties } from './preview.models';

/** URI scheme of the image previews (Rust `preview::SCHEME`). */
export const PREVIEW_SCHEME = 'fnfpreview';

/**
 * Facade for the viewer, quick view and properties (design 010). File contents
 * are read only through `read_preview` (bounded); images are fetched by token
 * from the `fnfpreview` scheme. Rejects with an `FsError`.
 */
export abstract class PreviewApi {
  abstract readPreview(path: string, options?: PreviewOptions): Promise<Preview>;
  abstract getProperties(path: string): Promise<Properties>;
  /** URL of an image token for `<img src>`. */
  abstract imageUrl(token: string): string;
}

@Injectable()
export class TauriPreviewApi extends PreviewApi {
  readPreview(path: string, options: PreviewOptions = {}): Promise<Preview> {
    return call<Preview>('read_preview', { path, options });
  }

  getProperties(path: string): Promise<Properties> {
    return call<Properties>('get_properties', { path });
  }

  imageUrl(token: string): string {
    return convertFileSrc(token, PREVIEW_SCHEME);
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
