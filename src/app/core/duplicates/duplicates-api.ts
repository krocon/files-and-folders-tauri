import { Injectable } from '@angular/core';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { PREVIEW_SCHEME } from '../preview/preview-api';
import { toFsError } from '../fs/fs-error';
import { LoadedPresets, RenamePresets } from '../rename/rename.models';

/** Rust `duplicates::thumbs::MAX_PATHS` / `MAX_PX`. */
export const MAX_THUMB_PATHS = 24;
export const THUMB_PX = 192;

/**
 * Facade for the helpers of the duplicate search (design 042, Rust
 * `commands/duplicates.rs`). The search is job `duplicates`, removing copies job
 * `dedupe` (`JobsStore.start`). Rule sets are stored like the multi-rename presets
 * (`duplicate-rules.json`: `last` + named sets). Rejects with an `FsError`.
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriDuplicatesApi() })
export abstract class DuplicatesApi {
  /** `result[i][j]`: path `i` lies in folder `j` (lexical, links not resolved). */
  abstract classifyPaths(
    paths: readonly string[],
    folders: readonly string[],
  ): Promise<readonly (readonly boolean[])[]>;
  /** Tokens for `PreviewApi.imageUrl` (null where none can be made); at most 24 paths. */
  abstract thumbnails(paths: readonly string[], maxPx: number): Promise<readonly (string | null)[]>;
  /** URL of a thumbnail token for `<img src>` (scheme `fnfpreview`). */
  abstract imageUrl(token: string): string;
  abstract loadRules(): Promise<LoadedPresets>;
  abstract saveRules(rules: RenamePresets): Promise<void>;
}

@Injectable()
export class TauriDuplicatesApi extends DuplicatesApi {
  classifyPaths(
    paths: readonly string[],
    folders: readonly string[],
  ): Promise<readonly (readonly boolean[])[]> {
    return call('classify_paths', { paths, folders });
  }

  thumbnails(paths: readonly string[], maxPx: number): Promise<readonly (string | null)[]> {
    return call('duplicate_thumbnails', { paths, maxPx });
  }

  imageUrl(token: string): string {
    return convertFileSrc(token, PREVIEW_SCHEME);
  }

  loadRules(): Promise<LoadedPresets> {
    return call('load_duplicate_rules', {});
  }

  saveRules(rules: RenamePresets): Promise<void> {
    return call('save_duplicate_rules', { rules });
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
