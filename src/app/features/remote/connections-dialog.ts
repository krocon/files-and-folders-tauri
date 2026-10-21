import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { AuthKind, NameEncoding, RemoteKind, RemoteProfile } from '../../core/remote/remote.models';
import { serverPath } from '../../core/remote/remote-path';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { WorkspaceStore } from '../workspace/workspace.store';
import {
  blankProfile,
  duplicateProfile,
  encrypted,
  isFtp,
  problemOf,
  sameProfile,
  withKind,
} from './remote-logic';
import { REMOTE_TEXTS } from './remote-texts';
import { RemoteStore } from './remote.store';

const KINDS: readonly RemoteKind[] = ['sftp', 'ftpsExplicit', 'ftpsImplicit', 'ftp'];
const AUTHS: readonly AuthKind[] = ['password', 'key', 'agent'];
const ENCODINGS: readonly NameEncoding[] = ['auto', 'utf8', 'latin1'];

type TextField = 'name' | 'host' | 'user' | 'keyFile' | 'startPath' | 'description';
type NumField = 'port' | 'timeoutSecs' | 'maxConnections' | 'keepaliveSecs';

/**
 * "Connect to server" (OPEN_CONNECTIONS_DLG, design 034 §4.2, after the FTP Explorer
 * and CloudMounter templates): an address field for quick connects, the profiles on
 * the left, the form of the chosen one on the right. Passwords are never typed here –
 * they are asked when connecting (and may go to the keychain then).
 */
@Component({
  selector: 'app-connections-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.title" width="58rem" (closed)="close()">
      <div class="tool">
        <div class="body">
          <p class="intro">{{ t.intro }}</p>
          <form class="row" (submit)="openAddress($event)">
            <label class="field grow">
              <span>{{ t.address }}</span>
              <input
                type="text"
                spellcheck="false"
                autocomplete="off"
                placeholder="sftp://user@host/path"
                [value]="address()"
                aria-describedby="fnf-remote-address-help"
                (input)="address.set($any($event.target).value)"
              />
            </label>
            <button type="submit" class="btn" [disabled]="!address().trim()">
              {{ t.quickConnect }}
            </button>
            <p class="help wide" id="fnf-remote-address-help">{{ t.addressHelp }}</p>
          </form>
          @if (note(); as n) {
            <p class="notice" role="status">{{ n }}</p>
          }
          <div class="editor connections">
            <div class="field side">
              <span [id]="listLabelId">{{ t.profiles }}</span>
              <ul
                class="listbox entries"
                role="listbox"
                tabindex="0"
                data-autofocus
                [attr.aria-labelledby]="listLabelId"
                [attr.aria-describedby]="listHelpId"
                [attr.aria-activedescendant]="selected() !== null ? optionId(selected()!) : null"
                (keydown)="onListKey($event)"
                (click)="onListClick($event)"
                (dblclick)="connect()"
              >
                @for (p of list(); track p.id) {
                  <li
                    role="option"
                    [id]="optionId(p.id)"
                    [attr.aria-selected]="p.id === selected()"
                    [attr.data-id]="p.id"
                  >
                    <i
                      class="fa {{ encrypted(p.kind) ? 'fa-lock' : 'fa-unlock-alt warn' }}"
                      aria-hidden="true"
                    ></i>
                    <span class="grow">{{ p.name || '…' }}</span>
                    <span class="muted">{{ t.shortKinds[p.kind] }}</span>
                    @if (store.state(p.id) === 'connected') {
                      <i class="fa fa-plug" [attr.aria-label]="t.connected(p.name)"></i>
                    }
                  </li>
                } @empty {
                  <li class="empty" role="option" aria-selected="false" aria-disabled="true">
                    {{ t.noProfiles }}
                  </li>
                }
              </ul>
              <p class="help" [id]="listHelpId">{{ t.listHelp }}</p>
              <div class="stack">
                <button type="button" class="btn" (click)="addNew()">
                  <i class="fa fa-plus" aria-hidden="true"></i> {{ t.newProfile }}
                </button>
                <button type="button" class="btn" [disabled]="!form()" (click)="duplicate()">
                  <i class="fa fa-clone" aria-hidden="true"></i> {{ t.duplicate }}
                </button>
                <button
                  type="button"
                  class="btn"
                  [class.danger]="confirmRemove()"
                  [disabled]="!form()"
                  (click)="remove()"
                >
                  <i class="fa fa-trash-o" aria-hidden="true"></i>
                  {{ confirmRemove() ? t.removeTitle + '?' : t.remove }}
                </button>
              </div>
              @if (confirmRemove() && form(); as f) {
                <p class="notice" role="alert">{{ t.removeMessage(f.name) }}</p>
              }
            </div>
            <div class="side details" role="group" [attr.aria-label]="form()?.name ?? t.profiles">
              @if (form(); as f) {
                <label class="field">
                  <span>{{ t.name }}</span>
                  <input
                    type="text"
                    class="plain"
                    maxlength="80"
                    [value]="f.name"
                    [attr.aria-invalid]="problem() === 'name' ? 'true' : null"
                    (input)="setText('name', $event)"
                  />
                </label>
                <label class="field">
                  <span>{{ t.kind }}</span>
                  <select [value]="f.kind" (change)="setKind($event)">
                    @for (k of kinds; track k) {
                      <option [value]="k" [selected]="k === f.kind">{{ t.kinds[k] }}</option>
                    }
                  </select>
                </label>
                @if (!encrypted(f.kind)) {
                  <p class="danger-text" role="note">
                    <i class="fa fa-unlock-alt" aria-hidden="true"></i> {{ t.plainWarning }}
                  </p>
                }
                <div class="row">
                  <label class="field grow">
                    <span>{{ t.host }}</span>
                    <input
                      type="text"
                      spellcheck="false"
                      autocomplete="off"
                      [value]="f.host"
                      [attr.aria-invalid]="problem() === 'host' ? 'true' : null"
                      (input)="setText('host', $event)"
                    />
                  </label>
                  <label class="field num">
                    <span>{{ t.port }}</span>
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      [value]="f.port"
                      [attr.aria-invalid]="problem() === 'port' ? 'true' : null"
                      (input)="setNum('port', $event)"
                    />
                  </label>
                </div>
                <div class="row">
                  <label class="field grow">
                    <span>{{ t.user }}</span>
                    <input
                      type="text"
                      spellcheck="false"
                      autocomplete="off"
                      [disabled]="isFtp(f.kind) && f.anonymous"
                      [value]="f.user"
                      [attr.aria-invalid]="problem() === 'user' ? 'true' : null"
                      (input)="setText('user', $event)"
                    />
                  </label>
                  @if (isFtp(f.kind)) {
                    <label class="check">
                      <input
                        type="checkbox"
                        [checked]="f.anonymous"
                        (change)="patch({ anonymous: $any($event.target).checked })"
                      />
                      {{ t.anonymous }}
                    </label>
                  }
                </div>
                @if (!isFtp(f.kind)) {
                  <label class="field">
                    <span>{{ t.authKind }}</span>
                    <select [value]="f.auth" (change)="setAuth($event)">
                      @for (a of auths; track a) {
                        <option [value]="a" [selected]="a === f.auth">{{ t.auths[a] }}</option>
                      }
                    </select>
                  </label>
                  @if (f.auth === 'key') {
                    <label class="field">
                      <span>{{ t.keyFile }}</span>
                      <input
                        type="text"
                        spellcheck="false"
                        autocomplete="off"
                        [value]="f.keyFile ?? ''"
                        [attr.aria-invalid]="problem() === 'keyFile' ? 'true' : null"
                        aria-describedby="fnf-remote-key-help"
                        (input)="setText('keyFile', $event)"
                      />
                      <span class="help" id="fnf-remote-key-help">{{ t.keyFileHelp }}</span>
                    </label>
                  }
                }
                @if (f.id && needsPassword(f)) {
                  <div class="row secret">
                    <span class="label">{{ t.password }}:</span>
                    <span class="muted grow">{{ secretState(f) }}</span>
                    @if (f.secret === 'keychain' || store.sessionSecrets().has(f.id)) {
                      <button type="button" class="btn small" (click)="forget(f.id)">
                        {{ t.forgetPassword }}
                      </button>
                    }
                  </div>
                }
                <label class="field">
                  <span>{{ t.startPath }}</span>
                  <input
                    type="text"
                    spellcheck="false"
                    autocomplete="off"
                    [value]="f.startPath ?? ''"
                    [attr.aria-invalid]="problem() === 'startPath' ? 'true' : null"
                    aria-describedby="fnf-remote-start-help"
                    (input)="setText('startPath', $event)"
                  />
                  <span class="help" id="fnf-remote-start-help">{{ t.startPathHelp }}</span>
                </label>
                @if (f.pinnedCert) {
                  <p class="help">
                    <i class="fa fa-certificate" aria-hidden="true"></i> {{ t.pinned }}
                  </p>
                }
                <details class="advanced">
                  <summary>{{ t.advanced }}</summary>
                  @if (isFtp(f.kind)) {
                    <label class="check">
                      <input type="checkbox" checked disabled />
                      {{ t.passive }}
                    </label>
                    <label class="field">
                      <span>{{ t.encoding }}</span>
                      <select [value]="f.encoding" (change)="setEncoding($event)">
                        @for (e of encodings; track e) {
                          <option [value]="e" [selected]="e === f.encoding">
                            {{ t.encodings[e] }}
                          </option>
                        }
                      </select>
                    </label>
                  }
                  <div class="row">
                    <label class="field num">
                      <span>{{ t.timeout }}</span>
                      <input
                        type="number"
                        min="5"
                        max="120"
                        [value]="f.timeoutSecs"
                        (input)="setNum('timeoutSecs', $event)"
                      />
                    </label>
                    <label class="field num">
                      <span>{{ t.maxConnections }}</span>
                      <input
                        type="number"
                        min="1"
                        max="8"
                        [value]="f.maxConnections"
                        (input)="setNum('maxConnections', $event)"
                      />
                    </label>
                    <label class="field num">
                      <span>{{ t.keepalive }}</span>
                      <input
                        type="number"
                        min="0"
                        max="600"
                        [value]="f.keepaliveSecs"
                        (input)="setNum('keepaliveSecs', $event)"
                      />
                    </label>
                  </div>
                  <label class="field">
                    <span>{{ t.description }}</span>
                    <textarea
                      rows="2"
                      maxlength="1000"
                      [value]="f.description"
                      (input)="setText('description', $event)"
                    ></textarea>
                  </label>
                </details>
                @if (problem(); as code) {
                  <p class="notice" role="note">{{ t.invalid[code] ?? code }}</p>
                }
              }
            </div>
          </div>
        </div>
        <p class="error" role="alert">{{ error() || testError() }}</p>
        <p class="help" role="status">{{ testInfo() || info() }}</p>
        <div class="foot">
          <div class="buttons">
            <button type="button" class="btn" [disabled]="!canUse()" (click)="favorite()">
              <i class="fa fa-star-o" aria-hidden="true"></i> {{ t.favorite }}
            </button>
            <button type="button" class="btn" [disabled]="!canUse()" (click)="test()">
              {{ t.test }}
            </button>
            <button
              type="button"
              class="btn"
              [disabled]="busy() || !dirty() || problem() !== null"
              (click)="save()"
            >
              {{ t.save }}
            </button>
            <button type="button" class="btn" (click)="close()">{{ t.close }}</button>
            <button type="button" class="btn primary" [disabled]="!canUse()" (click)="connect()">
              {{ t.connect }}
            </button>
          </div>
        </div>
      </div>
    </app-modal>
  `,
  styleUrls: [
    '../../shared/dialog/tool-dialog.css',
    '../config/config-dialog.css',
    '../starter/starter-dialog.css',
    './remote-dialog.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionsDialog {
  protected readonly t = REMOTE_TEXTS;
  protected readonly store = inject(RemoteStore);
  protected readonly dialogs = inject(DialogService);
  private readonly ws = inject(WorkspaceStore);
  protected readonly kinds = KINDS;
  protected readonly auths = AUTHS;
  protected readonly encodings = ENCODINGS;
  protected readonly encrypted = encrypted;
  protected readonly isFtp = isFtp;
  protected readonly listLabelId = 'fnf-remote-list-label';
  protected readonly listHelpId = 'fnf-remote-list-help';

  protected readonly address = signal('');
  /** The profile in the form: a saved one (id) or a new draft (id ''). */
  protected readonly form = signal<RemoteProfile | null>(null);
  protected readonly selected = signal<string | null>(null);
  protected readonly note = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly info = signal('');
  protected readonly busy = signal(false);
  protected readonly confirmRemove = signal(false);

  /** Saved profiles plus the unsaved draft (shown first). */
  protected readonly list = computed(() => {
    const f = this.form();
    const saved = this.store.profiles();
    return f && f.id === '' ? [{ ...f, id: '' }, ...saved] : saved;
  });
  protected readonly original = computed(() => {
    const id = this.form()?.id;
    return id ? this.store.profile(id) : null;
  });
  protected readonly dirty = computed(() => {
    const f = this.form();
    const o = this.original();
    return f !== null && (o === null || !sameProfile(f, o));
  });
  protected readonly problem = computed(() => {
    const f = this.form();
    return f ? problemOf(f) : null;
  });
  /** Result of "Test" for the shown profile (survives the password/trust questions). */
  private readonly testResult = computed(() => {
    const r = this.store.testResult();
    return r && r.id === this.form()?.id ? r : null;
  });
  protected readonly testInfo = computed(() => {
    const r = this.testResult();
    return r?.ok ? this.t.testOk(r.info) : '';
  });
  protected readonly testError = computed(() => {
    const r = this.testResult();
    return r && !r.ok ? r.info : '';
  });
  protected readonly canUse = computed(
    () => this.form() !== null && this.problem() === null && !this.busy(),
  );

  constructor() {
    void this.store.init().then(() => {
      const draft = this.store.dialogDraft();
      this.store.dialogDraft.set(null);
      if (draft) {
        this.form.set(draft.profile);
        this.selected.set('');
        this.note.set(draft.note);
        return;
      }
      const want = this.store.dialogSelect() ?? this.store.profiles()[0]?.id ?? null;
      this.store.dialogSelect.set(null);
      this.pick(want);
    });
  }

  protected optionId(id: string): string {
    return `fnf-remote-opt-${id || 'new'}`;
  }

  protected needsPassword(f: RemoteProfile): boolean {
    return isFtp(f.kind) ? !f.anonymous : f.auth !== 'agent';
  }

  protected secretState(f: RemoteProfile): string {
    if (f.secret === 'keychain') {
      return this.t.passwordStored;
    }
    return this.store.sessionSecrets().has(f.id) ? this.t.passwordSession : this.t.passwordNone;
  }

  private pick(id: string | null): void {
    this.confirmRemove.set(false);
    if (id !== this.store.testResult()?.id) {
      this.store.testResult.set(null);
    }
    this.error.set('');
    this.info.set('');
    if (id === null) {
      this.form.set(null);
      this.selected.set(null);
      return;
    }
    if (id === '') {
      return;
    }
    const p = this.store.profile(id);
    this.form.set(p);
    this.selected.set(p ? id : null);
    setTimeout(() =>
      document.getElementById(this.optionId(id))?.scrollIntoView?.({ block: 'nearest' }),
    );
  }

  /** Leaving a changed profile drops the changes (the user saw "Save" enabled). */
  private select(id: string | null): void {
    if (id === this.selected()) {
      return;
    }
    // an unsaved draft is dropped when another entry is chosen
    this.pick(id);
  }

  patch(change: Partial<RemoteProfile>): void {
    this.form.update((f) => (f ? { ...f, ...change } : f));
    this.confirmRemove.set(false);
    this.info.set('');
    this.store.testResult.set(null);
  }

  protected setText(field: TextField, evt: Event): void {
    const v = (evt.target as HTMLInputElement).value;
    const empty = v.trim() === '';
    if (field === 'keyFile' || field === 'startPath') {
      this.patch({ [field]: empty ? null : v } as Partial<RemoteProfile>);
    } else {
      this.patch({ [field]: v } as Partial<RemoteProfile>);
    }
  }

  protected setNum(field: NumField, evt: Event): void {
    const n = Number((evt.target as HTMLInputElement).value);
    this.patch({ [field]: Number.isFinite(n) ? Math.trunc(n) : 0 } as Partial<RemoteProfile>);
  }

  protected setKind(evt: Event): void {
    const kind = (evt.target as HTMLSelectElement).value as RemoteKind;
    this.form.update((f) => (f ? withKind(f, kind) : f));
  }

  protected setAuth(evt: Event): void {
    this.patch({ auth: (evt.target as HTMLSelectElement).value as AuthKind });
  }

  protected setEncoding(evt: Event): void {
    this.patch({ encoding: (evt.target as HTMLSelectElement).value as NameEncoding });
  }

  protected addNew(): void {
    this.form.set(blankProfile(this.t.newName));
    this.selected.set('');
    this.note.set(null);
    setTimeout(() =>
      document.querySelector<HTMLInputElement>('app-connections-dialog .details input')?.select(),
    );
  }

  protected duplicate(): void {
    const f = this.form();
    if (f) {
      this.form.set(duplicateProfile(f, this.t.copyName(f.name)));
      this.selected.set('');
    }
  }

  protected async remove(): Promise<void> {
    const f = this.form();
    if (!f) {
      return;
    }
    if (f.id === '') {
      this.pick(this.store.profiles()[0]?.id ?? null);
      return;
    }
    if (!this.confirmRemove()) {
      this.confirmRemove.set(true);
      return;
    }
    this.busy.set(true);
    try {
      await this.store.remove(f.id);
      this.pick(this.store.profiles()[0]?.id ?? null);
    } catch (err) {
      this.error.set(errorText(toFsError(err)));
    } finally {
      this.busy.set(false);
    }
  }

  protected async forget(id: string): Promise<void> {
    try {
      await this.store.forgetSecret(id);
      this.form.update((f) => (f && f.id === id ? { ...f, secret: 'none' } : f));
    } catch (err) {
      this.error.set(errorText(toFsError(err)));
    }
  }

  /** Saves the form if needed; returns the saved profile (or null on an error). */
  protected async save(): Promise<RemoteProfile | null> {
    const f = this.form();
    if (!f || this.problem() !== null) {
      return null;
    }
    if (!this.dirty() && f.id) {
      return f;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = await this.store.save(f);
      this.form.set(saved);
      this.selected.set(saved.id);
      this.note.set(null);
      this.info.set(this.t.saved);
      return saved;
    } catch (err) {
      this.error.set(errorText(toFsError(err)));
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  protected async connect(): Promise<void> {
    const saved = await this.save();
    if (!saved) {
      return;
    }
    this.dialogs.close({ restoreFocus: false });
    void this.store.connect(saved.id, { navigate: true });
  }

  protected async test(): Promise<void> {
    const saved = await this.save();
    if (!saved) {
      return;
    }
    this.store.testResult.set(null);
    this.info.set(this.t.connecting(saved.name));
    const id = saved.id;
    await this.store.connect(id, {
      backToDialog: true,
      done: (ok, info) => this.store.testResult.set({ id, ok, info }),
    });
  }

  protected async favorite(): Promise<void> {
    const saved = await this.save();
    if (!saved) {
      return;
    }
    const path = serverPath(saved.id, saved.startPath);
    if (!this.ws.isFavorite(path)) {
      this.ws.toggleFavorite(path);
    }
    this.info.set(this.t.favoriteAdded(saved.name));
  }

  protected openAddress(evt: Event): void {
    evt.preventDefault();
    const text = this.address().trim();
    if (text) {
      void this.store.openUrl(text).then(() => {
        const draft = this.store.dialogDraft();
        this.store.dialogDraft.set(null);
        if (draft) {
          this.form.set(draft.profile);
          this.selected.set('');
          this.note.set(draft.note);
          this.address.set('');
        }
      });
    }
  }

  protected close(): void {
    this.dialogs.close();
  }

  /** APG listbox: ↑/↓/Home/End select, Enter connects, Delete removes. */
  protected onListKey(evt: KeyboardEvent): void {
    const all = this.list();
    const i = all.findIndex((p) => p.id === this.selected());
    let next: number;
    switch (evt.key) {
      case 'ArrowDown':
        next = Math.min(all.length - 1, i + 1);
        break;
      case 'ArrowUp':
        next = Math.max(0, i - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = all.length - 1;
        break;
      case 'Enter':
        evt.preventDefault();
        void this.connect();
        return;
      case 'Delete':
        evt.preventDefault();
        void this.remove();
        return;
      default:
        return;
    }
    evt.preventDefault();
    const id = all[next]?.id;
    if (id !== undefined) {
      this.select(id);
    }
  }

  protected onListClick(evt: MouseEvent): void {
    const li = (evt.target as Element | null)?.closest?.<HTMLElement>('[data-id]');
    if (li) {
      this.select(li.dataset['id'] ?? null);
    }
  }
}
