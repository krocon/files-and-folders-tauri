import { Danger, DirEntry, DirectoryListing, Location, PathCheck } from '../app/core/fs/fs.models';
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

  readonly opened: { path: string; allowExecutable: boolean }[] = [];
  executables = new Set<string>();
  openFile(path: string, allowExecutable: boolean): Promise<void> {
    if (this.executables.has(path) && !allowExecutable) {
      return Promise.reject({ code: 'executable', message: 'program', path });
    }
    this.opened.push({ path, allowExecutable });
    return Promise.resolve();
  }

  /** Quick operations in call order, e.g. `mkdir /a x`. */
  readonly ops: string[] = [];
  /** Next quick operation rejects with this error (once). */
  failNext: unknown = null;
  dangers: Record<string, Danger> = {};

  private op(text: string, result: string): Promise<string> {
    this.ops.push(text);
    const fail = this.failNext;
    this.failNext = null;
    return fail ? Promise.reject(fail) : Promise.resolve(result);
  }

  makeDir(parent: string, name: string): Promise<string> {
    return this.op(`mkdir ${parent} ${name}`, `${parent}/${name.split('/')[0]}`);
  }

  createFile(parent: string, name: string): Promise<string> {
    return this.op(`touch ${parent} ${name}`, `${parent}/${name}`);
  }

  renameEntry(path: string, newName: string, allowDangerous: boolean): Promise<string> {
    const parent = path.slice(0, path.lastIndexOf('/'));
    return this.op(
      `rename ${path} ${newName}${allowDangerous ? ' !' : ''}`,
      `${parent}/${newName}`,
    );
  }

  checkPaths(paths: readonly string[]): Promise<readonly PathCheck[]> {
    return Promise.resolve(paths.map((path) => ({ path, danger: this.dangers[path] ?? null })));
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
