import { RemoteApi } from '../app/core/remote/remote-api';
import {
  ConnectOutcome,
  LoadedConnections,
  ParsedUrl,
  RemoteEvent,
  RemoteProfile,
  Remember,
} from '../app/core/remote/remote.models';

/**
 * In-memory RemoteApi (design 034). `outcomes` per profile id are returned by
 * `connect` one after another (the last one repeats); `calls` records every call
 * – the password only as `***` (tests check it was sent once and not kept).
 */
export class FakeRemoteApi extends RemoteApi {
  profiles: RemoteProfile[] = [];
  keychain = true;
  outcomes = new Map<string, (ConnectOutcome | { error: string })[]>();
  readonly calls: string[] = [];
  readonly passwords: (string | null)[] = [];
  private listener: ((e: RemoteEvent) => void) | null = null;
  private seq = 0;

  load(): Promise<LoadedConnections> {
    this.calls.push('load');
    return Promise.resolve({
      profiles: [...this.profiles],
      states: {},
      keychain: this.keychain,
      sessionSecrets: [],
      warning: null,
    });
  }

  save(profile: RemoteProfile): Promise<RemoteProfile> {
    this.calls.push(`save:${profile.id}`);
    const saved = { ...profile, id: profile.id || `p${++this.seq}` };
    const i = this.profiles.findIndex((p) => p.id === saved.id);
    if (i >= 0) {
      this.profiles[i] = saved;
    } else {
      this.profiles.push(saved);
    }
    return Promise.resolve(saved);
  }

  remove(id: string): Promise<void> {
    this.calls.push(`remove:${id}`);
    this.profiles = this.profiles.filter((p) => p.id !== id);
    return Promise.resolve();
  }

  connect(id: string, password: string | null, remember: Remember): Promise<ConnectOutcome> {
    this.calls.push(`connect:${id}:${password === null ? '-' : '***'}:${remember}`);
    this.passwords.push(password);
    const list = this.outcomes.get(id) ?? [];
    const next = list.length > 1 ? list.shift()! : list[0];
    if (!next) {
      return Promise.resolve({
        status: 'connected',
        home: `remote://${id}/`,
        encrypted: true,
        serverInfo: 'SFTP',
        keychainFailed: false,
      });
    }
    if ('error' in next) {
      return Promise.reject({ code: next.error, message: next.error, path: null });
    }
    if (next.status === 'connected') {
      this.listener?.({ profileId: id, state: 'connected' });
    }
    return Promise.resolve(next);
  }

  trustHostKey(id: string, fingerprint: string): Promise<void> {
    this.calls.push(`trustHostKey:${id}:${fingerprint}`);
    return Promise.resolve();
  }

  trustCertificate(id: string, sha256: string, acceptHostname: boolean): Promise<void> {
    this.calls.push(`trustCertificate:${id}:${sha256}:${acceptHostname}`);
    return Promise.resolve();
  }

  disconnect(id: string): Promise<void> {
    this.calls.push(`disconnect:${id}`);
    this.listener?.({ profileId: id, state: 'disconnected' });
    return Promise.resolve();
  }

  forgetSecret(id: string): Promise<void> {
    this.calls.push(`forget:${id}`);
    return Promise.resolve();
  }

  parseUrl(url: string): Promise<ParsedUrl> {
    this.calls.push(`parse:${url}`);
    const m = /^(\w+):\/\/(?:([^@:]+)(:[^@]*)?@)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
    if (!m) {
      return Promise.reject({ code: 'invalid_url', message: 'bad', path: null });
    }
    return Promise.resolve({
      profile: {
        ...sampleProfile(''),
        name: m[4],
        host: m[4],
        user: m[2] ?? '',
        kind: m[1] === 'ftp' ? 'ftp' : 'sftp',
        port: Number(m[5] ?? (m[1] === 'ftp' ? 21 : 22)),
        startPath: m[6] ?? null,
      },
      droppedPassword: m[3] !== undefined,
    });
  }

  subscribe(onEvent: (event: RemoteEvent) => void): Promise<void> {
    this.listener = onEvent;
    return Promise.resolve();
  }
}

export function sampleProfile(id: string, patch: Partial<RemoteProfile> = {}): RemoteProfile {
  return {
    id,
    name: `Server ${id}`,
    kind: 'sftp',
    host: 'example.org',
    port: 22,
    user: 'marc',
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
    ...patch,
  };
}
