import { DirEntry, DirectoryListing } from '../app/core/fs/fs.models';
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
