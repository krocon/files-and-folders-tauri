import { ConfigApi } from '../app/core/config/config-api';
import {
  ButtonSetsOverride,
  ButtonsOverride,
  FileType,
  Loaded,
} from '../app/core/config/config.models';

/** In-memory ConfigApi: `buttons`/`fileTypes` are what `load*` returns, saves are recorded. */
export class FakeConfigApi extends ConfigApi {
  buttons: Loaded<ButtonsOverride> = { value: { sets: {} }, warning: null };
  fileTypes: Loaded<readonly FileType[] | null> = { value: null, warning: null };
  readonly savedButtons: ButtonSetsOverride[] = [];
  readonly savedFileTypes: (readonly FileType[] | null)[] = [];
  failSave = false;

  loadButtons(): Promise<Loaded<ButtonsOverride>> {
    return Promise.resolve(structuredClone(this.buttons));
  }

  saveButtons(sets: ButtonSetsOverride): Promise<void> {
    if (this.failSave) {
      return Promise.reject({ code: 'io', message: 'disk full', path: null });
    }
    this.savedButtons.push(structuredClone(sets));
    this.buttons = { value: { sets: structuredClone(sets) }, warning: null };
    return Promise.resolve();
  }

  loadFileTypes(): Promise<Loaded<readonly FileType[] | null>> {
    return Promise.resolve(structuredClone(this.fileTypes));
  }

  saveFileTypes(categories: readonly FileType[] | null): Promise<void> {
    if (this.failSave) {
      return Promise.reject({ code: 'io', message: 'disk full', path: null });
    }
    this.savedFileTypes.push(structuredClone(categories));
    this.fileTypes = { value: structuredClone(categories), warning: null };
    return Promise.resolve();
  }
}
