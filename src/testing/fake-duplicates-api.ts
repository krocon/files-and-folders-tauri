import { DuplicatesApi } from '../app/core/duplicates/duplicates-api';
import { EMPTY_PRESETS, LoadedPresets, RenamePresets } from '../app/core/rename/rename.models';

/** In-memory DuplicatesApi: folders by prefix, thumbnails `thumb:<path>`, rules kept in `saved`. */
export class FakeDuplicatesApi extends DuplicatesApi {
  saved: RenamePresets = EMPTY_PRESETS;
  classifyCalls = 0;
  thumbCalls: string[][] = [];

  async classifyPaths(
    paths: readonly string[],
    folders: readonly string[],
  ): Promise<readonly (readonly boolean[])[]> {
    this.classifyCalls++;
    return paths.map((p) => folders.map((f) => p === f || p.startsWith(`${f}/`)));
  }

  async thumbnails(paths: readonly string[]): Promise<readonly (string | null)[]> {
    this.thumbCalls.push([...paths]);
    return paths.map((p) => (/\.(jpe?g|png|cbz)$/i.test(p) ? `thumb:${p}` : null));
  }

  imageUrl(token: string): string {
    return `url:${token}`;
  }

  async loadRules(): Promise<LoadedPresets> {
    return { presets: this.saved, warning: null };
  }

  async saveRules(rules: RenamePresets): Promise<void> {
    this.saved = rules;
  }
}
