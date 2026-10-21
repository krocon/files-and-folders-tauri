import { DiffApi } from '../app/core/diff/diff-api';
import { DiffOptions, DiffResult } from '../app/core/diff/diff.models';

/** In-memory DiffApi: `result` answers every call (or `fail`), calls are recorded. */
export class FakeDiffApi extends DiffApi {
  result: DiffResult | null = null;
  fail: unknown = null;
  readonly calls: { left: string; right: string; options: DiffOptions }[] = [];

  diff(left: string, right: string, options: DiffOptions): Promise<DiffResult> {
    this.calls.push({ left, right, options });
    if (this.fail || !this.result) {
      return Promise.reject(this.fail ?? { code: 'unknown', message: 'no result', path: null });
    }
    return Promise.resolve(structuredClone(this.result));
  }
}
