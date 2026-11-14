import { inject, Injectable, signal } from '@angular/core';
import { toFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { UpdateApi } from '../../core/update/update-api';
import { UpdateInfo } from '../../core/update/update.models';

/** What the update dialog shows (design 075 E9). */
export type UpdateView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'done'; readonly info: UpdateInfo }
  | { readonly kind: 'error'; readonly error: FsError };

/** Automatic checks: at most one per day (E8). */
export const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** First look after the start, so the start stays quiet. */
export const AUTO_FIRST_DELAY_MS = 30 * 1000;
/** How often the timer looks whether a check is due (a computer may sleep for days). */
export const AUTO_TICK_MS = 60 * 60 * 1000;

/** True if the automatic check should ask GitHub now. */
export function autoCheckDue(lastCheck: number | undefined, now: number): boolean {
  // a clock set back (lastCheck in the future) counts as due
  return lastCheck === undefined || now - lastCheck >= AUTO_INTERVAL_MS || lastCheck > now;
}

/**
 * Update check (root store, design 075): the manual check behind the dialog, the
 * optional daily check in the background and its hint. Only Rust talks to GitHub.
 */
@Injectable({ providedIn: 'root' })
export class UpdateStore {
  private readonly api = inject(UpdateApi);
  private readonly settings = inject(SettingsStore);

  readonly view = signal<UpdateView>({ kind: 'idle' });
  /** A newer version found by the automatic check, until dismissed (E9). */
  readonly hint = signal<UpdateInfo | null>(null);
  /** The version the user skips (`update-check.json`). */
  readonly skipped = signal<string | null>(null);

  private seq = 0;
  private autoRunning = false;

  /** Manual check (dialog). A later call or `cancel` makes an older answer stale. */
  async check(): Promise<void> {
    const seq = ++this.seq;
    this.view.set({ kind: 'checking' });
    try {
      const info = await this.api.check();
      if (seq !== this.seq) return;
      this.view.set({ kind: 'done', info });
      // the dialog shows it now – the hint has done its job
      this.hint.set(null);
    } catch (err) {
      if (seq !== this.seq) return;
      this.view.set({ kind: 'error', error: toFsError(err) });
    }
  }

  /** The dialog closes: a running check is answered into the void. */
  cancel(): void {
    this.seq++;
    if (this.view().kind === 'checking') {
      this.view.set({ kind: 'idle' });
    }
  }

  /** Shows the hint's result in the dialog without asking GitHub again. */
  showHint(): UpdateInfo | null {
    const info = this.hint();
    if (info) {
      this.seq++;
      this.view.set({ kind: 'done', info });
      this.hint.set(null);
    }
    return info;
  }

  dismissHint(): void {
    this.hint.set(null);
  }

  async openReleasePage(): Promise<void> {
    const v = this.view();
    const url = v.kind === 'done' ? v.info.releaseUrl : null;
    try {
      await this.api.openReleasePage(url);
    } catch (err) {
      this.view.set({ kind: 'error', error: toFsError(err) });
    }
  }

  /** Skips (or with `null` no longer skips) a version; the hint for it goes. */
  async skip(version: string | null): Promise<void> {
    try {
      await this.api.skip(version);
      this.skipped.set(version);
      if (version !== null && this.hint()?.latest === version) {
        this.hint.set(null);
      }
    } catch {
      // not remembered – the hint may come back tomorrow, nothing else breaks
    }
  }

  /** Reads the skipped version (dialog needs it before a check). */
  async loadState(): Promise<void> {
    try {
      const s = await this.api.loadState();
      this.skipped.set(s.skipped ?? null);
    } catch {
      // no backend: nothing skipped
    }
  }

  /**
   * Starts the background schedule (E8): 30 s after the start and then hourly it looks
   * whether the setting is on and a day has passed. Returns the cleanup.
   */
  startAuto(): () => void {
    const tick = () => void this.autoCheck();
    let interval: ReturnType<typeof setInterval> | null = null;
    const first = setTimeout(() => {
      tick();
      interval = setInterval(tick, AUTO_TICK_MS);
    }, AUTO_FIRST_DELAY_MS);
    return () => {
      clearTimeout(first);
      if (interval !== null) clearInterval(interval);
    };
  }

  /** One automatic attempt: silent on errors, only a hint on a newer, not skipped version. */
  async autoCheck(now = Date.now()): Promise<void> {
    if (
      this.autoRunning ||
      !this.settings.loaded() ||
      !this.settings.get('general.checkForUpdates')
    ) {
      return;
    }
    this.autoRunning = true;
    try {
      const state = await this.api.loadState();
      this.skipped.set(state.skipped ?? null);
      if (!autoCheckDue(state.lastCheck, now)) return;
      const info = await this.api.check();
      if (info.newer && info.latest !== this.skipped() && this.view().kind !== 'checking') {
        this.hint.set(info);
      }
    } catch {
      // automatic checks stay silent (E8)
    } finally {
      this.autoRunning = false;
    }
  }
}
