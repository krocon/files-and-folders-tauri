import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { describeFsError } from '../../core/fs/fs-error';
import { Remember } from '../../core/remote/remote.models';
import { Modal } from '../../shared/dialog/modal';
import { encrypted } from './remote-logic';
import { REMOTE_TEXTS } from './remote-texts';
import { RemoteStore } from './remote.store';

/**
 * Questions while connecting (design 034 §4.2): the password or key passphrase, an
 * unknown SSH host key, an untrusted FTPS certificate. The password field is cleared
 * as soon as it was sent – nothing here keeps it. Esc / Cancel gives the connect up.
 */
@Component({
  selector: 'app-remote-prompt-dialog',
  imports: [Modal],
  template: `
    @if (store.prompt(); as p) {
      @switch (p.kind) {
        @case ('secret') {
          <app-modal
            [heading]="t.secretTitle(p.profile.name)"
            width="min(34rem, 94vw)"
            (closed)="store.cancelPrompt()"
          >
            <form class="form" (submit)="submit($event)">
              <p class="source path">{{ address() }}</p>
              @if (!encrypted(p.profile.kind)) {
                <p class="danger-text" role="note">
                  <i class="fa fa-unlock-alt" aria-hidden="true"></i> {{ t.plainWarning }}
                </p>
              }
              @if (p.refused && !store.promptError()) {
                <p class="error" role="status">{{ t.secretRefused }}</p>
              }
              <label class="field">
                <span>{{ p.what === 'passphrase' ? t.secretPassphrase : t.secretPassword }}</span>
                <input
                  data-autofocus
                  type="password"
                  autocomplete="off"
                  spellcheck="false"
                  [value]="value()"
                  aria-describedby="fnf-remote-secret-error"
                  [attr.aria-invalid]="store.promptError() ? 'true' : null"
                  (input)="value.set($any($event.target).value); store.promptError.set(null)"
                />
              </label>
              @if (p.keychain) {
                <label class="check">
                  <input
                    type="checkbox"
                    [checked]="keychain()"
                    (change)="keychain.set($any($event.target).checked)"
                  />
                  {{ t.rememberKeychain }}
                </label>
              } @else {
                <p class="help">{{ t.noKeychain }}</p>
              }
              <p id="fnf-remote-secret-error" class="error" role="alert">{{ errorText() }}</p>
              <div class="buttons">
                <div class="spacer"></div>
                <button type="button" class="btn" (click)="store.cancelPrompt()">
                  {{ t.cancel }}
                </button>
                <button type="submit" class="btn primary" [disabled]="store.busy() || !value()">
                  {{ t.login }}
                </button>
              </div>
            </form>
          </app-modal>
        }
        @case ('hostKey') {
          <app-modal
            [heading]="t.hostKeyTitle"
            width="min(40rem, 94vw)"
            dialogRole="alertdialog"
            describedBy="fnf-remote-hostkey-intro"
            (closed)="store.cancelPrompt()"
          >
            <div class="form">
              <p id="fnf-remote-hostkey-intro" class="message">{{ t.hostKeyIntro(address()) }}</p>
              <dl class="facts">
                <dt>{{ t.keyType }}</dt>
                <dd class="path">{{ p.keyType }}</dd>
                <dt>{{ t.fingerprint }}</dt>
                <dd class="path">{{ p.fingerprint }}</dd>
              </dl>
              <p class="error" role="alert">{{ errorText() }}</p>
              <div class="buttons">
                <div class="spacer"></div>
                <button type="button" class="btn" data-autofocus (click)="store.cancelPrompt()">
                  {{ t.cancel }}
                </button>
                <button
                  type="button"
                  class="btn primary"
                  [disabled]="store.busy()"
                  (click)="store.trustHostKey()"
                >
                  {{ t.trust }}
                </button>
              </div>
            </div>
          </app-modal>
        }
        @case ('certificate') {
          <app-modal
            [heading]="t.certTitle"
            width="min(40rem, 94vw)"
            dialogRole="alertdialog"
            describedBy="fnf-remote-cert-intro"
            (closed)="store.cancelPrompt()"
          >
            <div class="form">
              <p id="fnf-remote-cert-intro" class="message">{{ t.certIntro(address()) }}</p>
              @if (p.pinnedChanged) {
                <p class="danger-text" role="note">{{ t.certChanged }}</p>
              }
              <dl class="facts">
                <dt>{{ t.fingerprint }} (SHA-256)</dt>
                <dd class="path">{{ grouped(p.sha256) }}</dd>
                <dt>{{ t.reason }}</dt>
                <dd>{{ p.reason }}</dd>
              </dl>
              @if (p.hostnameMismatch) {
                <p class="help">{{ t.certHostname }}</p>
                <label class="check">
                  <input
                    type="checkbox"
                    [checked]="acceptHostname()"
                    (change)="acceptHostname.set($any($event.target).checked)"
                  />
                  {{ t.acceptHostname }}
                </label>
              }
              <p class="error" role="alert">{{ errorText() }}</p>
              <div class="buttons">
                <div class="spacer"></div>
                <button type="button" class="btn" data-autofocus (click)="store.cancelPrompt()">
                  {{ t.cancel }}
                </button>
                <button
                  type="button"
                  class="btn primary"
                  [disabled]="store.busy() || (p.hostnameMismatch && !acceptHostname())"
                  (click)="store.trustCertificate(acceptHostname())"
                >
                  {{ t.trust }}
                </button>
              </div>
            </div>
          </app-modal>
        }
      }
    }
  `,
  styleUrls: ['../ops/ops-dialog.css', './remote-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RemotePromptDialog {
  protected readonly t = REMOTE_TEXTS;
  protected readonly store = inject(RemoteStore);
  protected readonly value = signal('');
  protected readonly keychain = signal(true);
  protected readonly acceptHostname = signal(false);
  protected readonly encrypted = encrypted;

  protected readonly address = computed(() => {
    const p = this.store.prompt()?.profile;
    if (!p) {
      return '';
    }
    const host = p.host.includes(':') ? `[${p.host}]` : p.host;
    return `${p.user ? `${p.user}@` : ''}${host}:${p.port}`;
  });

  protected errorText(): string {
    const e = this.store.promptError();
    return e ? describeFsError(e) : '';
  }

  /** `ab12cd…` in groups of four for reading aloud. */
  protected grouped(hex: string): string {
    return (hex.match(/.{1,4}/g) ?? []).join(' ');
  }

  protected submit(evt: Event): void {
    evt.preventDefault();
    const secret = this.value();
    if (!secret || this.store.busy()) {
      return;
    }
    const p = this.store.prompt();
    const remember: Remember =
      p?.kind === 'secret' && p.keychain && this.keychain() ? 'keychain' : 'none';
    // the field is cleared at once – the password lives only in the call to Rust
    this.value.set('');
    void this.store.submitSecret(secret, remember);
  }
}
