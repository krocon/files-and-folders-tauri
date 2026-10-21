import { RemoteKind, RemoteProfile } from '../../core/remote/remote.models';

/** Default port per type (Rust `RemoteKind::default_port`). */
export const DEFAULT_PORT: Readonly<Record<RemoteKind, number>> = {
  ftp: 21,
  ftpsExplicit: 21,
  ftpsImplicit: 990,
  sftp: 22,
};

export function isFtp(kind: RemoteKind): boolean {
  return kind !== 'sftp';
}

export function encrypted(kind: RemoteKind): boolean {
  return kind !== 'ftp';
}

/** A new, unsaved profile (id `''` – Rust gives it one). */
export function blankProfile(name: string): RemoteProfile {
  return {
    id: '',
    name,
    kind: 'sftp',
    host: '',
    port: 22,
    user: '',
    anonymous: false,
    auth: 'password',
    keyFile: null,
    startPath: null,
    passive: true,
    encoding: 'auto',
    timeoutSecs: 20,
    maxConnections: 2,
    keepaliveSecs: 60,
    description: '',
    pinnedCert: null,
    acceptHostnameMismatch: false,
    secret: 'none',
  };
}

/** Changes the type; the port follows if it still was the old type's default. */
export function withKind(p: RemoteProfile, kind: RemoteKind): RemoteProfile {
  const port = p.port === DEFAULT_PORT[p.kind] ? DEFAULT_PORT[kind] : p.port;
  return {
    ...p,
    kind,
    port,
    auth: isFtp(kind) ? 'password' : p.auth,
    anonymous: isFtp(kind) ? p.anonymous : false,
  };
}

/** A copy as a new profile (no id, no secret, no pin). */
export function duplicateProfile(p: RemoteProfile, name: string): RemoteProfile {
  return { ...p, id: '', name, secret: 'none', pinnedCert: null, acceptHostnameMismatch: false };
}

const HOST = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** A control character (CR/LF would end an FTP command). */
function hasControl(text: string): boolean {
  return [...text].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
}

/**
 * First problem of a profile (code like Rust's `profiles::check`), `null` = fine.
 * Rust checks again – this only gives early feedback in the form.
 */
export function problemOf(p: RemoteProfile): string | null {
  if (!p.name.trim() || p.name.length > 80) {
    return 'name';
  }
  const host = p.host.trim();
  const ipv6 = host.includes(':');
  if (
    !host ||
    host.length > 253 ||
    (!ipv6 && !HOST.test(host)) ||
    (ipv6 && !/^[0-9a-fA-F:.]+$/.test(host))
  ) {
    return 'host';
  }
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) {
    return 'port';
  }
  if (hasControl(p.user) || (!p.user.trim() && !(isFtp(p.kind) && p.anonymous))) {
    return 'user';
  }
  if (p.auth === 'key' && !(p.keyFile ?? '').trim()) {
    return 'keyFile';
  }
  const sp = (p.startPath ?? '').trim();
  if (sp && (!sp.startsWith('/') || sp.split('/').some((s) => s === '..' || s === '.'))) {
    return 'startPath';
  }
  return null;
}

/** Field values equal (ignores the keychain marker that only Rust sets). */
export function sameProfile(a: RemoteProfile, b: RemoteProfile): boolean {
  const strip = (p: RemoteProfile) => JSON.stringify({ ...p, secret: undefined });
  return strip(a) === strip(b);
}

/** Whether connecting will ask for a password / passphrase (no known one). */
export function needsSecret(p: RemoteProfile): boolean {
  if (isFtp(p.kind)) {
    return !p.anonymous;
  }
  return p.auth === 'password';
}
