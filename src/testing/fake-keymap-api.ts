import { KeymapApi, LoadedOverride } from '../app/core/actions/keymap-api';
import { RawBindings } from '../app/core/actions/keymap';

export class FakeKeymapApi extends KeymapApi {
  loaded: LoadedOverride = { bindings: {}, warning: null };
  readonly saved: RawBindings[] = [];

  load(): Promise<LoadedOverride> {
    return Promise.resolve(structuredClone(this.loaded));
  }

  save(bindings: RawBindings): Promise<void> {
    this.saved.push(structuredClone(bindings));
    return Promise.resolve();
  }
}
