/**
 * Server connections (design 034). Keep in sync with Rust `remote/profiles.rs`,
 * `remote/mod.rs` and `commands/remote.rs`. A profile never holds a secret:
 * `secret` only says whether one is kept in the system keychain.
 */

export type RemoteKind = 'ftp' | 'ftpsExplicit' | 'ftpsImplicit' | 'sftp';
export type AuthKind = 'password' | 'key' | 'agent';
export type NameEncoding = 'auto' | 'utf8' | 'latin1';
export type SecretState = 'none' | 'keychain';

export interface RemoteProfile {
  /** `[a-z0-9-]{1,40}`, made by Rust; `''` = new. */
  readonly id: string;
  readonly name: string;
  readonly kind: RemoteKind;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly anonymous: boolean;
  readonly auth: AuthKind;
  readonly keyFile: string | null;
  readonly startPath: string | null;
  readonly passive: boolean;
  readonly encoding: NameEncoding;
  readonly timeoutSecs: number;
  readonly maxConnections: number;
  readonly keepaliveSecs: number;
  readonly description: string;
  /** FTPS: SHA-256 of the certificate the user confirmed (set by Rust only). */
  readonly pinnedCert: string | null;
  readonly acceptHostnameMismatch: boolean;
  readonly secret: SecretState;
}

export type ConnState = 'disconnected' | 'connected' | 'lost';

/** How a secret typed now is kept. */
export type Remember = 'none' | 'session' | 'keychain';

export type ConnectOutcome =
  | {
      readonly status: 'connected';
      /** `remote://<id>/…` – start path or login folder. */
      readonly home: string;
      readonly encrypted: boolean;
      readonly serverInfo: string;
      readonly keychainFailed: boolean;
    }
  | {
      readonly status: 'needsSecret';
      readonly what: 'password' | 'passphrase';
      readonly keychain: boolean;
      /** The remembered secret was refused by the server. */
      readonly refused: boolean;
    }
  | { readonly status: 'hostKeyUnknown'; readonly keyType: string; readonly fingerprint: string }
  | {
      readonly status: 'certificateUntrusted';
      readonly sha256: string;
      readonly reason: string;
      readonly hostnameMismatch: boolean;
      readonly pinnedChanged: boolean;
    };

export interface RemoteEvent {
  readonly profileId: string;
  readonly state: ConnState;
}

export interface ConfigWarning {
  readonly code: string;
  readonly path: string | null;
}

export interface LoadedConnections {
  readonly profiles: readonly RemoteProfile[];
  readonly states: Readonly<Record<string, ConnState>>;
  readonly keychain: boolean;
  readonly sessionSecrets: readonly string[];
  readonly warning: ConfigWarning | null;
}

export interface ParsedUrl {
  readonly profile: RemoteProfile;
  readonly droppedPassword: boolean;
}

export const REMOTE_PREFIX = 'remote://';
