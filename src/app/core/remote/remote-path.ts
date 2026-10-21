import { REMOTE_PREFIX } from './remote.models';

/**
 * Whether `path` is a server path (`remote://<profile>/…`, design 034 E1). Only the
 * prefix is looked at – server paths are opaque like every other path: parents,
 * names and joins come from Rust.
 */
export function isRemotePath(path: string | null | undefined): boolean {
  return typeof path === 'string' && path.startsWith(REMOTE_PREFIX);
}

/** Addresses typed into a path field that mean "connect" (`sftp://…`, `ftp://…`). */
export function isServerUrl(text: string): boolean {
  return /^(s?ftp|ftps|ftpes|ssh):\/\//i.test(text.trim());
}

/**
 * The server path of a profile's start folder – the one place the frontend writes the
 * format of Rust's `RemotePath` (`remote://<id>` + absolute server path), used for a
 * favourite before the first connect. Rust checks every such path again.
 */
export function serverPath(profileId: string, startPath: string | null): string {
  const start = startPath && startPath.startsWith('/') ? startPath : '/';
  return `${REMOTE_PREFIX}${profileId}${start}`;
}

/**
 * `Name: /path` for a server path in menus (favourites, recent) – display only;
 * unknown profiles keep the raw path.
 */
export function displayPath(path: string, names: ReadonlyMap<string, string>): string {
  const m = /^remote:\/\/([a-z0-9-]{1,40})(\/.*)?$/.exec(path);
  const name = m ? names.get(m[1]) : undefined;
  return m && name !== undefined ? `${name}: ${m[2] ?? '/'}` : path;
}
