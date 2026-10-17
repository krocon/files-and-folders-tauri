import { DirEntry, DirectoryListing, DirSize, Location } from '../app/core/fs/fs.models';
import { FsApi } from '../app/core/fs/fs-api';

export function entry(name: string, overrides: Partial<DirEntry> = {}): DirEntry {
  return {
    name,
    path: `/root/${name}`,
    kind: 'file',
    targetKind: null,
    size: 1,
    modifiedMs: 0,
    hidden: name.startsWith('.'),
    lossyName: false,
    ...overrides,
  };
}

export function dir(name: string, overrides: Partial<DirEntry> = {}): DirEntry {
  return entry(name, { kind: 'directory', size: null, ...overrides });
}

export function listing(
  path: string,
  entries: DirEntry[],
  parent: string | null = '/',
): DirectoryListing {
  return { path, parent, segments: [], entries, unreadableEntries: 0 };
}

/** In-memory FsApi whose responses are controlled per test. */
export class FakeFsApi extends FsApi {
  readonly calls: (string | undefined)[] = [];
  handler: (path?: string) => Promise<DirectoryListing> = () =>
    Promise.reject(new Error('no handler'));

  listDirectory(path?: string): Promise<DirectoryListing> {
    this.calls.push(path);
    return this.handler(path);
  }

  locations: Record<string, Location> = {};
  resolveLocation(input: string): Promise<Location> {
    const loc = this.locations[input];
    return loc
      ? Promise.resolve(loc)
      : Promise.reject({ code: 'not_found', message: 'No such file or directory', path: input });
  }

  /** Sizes by path; progress is reported once before resolving. */
  sizes: Record<string, number> = {};
  readonly sizeJobs: string[] = [];
  readonly cancelled: string[] = [];
  sizeGate: Promise<void> = Promise.resolve();
  async calcDirSize(
    path: string,
    jobId: string,
    onProgress: (p: DirSize) => void,
  ): Promise<DirSize> {
    this.sizeJobs.push(jobId);
    const bytes = this.sizes[path] ?? 0;
    onProgress({ files: 1, dirs: 0, bytes: bytes / 2, unreadable: 0, cancelled: false });
    await this.sizeGate;
    const cancelled = this.cancelled.includes(jobId);
    return { files: 2, dirs: 1, bytes: cancelled ? bytes / 2 : bytes, unreadable: 0, cancelled };
  }

  cancelDirSize(jobId: string): Promise<void> {
    this.cancelled.push(jobId);
    return Promise.resolve();
  }

  readonly opened: { path: string; allowExecutable: boolean }[] = [];
  executables = new Set<string>();
  openFile(path: string, allowExecutable: boolean): Promise<void> {
    if (this.executables.has(path) && !allowExecutable) {
      return Promise.reject({ code: 'executable', message: 'program', path });
    }
    this.opened.push({ path, allowExecutable });
    return Promise.resolve();
  }
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
