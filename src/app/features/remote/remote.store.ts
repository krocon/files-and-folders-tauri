import { computed, inject, Injectable, Injector, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { RemoteApi } from '../../core/remote/remote-api';
import { RemoteConnectPrompt } from '../../core/remote/remote-connect-prompt';
import {
  ConnectOutcome,
  ConnState,
  RemoteProfile,
  Remember,
} from '../../core/remote/remote.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { REMOTE_TEXTS } from './remote-texts';

/** What the prompt dialog asks (design 034 §4.2). */
export type RemotePrompt =
  | {
      readonly kind: 'secret';
      readonly profile: RemoteProfile;
      readonly what: 'password' | 'passphrase';
      readonly keychain: boolean;
      readonly refused: boolean;
    }
  | {
      readonly kind: 'hostKey';
      readonly profile: RemoteProfile;
      readonly keyType: string;
      readonly fingerprint: string;
    }
  | {
      readonly kind: 'certificate';
      readonly profile: RemoteProfile;
      readonly sha256: string;
      readonly reason: string;
      readonly hostnameMismatch: boolean;
      readonly pinnedChanged: boolean;
    };

/** What happens once a connect succeeded. */
interface Flow {
  readonly id: string;
  /** Open the server in the active panel. */
  readonly navigate: boolean;
  readonly then?: () => unknown;
  /** Reopen the connections dialog afterwards (test from the dialog). */
  readonly backToDialog: boolean;
  /** Result for the dialog ("test"). */
  readonly done?: (ok: boolean, info: string) => void;
}

/**
 * Server connections (design 034): the profiles, their state and the connect flow
 * (password → host key → certificate questions). A password typed in the prompt goes
 * to Rust once and is not kept here – the prompt dialog clears its field at once.
 */
@Injectable({ providedIn: 'root' })
export class RemoteStore {
  private readonly api = inject(RemoteApi);
  private readonly dialogs = inject(DialogService);
  private readonly ws = inject(WorkspaceStore);
  /** Looked up when a message is reported: panels use this store without the action system. */
  private readonly injector = inject(Injector);
  private readonly bridge = inject(RemoteConnectPrompt);

  readonly profiles = signal<readonly RemoteProfile[]>([]);
  readonly states = signal<Readonly<Record<string, ConnState>>>({});
  readonly keychain = signal(false);
  readonly sessionSecrets = signal<ReadonlySet<string>>(new Set());
  readonly loaded = signal(false);
  /** Status line for screen readers (connected, disconnected). */
  readonly status = signal('');
  readonly prompt = signal<RemotePrompt | null>(null);
  /** The prompt's own error (wrong password …). */
  readonly promptError = signal<FsError | null>(null);
  readonly busy = signal(false);
  /** A draft for the dialog (quick connect, "edit this server"). */
  readonly dialogDraft = signal<{ profile: RemoteProfile; note: string | null } | null>(null);
  readonly dialogSelect = signal<string | null>(null);
  /** Result of the dialog's "Test" (shown when the dialog comes back after a question). */
  readonly testResult = signal<{ id: string; ok: boolean; info: string } | null>(null);

  private flow: Flow | null = null;
  private initDone: Promise<void> | null = null;

  readonly connectedIds = computed(
    () =>
      new Set(
        Object.entries(this.states())
          .filter(([, s]) => s === 'connected')
          .map(([id]) => id),
      ),
  );

  private report(message: string): void {
    this.injector.get(ActionService).report(message);
  }

  init(): Promise<void> {
    if (!this.initDone) {
      this.initDone = (async () => {
        this.bridge.setHandler((id, retry) => void this.connect(id, { then: retry }));
        await this.api.subscribe((ev) =>
          this.states.update((s) => ({ ...s, [ev.profileId]: ev.state })),
        );
        await this.reload();
      })().catch((err) => {
        this.report(REMOTE_TEXTS.loadFailed(errorText(toFsError(err))));
      });
    }
    return this.initDone;
  }

  async reload(): Promise<void> {
    const l = await this.api.load();
    this.profiles.set(l.profiles);
    this.states.set(l.states);
    this.keychain.set(l.keychain);
    this.sessionSecrets.set(new Set(l.sessionSecrets));
    this.loaded.set(true);
    if (l.warning) {
      this.report(REMOTE_TEXTS.loadFailed(l.warning.code));
    }
  }

  profile(id: string): RemoteProfile | null {
    return this.profiles().find((p) => p.id === id) ?? null;
  }

  state(id: string): ConnState {
    return this.states()[id] ?? 'disconnected';
  }

  // ---- dialog -------------------------------------------------------------------

  openDialog(select: string | null = null): void {
    void this.init();
    this.dialogSelect.set(select);
    this.dialogs.show('connections');
  }

  /** Opens the dialog with a new profile from an address (`sftp://…`). */
  async openUrl(url: string): Promise<void> {
    await this.init();
    try {
      const parsed = await this.api.parseUrl(url);
      this.dialogDraft.set({
        profile: parsed.profile,
        note: parsed.droppedPassword ? REMOTE_TEXTS.droppedPassword : null,
      });
      this.dialogs.show('connections');
    } catch (err) {
      this.report(errorText(toFsError(err)));
    }
  }

  async save(profile: RemoteProfile): Promise<RemoteProfile> {
    const saved = await this.api.save(profile);
    this.profiles.update((list) =>
      list.some((p) => p.id === saved.id)
        ? list.map((p) => (p.id === saved.id ? saved : p))
        : [...list, saved],
    );
    return saved;
  }

  async remove(id: string): Promise<void> {
    await this.api.remove(id);
    this.profiles.update((list) => list.filter((p) => p.id !== id));
    this.states.update((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== id)));
  }

  async forgetSecret(id: string): Promise<void> {
    await this.api.forgetSecret(id);
    this.sessionSecrets.update((s) => new Set([...s].filter((x) => x !== id)));
    this.profiles.update((list) =>
      list.map((p) => (p.id === id ? { ...p, secret: 'none' as const } : p)),
    );
  }

  async disconnect(id: string): Promise<void> {
    await this.api.disconnect(id);
    this.states.update((s) => ({ ...s, [id]: 'disconnected' }));
    const name = this.profile(id)?.name ?? id;
    this.status.set(REMOTE_TEXTS.disconnected(name));
  }

  // ---- connecting -------------------------------------------------------------------

  /**
   * Connects profile `id`. `navigate` opens it in the active panel, `then` runs after
   * success (a panel loads its folder again). Asks for secrets and trust on the way.
   */
  async connect(
    id: string,
    opts: {
      navigate?: boolean;
      then?: () => unknown;
      backToDialog?: boolean;
      done?: (ok: boolean, info: string) => void;
    } = {},
  ): Promise<void> {
    await this.init();
    this.flow = {
      id,
      navigate: opts.navigate ?? false,
      then: opts.then,
      backToDialog: opts.backToDialog ?? false,
      done: opts.done,
    };
    await this.attempt(null, 'none');
  }

  private async attempt(secret: string | null, remember: Remember): Promise<void> {
    const flow = this.flow;
    if (!flow) {
      return;
    }
    const profile = this.profile(flow.id);
    this.busy.set(true);
    this.status.set(REMOTE_TEXTS.connecting(profile?.name ?? flow.id));
    let outcome: ConnectOutcome;
    try {
      outcome = await this.api.connect(flow.id, secret, remember);
    } catch (err) {
      const e = toFsError(err);
      this.busy.set(false);
      if (this.prompt()?.kind === 'secret' && e.code === 'remote_auth_failed') {
        // stay in the password dialog with the message
        this.promptError.set(e);
        return;
      }
      this.finish(false, errorText(e));
      return;
    }
    this.busy.set(false);
    if (!profile) {
      return;
    }
    switch (outcome.status) {
      case 'connected': {
        if (remember !== 'none' || secret !== null) {
          this.sessionSecrets.update((s) => new Set([...s, flow.id]));
        }
        if (remember === 'keychain' && !outcome.keychainFailed) {
          this.profiles.update((list) =>
            list.map((p) => (p.id === flow.id ? { ...p, secret: 'keychain' as const } : p)),
          );
        }
        if (outcome.keychainFailed) {
          this.report(REMOTE_TEXTS.keychainFailed);
        }
        this.states.update((s) => ({ ...s, [flow.id]: 'connected' }));
        this.status.set(REMOTE_TEXTS.connected(profile.name));
        this.closePrompt();
        if (flow.navigate) {
          this.ws.requestNavigate(this.ws.activeSide(), outcome.home);
        }
        flow.then?.();
        this.finish(true, outcome.serverInfo);
        return;
      }
      case 'needsSecret':
        this.showPrompt({
          kind: 'secret',
          profile,
          what: outcome.what,
          keychain: outcome.keychain,
          refused: outcome.refused,
        });
        return;
      case 'hostKeyUnknown':
        this.showPrompt({
          kind: 'hostKey',
          profile,
          keyType: outcome.keyType,
          fingerprint: outcome.fingerprint,
        });
        return;
      case 'certificateUntrusted':
        this.showPrompt({
          kind: 'certificate',
          profile,
          sha256: outcome.sha256,
          reason: outcome.reason,
          hostnameMismatch: outcome.hostnameMismatch,
          pinnedChanged: outcome.pinnedChanged,
        });
        return;
    }
  }

  private showPrompt(p: RemotePrompt): void {
    this.promptError.set(null);
    this.prompt.set(p);
    if (this.dialogs.open() !== 'remote-prompt') {
      this.dialogs.show('remote-prompt');
    }
  }

  /** The password dialog's answer (the field is cleared by the dialog). */
  submitSecret(secret: string, remember: Remember): Promise<void> {
    this.promptError.set(null);
    return this.attempt(secret, remember);
  }

  async trustHostKey(): Promise<void> {
    const p = this.prompt();
    if (p?.kind !== 'hostKey') {
      return;
    }
    try {
      await this.api.trustHostKey(p.profile.id, p.fingerprint);
    } catch (err) {
      this.promptError.set(toFsError(err));
      return;
    }
    await this.attempt(null, 'none');
  }

  async trustCertificate(acceptHostname: boolean): Promise<void> {
    const p = this.prompt();
    if (p?.kind !== 'certificate') {
      return;
    }
    try {
      await this.api.trustCertificate(p.profile.id, p.sha256, acceptHostname);
    } catch (err) {
      this.promptError.set(toFsError(err));
      return;
    }
    // the pin changed the profile in Rust
    await this.reload().catch(() => undefined);
    await this.attempt(null, 'none');
  }

  /** Cancel in the prompt: the connect is given up (a typed secret is dropped in Rust). */
  cancelPrompt(): void {
    const flow = this.flow;
    if (flow && this.state(flow.id) !== 'connected') {
      void this.api.disconnect(flow.id).catch(() => undefined);
    }
    this.closePrompt();
    this.finish(false, '');
  }

  private closePrompt(): void {
    this.prompt.set(null);
    this.promptError.set(null);
    if (this.dialogs.open() === 'remote-prompt') {
      this.dialogs.close();
    }
  }

  private finish(ok: boolean, info: string): void {
    const flow = this.flow;
    this.flow = null;
    if (this.prompt() !== null) {
      this.closePrompt();
    }
    if (!flow) {
      return;
    }
    if (flow.done) {
      flow.done(ok, info);
    } else if (!ok && info) {
      this.report(info);
    }
    if (flow.backToDialog) {
      this.dialogSelect.set(flow.id);
      setTimeout(() => this.dialogs.show('connections'));
    }
  }
}
