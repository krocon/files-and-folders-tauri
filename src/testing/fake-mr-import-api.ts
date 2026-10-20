import { MrImportApi } from '../app/core/mrimport/mr-import-api';
import { MrApply, MrApplyReport, MrArea, MrScan } from '../app/core/mrimport/mr-import.models';

/** An empty scan result (every area missing) to build test scans from. */
export function emptyScan(over: Partial<MrScan> = {}): MrScan {
  return {
    root: '/old/apps/fnf-api/src/assets',
    os: 'linux',
    shortcuts: null,
    buttons: null,
    fileTypes: null,
    search: null,
    tools: null,
    colors: null,
    setup: null,
    ...over,
  };
}

/** One area with defaults for the bookkeeping fields. */
export function area<T>(items: T, over: Partial<Omit<MrArea<T>, 'items'>> = {}): MrArea<T> {
  return { file: '/old/x.json', error: null, items, unchanged: 0, skipped: [], ...over };
}

/** In-memory MrImportApi: `result` answers scans (or `failScan`), applies are recorded. */
export class FakeMrImportApi extends MrImportApi {
  result: MrScan = emptyScan();
  failScan: { code: string; message: string; path: string | null } | null = null;
  report: MrApplyReport = { imported: [], warnings: [], backups: [] };
  readonly scanned: string[] = [];
  readonly applied: MrApply[] = [];

  scan(path: string): Promise<MrScan> {
    this.scanned.push(path);
    if (this.failScan) {
      return Promise.reject(this.failScan);
    }
    return Promise.resolve(structuredClone(this.result));
  }

  apply(plan: MrApply): Promise<MrApplyReport> {
    this.applied.push(structuredClone(plan));
    return Promise.resolve(structuredClone(this.report));
  }
}
