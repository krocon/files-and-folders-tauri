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
 * "Connect to server" (OPEN_CONNECTIONS_DLG, design 034 §4.2): an address field for
 * quick connects, the profiles as a table over the full width (actions in the last
 * column, New/Duplicate/Delete in the footer), the form in an editor dialog of its own
 * (Marc, 2026-10-24). Passwords are never typed here – they are asked when connecting
 * (and may go to the keychain then).
 */
@Component({
  selector: 'app-connections-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.title" width="min(64rem, 96vw)" height="44rem" (closed)="close()">
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
          <h3 class="section" [id]="listLabelId">{{ t.profiles }}</h3>
          <div class="conns-wrap">
            <table
              class="conns"
              role="grid"
              tabindex="-1"
              aria-readonly="true"
              [attr.aria-labelledby]="listLabelId"
              [attr.aria-describedby]="listHelpId"
              (keydown)="onListKey($event)"
              (click)="onListClick($event)"
              (dblclick)="onListDblClick($event)"
            >
              <thead>
                <tr>
                  <th scope="col" class="icon">
                    <span class="sr-only">{{ t.encrypted }}</span>
                  </th>
                  <th scope="col">{{ t.name }}</th>
                  <th scope="col">{{ t.kind }}</th>
                  <th scope="col">{{ t.host }}</th>
                  <th scope="col">{{ t.user }}</th>
                  <th scope="col">{{ t.startPath }}</th>
                  <th scope="col" class="actions">
                    <span class="sr-only">{{ t.actions }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (p of store.profiles(); track p.id) {
                  <tr
                    [id]="rowId(p.id)"
                    [attr.data-id]="p.id"
                    [attr.aria-selected]="p.id === selected()"
                    [attr.tabindex]="p.id === selected() ? 0 : -1"
                  >
                    <td class="icon">
                      <i
                        class="fa {{ encrypted(p.kind) ? 'fa-lock' : 'fa-unlock-alt warn' }}"
                        [attr.aria-label]="encrypted(p.kind) ? t.encrypted : t.unencrypted"
                        role="img"
                      ></i>
                    </td>
                    <td class="name">
                      {{ p.name || '…' }}
                      @if (store.state(p.id) === 'connected') {
                        <i
                          class="fa fa-plug"
                          role="img"
                          [attr.aria-label]="t.connected(p.name)"
                        ></i>
                      }
                    </td>
                    <td>{{ t.shortKinds[p.kind] }}</td>
                    <td class="mono">{{ p.host }}:{{ p.port }}</td>
                    <td class="mono">
                      {{ isFtp(p.kind) && p.anonymous ? t.anonymousShort : p.user }}
                    </td>
                    <td class="mono">{{ p.startPath ?? '' }}</td>
                    <td class="actions">
                      <button
                        type="button"
                        class="icon-btn"
                        tabindex="-1"
                        data-act="edit"
                        [attr.aria-label]="t.edit + ': ' + p.name"
                        [title]="t.edit"
                      >
                        <i class="fa fa-pencil" aria-hidden="true"></i>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        tabindex="-1"
                        data-act="duplicate"
                        [attr.aria-label]="t.duplicate + ': ' + p.name"
                        [title]="t.duplicate"
                      >
                        <i class="fa fa-clone" aria-hidden="true"></i>
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        tabindex="-1"
                        data-act="remove"
                        [attr.aria-label]="t.remove + ': ' + p.name"
                        [title]="t.remove"
                      >
                        <i class="fa fa-trash-o" aria-hidden="true"></i>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td class="empty" colspan="7">{{ t.noProfiles }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="help" [id]="listHelpId">{{ t.listHelp }}</p>
          @if (confirmRemove() && current(); as c) {
            <p class="notice" role="alert">{{ t.removeMessage(c.name) }}</p>
          }
        </div>
        <p class="error" role="alert">{{ error() || testError() }}</p>
        <p class="help" role="status">{{ testInfo() || info() }}</p>
        <div class="foot">
          <div class="stack">
            <button type="button" class="btn" (click)="addNew()">
              <i class="fa fa-plus" aria-hidden="true"></i> {{ t.newProfile }}
            </button>
            <button type="button" class="btn" [disabled]="!current()" (click)="duplicate()">
              <i class="fa fa-clone" aria-hidden="true"></i> {{ t.duplicate }}
            </button>
            <button
              type="button"
              class="btn"
              [class.danger]="confirmRemove()"
              [disabled]="!current() || busy()"
              (click)="remove()"
            >
              <i class="fa fa-trash-o" aria-hidden="true"></i>
              {{ confirmRemove() ? t.removeTitle + '?' : t.remove }}
            </button>
          </div>
          <div class="buttons">
            <button type="button" class="btn" [disabled]="!canUse()" (click)="favorite()">
              <i class="fa fa-star-o" aria-hidden="true"></i> {{ t.favorite }}
            </button>
            <button type="button" class="btn" [disabled]="!canUse()" (click)="test()">
              {{ t.test }}
            </button>
            <button type="button" class="btn" (click)="close()">{{ t.close }}</button>
            <button type="button" class="btn primary" [disabled]="!canUse()" (click)="connect()">
              {{ t.connect }}
            </button>
          </div>
        </div>
      </div>
    </app-modal>
    @if (form(); as f) {
      <!-- the editor: a second modal beside (not inside) the first – own focus trap and Esc -->
      <app-modal
        class="editor-modal"
        [heading]="f.id ? t.editTitle : t.newTitle"
        width="min(40rem, 94vw)"
        (closed)="cancelEdit()"
      >
        <form class="tool" (submit)="saveEdit($event)">
          <div class="body details" role="group" [attr.aria-label]="f.name">
            @if (note(); as n) {
              <p class="notice" role="status">{{ n }}</p>
            }
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
          </div>
          <p class="error" role="alert">{{ editError() }}</p>
          <div class="buttons">
            <button type="button" class="btn" (click)="cancelEdit()">{{ t.cancel }}</button>
            <button
              type="submit"
              class="btn primary"
              [disabled]="busy() || !dirty() || problem() !== null"
            >
              {{ t.save }}
            </button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrls: [
    '../../shared/dialog/tool-dialog.css',
    '../config/config-dialog.css',
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
  /** The chosen row of the table (a saved profile). */
  protected readonly selected = signal<string | null>(null);
  /** The profile in the editor: a saved one (id) or a new draft (id ''); null = editor closed. */
  protected readonly form = signal<RemoteProfile | null>(null);
  /** A hint for the draft in the editor (e.g. a password in the address was dropped). */
  protected readonly note = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly editError = signal('');
  protected readonly info = signal('');
  protected readonly busy = signal(false);
  protected readonly confirmRemove = signal(false);

  /** The saved profile of the chosen row. */
  protected readonly current = computed(() => {
    const id = this.selected();
    return id ? this.store.profile(id) : null;
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
  /** Result of "Test" for the chosen profile (survives the password/trust questions). */
  private readonly testResult = computed(() => {
    const r = this.store.testResult();
    return r && r.id === this.selected() ? r : null;
  });
  protected readonly testInfo = computed(() => {
    const r = this.testResult();
    return r?.ok ? this.t.testOk(r.info) : '';
  });
  protected readonly testError = computed(() => {
    const r = this.testResult();
    return r && !r.ok ? r.info : '';
  });
  protected readonly canUse = computed(() => this.current() !== null && !this.busy());

  constructor() {
    void this.store.init().then(() => {
      const draft = this.store.dialogDraft();
      this.store.dialogDraft.set(null);
      const want = this.store.dialogSelect() ?? this.store.profiles()[0]?.id ?? null;
      this.store.dialogSelect.set(null);
      this.select(want, true);
      if (draft) {
        this.edit(draft.profile, draft.note);
      }
    });
  }

  protected rowId(id: string): string {
    return `fnf-remote-row-${id}`;
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

  /** Chooses a row (null = none); `focus` moves the keyboard focus to it. */
  private select(id: string | null, focus = false): void {
    const known = id !== null && this.store.profile(id) ? id : null;
    if (known !== this.selected()) {
      this.confirmRemove.set(false);
      this.error.set('');
      this.info.set('');
      if (known !== this.store.testResult()?.id) {
        this.store.testResult.set(null);
      }
    }
    this.selected.set(known);
    if (known !== null) {
      setTimeout(() => {
        const row = document.getElementById(this.rowId(known));
        row?.scrollIntoView?.({ block: 'nearest' });
        if (focus) {
          row?.focus();
        }
      });
    }
  }

  /** Opens the editor with a copy of `profile`. */
  private edit(profile: RemoteProfile, note: string | null = null): void {
    this.form.set(profile);
    this.note.set(note);
    this.editError.set('');
    this.confirmRemove.set(false);
  }

  protected editRow(id: string | null = this.selected()): void {
    const p = id ? this.store.profile(id) : null;
    if (p) {
      this.select(p.id);
      this.edit(p);
    }
  }

  protected cancelEdit(): void {
    this.form.set(null);
    this.note.set(null);
    this.editError.set('');
    this.select(this.selected(), true);
  }

  patch(change: Partial<RemoteProfile>): void {
    this.form.update((f) => (f ? { ...f, ...change } : f));
    this.editError.set('');
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
    this.edit(blankProfile(this.t.newName));
  }

  protected duplicate(id: string | null = this.selected()): void {
    const p = id ? this.store.profile(id) : null;
    if (p) {
      this.select(p.id);
      this.edit(duplicateProfile(p, this.t.copyName(p.name)));
    }
  }

  /** First press asks (the button turns red), the second deletes. */
  protected async remove(id: string | null = this.selected()): Promise<void> {
    const p = id ? this.store.profile(id) : null;
    if (!p) {
      return;
    }
    if (p.id !== this.selected()) {
      this.select(p.id);
    }
    if (!this.confirmRemove()) {
      this.confirmRemove.set(true);
      return;
    }
    const rows = this.store.profiles();
    const at = rows.findIndex((r) => r.id === p.id);
    this.busy.set(true);
    try {
      await this.store.remove(p.id);
      const rest = this.store.profiles();
      this.confirmRemove.set(false);
      this.select(rest[Math.min(at, rest.length - 1)]?.id ?? null, true);
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
      this.editError.set(errorText(toFsError(err)));
    }
  }

  /** Save in the editor: stores the profile, closes the editor, chooses its row. */
  protected async saveEdit(evt?: Event): Promise<void> {
    evt?.preventDefault();
    const f = this.form();
    if (!f || this.problem() !== null || this.busy()) {
      return;
    }
    if (!this.dirty() && f.id) {
      this.cancelEdit();
      return;
    }
    this.busy.set(true);
    this.editError.set('');
    try {
      const saved = await this.store.save(f);
      this.form.set(null);
      this.note.set(null);
      this.select(saved.id, true);
      this.info.set(this.t.saved);
    } catch (err) {
      this.editError.set(errorText(toFsError(err)));
    } finally {
      this.busy.set(false);
    }
  }

  protected connect(): void {
    const p = this.current();
    if (!p || this.busy()) {
      return;
    }
    this.dialogs.close({ restoreFocus: false });
    void this.store.connect(p.id, { navigate: true });
  }

  protected async test(): Promise<void> {
    const p = this.current();
    if (!p) {
      return;
    }
    this.store.testResult.set(null);
    this.info.set(this.t.connecting(p.name));
    const id = p.id;
    await this.store.connect(id, {
      backToDialog: true,
      done: (ok, info) => this.store.testResult.set({ id, ok, info }),
    });
  }

  protected favorite(): void {
    const p = this.current();
    if (!p) {
      return;
    }
    const path = serverPath(p.id, p.startPath);
    if (!this.ws.isFavorite(path)) {
      this.ws.toggleFavorite(path);
    }
    this.info.set(this.t.favoriteAdded(p.name));
  }

  protected openAddress(evt: Event): void {
    evt.preventDefault();
    const text = this.address().trim();
    if (text) {
      void this.store.openUrl(text).then(() => {
        const draft = this.store.dialogDraft();
        this.store.dialogDraft.set(null);
        if (draft) {
          this.address.set('');
          this.edit(draft.profile, draft.note);
        }
      });
    }
  }

  protected close(): void {
    this.dialogs.close();
  }

  /** Grid rows: ↑/↓/Home/End choose, Enter connects, F2 edits, Delete removes. */
  protected onListKey(evt: KeyboardEvent): void {
    const all = this.store.profiles();
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
        this.connect();
        return;
      case 'F2':
        evt.preventDefault();
        this.editRow();
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
      this.select(id, true);
    }
  }

  protected onListClick(evt: MouseEvent): void {
    const target = evt.target as Element | null;
    const row = target?.closest?.<HTMLElement>('tr[data-id]');
    const id = row?.dataset['id'] ?? null;
    if (!id) {
      return;
    }
    const act = target?.closest?.<HTMLElement>('[data-act]')?.dataset['act'];
    if (act === 'edit') {
      this.editRow(id);
    } else if (act === 'duplicate') {
      this.duplicate(id);
    } else if (act === 'remove') {
      void this.remove(id);
    } else {
      this.select(id, true);
    }
  }

  protected onListDblClick(evt: MouseEvent): void {
    const target = evt.target as Element | null;
    if (!target?.closest?.('[data-act]') && target?.closest?.('tr[data-id]')) {
      this.connect();
    }
  }
}
