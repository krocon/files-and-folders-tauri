import { FileActionsApi } from '../app/core/fileactions/file-actions-api';
import {
  FileActionProblem,
  FileActionRule,
  LoadedFileActions,
  SavedFileActions,
} from '../app/core/fileactions/file-actions.models';

/** In-memory FileActionsApi: `loaded` is what `load` returns; saves and runs are recorded. */
export class FakeFileActionsApi extends FileActionsApi {
  loaded: LoadedFileActions = { rules: [], warning: null, problems: [] };
  /** Problems the next save reports (then nothing is written). */
  saveProblems: FileActionProblem[] = [];
  readonly saved: FileActionRule[][] = [];
  readonly runs: {
    id: string;
    file: string;
    targetDir: string | null;
    allowExecutable: boolean;
  }[] = [];
  /** Makes the next run reject with this error (once). */
  fail: unknown = null;

  load(): Promise<LoadedFileActions> {
    return Promise.resolve(structuredClone(this.loaded));
  }

  save(rules: readonly FileActionRule[]): Promise<SavedFileActions> {
    const copy = structuredClone(rules) as FileActionRule[];
    if (this.saveProblems.length > 0) {
      const problems = this.saveProblems;
      this.saveProblems = [];
      return Promise.resolve({ saved: false, rules: copy, problems });
    }
    this.saved.push(copy);
    return Promise.resolve({ saved: true, rules: copy, problems: [] });
  }

  run(
    id: string,
    file: string,
    targetDir: string | null,
    allowExecutable = false,
  ): Promise<number> {
    this.runs.push({ id, file, targetDir, allowExecutable });
    if (this.fail) {
      const e = this.fail;
      this.fail = null;
      return Promise.reject(e);
    }
    return Promise.resolve(1);
  }
}
