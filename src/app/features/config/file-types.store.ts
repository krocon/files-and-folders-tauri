import { computed, inject, Injectable, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { ConfigApi } from '../../core/config/config-api';
import { FileType } from '../../core/config/config.models';
import { BUILT_IN_FILE_TYPES, FILE_TYPES } from '../../core/file-icon/file-icon.service';
import {
  cleanFileTypes,
  indexFileTypes,
  sameFileTypes,
} from '../../core/file-icon/file-types-logic';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { CONFIG_TEXTS, describeConfigWarning } from './config-texts';

/**
 * File type categories in use (root, design 022 E4/E5): the user's `filetypes.json`
 * or the built-in list. Feeds `FILE_TYPES` (icons, colours) and the mark presets.
 */
@Injectable({ providedIn: 'root' })
export class FileTypesStore {
  private readonly api = inject(ConfigApi);
  private readonly actions = inject(ActionService);

  readonly builtIn: readonly FileType[] = BUILT_IN_FILE_TYPES;
  /** The user's categories; null = none (built in). */
  readonly user = signal<readonly FileType[] | null>(null);
  readonly categories = computed(() => this.user() ?? this.builtIn);

  async init(): Promise<void> {
    try {
      const loaded = await this.api.loadFileTypes();
      this.apply(loaded.value);
      if (loaded.warning) {
        this.actions.report(describeConfigWarning('fileTypes', loaded.warning));
      }
    } catch (err) {
      this.actions.report(CONFIG_TEXTS.loadFailed('fileTypes', errorText(toFsError(err))));
    }
  }

  /** Writes the list; the built-in one (or null) removes the user file. Rejects with an `FsError`. */
  async save(categories: readonly FileType[] | null): Promise<void> {
    const clean = categories === null ? null : cleanFileTypes(categories);
    const next = clean === null || sameFileTypes(clean, this.builtIn) ? null : clean;
    await this.api.saveFileTypes(next);
    this.apply(next);
  }

  private apply(value: readonly FileType[] | null): void {
    const user = value === null ? null : cleanFileTypes(value);
    this.user.set(user);
    FILE_TYPES.set(indexFileTypes(user ?? this.builtIn));
  }
}
