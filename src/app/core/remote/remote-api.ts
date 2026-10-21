import { inject, Injectable } from '@angular/core';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import {
  ConnectOutcome,
  LoadedConnections,
  ParsedUrl,
  RemoteEvent,
  RemoteProfile,
  Remember,
} from './remote.models';

/**
 * Facade for the server connections (Rust `commands/remote.rs`, design 034). A password
 * goes to Rust once (`connect`) – nothing returns it. Rejects with an `FsError`.
 */
@Injectable({ providedIn: 'root', useFactory: () => inject(TauriRemoteApi) })
export abstract class RemoteApi {
  abstract load(): Promise<LoadedConnections>;
  abstract save(profile: RemoteProfile): Promise<RemoteProfile>;
  abstract remove(id: string): Promise<void>;
  abstract connect(
    id: string,
    password: string | null,
    remember: Remember,
  ): Promise<ConnectOutcome>;
  abstract trustHostKey(id: string, fingerprint: string): Promise<void>;
  abstract trustCertificate(id: string, sha256: string, acceptHostname: boolean): Promise<void>;
  abstract disconnect(id: string): Promise<void>;
  abstract forgetSecret(id: string): Promise<void>;
  abstract parseUrl(url: string): Promise<ParsedUrl>;
  abstract subscribe(onEvent: (event: RemoteEvent) => void): Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class TauriRemoteApi extends RemoteApi {
  load(): Promise<LoadedConnections> {
    if (!isTauri()) {
      // plain browser (pnpm start, tests): no connections, no error
      return Promise.resolve({
        profiles: [],
        states: {},
        keychain: false,
        sessionSecrets: [],
        warning: null,
      });
    }
    return call('load_connections', {});
  }
  save(profile: RemoteProfile): Promise<RemoteProfile> {
    return call('save_connection', { profile });
  }
  remove(id: string): Promise<void> {
    return call('delete_connection', { id });
  }
  connect(id: string, password: string | null, remember: Remember): Promise<ConnectOutcome> {
    return call('remote_connect', { id, password, remember });
  }
  trustHostKey(id: string, fingerprint: string): Promise<void> {
    return call('remote_trust_host_key', { id, fingerprint });
  }
  trustCertificate(id: string, sha256: string, acceptHostname: boolean): Promise<void> {
    return call('remote_trust_certificate', { id, sha256, acceptHostname });
  }
  disconnect(id: string): Promise<void> {
    return call('remote_disconnect', { id });
  }
  forgetSecret(id: string): Promise<void> {
    return call('remote_forget_secret', { id });
  }
  parseUrl(url: string): Promise<ParsedUrl> {
    return call('remote_parse_url', { url });
  }
  async subscribe(onEvent: (event: RemoteEvent) => void): Promise<void> {
    if (!isTauri()) {
      return;
    }
    const channel = new Channel<RemoteEvent>();
    channel.onmessage = onEvent;
    await call<void>('subscribe_remote', { channel });
  }
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
  }
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toFsError(err);
  }
}
