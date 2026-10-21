import { StarterApi } from '../app/core/starter/starter-api';
import {
  LoadedStarter,
  SavedStarter,
  StarterContext,
  StarterItem,
  StarterProblem,
  StarterRun,
} from '../app/core/starter/starter.models';

/** In-memory StarterApi: `loaded` is what `load` returns; saves and runs are recorded. */
export class FakeStarterApi extends StarterApi {
  loaded: LoadedStarter = { items: [], warning: null, problems: [], file: '/cfg/starter.json' };
  /** Problems the next save reports (then nothing is written). */
  saveProblems: StarterProblem[] = [];
  readonly saved: StarterItem[][] = [];
  readonly runs: { id: string; context: StarterContext; allowExecutable: boolean }[] = [];
  /** What `run` answers per id (default: one process started). */
  answers = new Map<string, StarterRun>();
  /** Makes the next run reject with this error (once). */
  fail: unknown = null;

  load(): Promise<LoadedStarter> {
    return Promise.resolve(structuredClone(this.loaded));
  }

  save(items: readonly StarterItem[]): Promise<SavedStarter> {
    if (this.saveProblems.length > 0) {
      return Promise.resolve({
        saved: false,
        items: structuredClone([...items]),
        problems: this.saveProblems,
      });
    }
    this.saved.push(structuredClone([...items]));
    this.loaded = { ...this.loaded, items: structuredClone([...items]), problems: [] };
    return Promise.resolve({ saved: true, items: structuredClone([...items]), problems: [] });
  }

  run(id: string, context: StarterContext, allowExecutable = false): Promise<StarterRun> {
    this.runs.push({ id, context, allowExecutable });
    if (this.fail) {
      const f = this.fail;
      this.fail = null;
      return Promise.reject(f);
    }
    return Promise.resolve(this.answers.get(id) ?? { kind: 'started', count: 1 });
  }
}
