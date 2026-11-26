import { computed, inject, Injectable, signal } from '@angular/core';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { JobInfo } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { McpGuardService } from '../../core/mcp/mcp-guard.service';
import { ClipboardApi } from '../../core/os/clipboard';
import { Side } from '../../core/session/session.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { UrlDownloadApi } from '../../core/urldownload/url-download-api';
import {
  DEFAULT_DOWNLOAD_OPTIONS,
  DownloadCheck,
  DownloadOptions,
  DownloadTools,
  LoadedDownloadPresets,
} from '../../core/urldownload/url-download.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { recallDialog, rememberDialog } from '../../shared/dialog-memory';
import { WorkspaceStore } from '../workspace/workspace.store';
import {
  appendUrls,
  applyPreset,
  clipboardUrls,
  defaultTarget,
  needsFfmpeg,
  OWN_PREFIX,
  presetValue,
  rememberedForm,
  restoreDownloadForm,
  SideView,
  subLangsOk,
  TargetChoice,
  targetChoices,
  toolLocks,
  withoutFfmpeg,
} from './url-download-logic';
import { URL_DOWNLOAD_TEXTS } from './urldownload-texts';

/** Product names of the shells – the same in every language. */
const SHELL_NAMES = { sh: 'sh', fish: 'fish', cmd: 'cmd.exe', powershell: 'PowerShell' } as const;

/**
 * "Download from URLs" (design 078): the dialog's state and the start of the job
 * `download`. The store sends URLs (as Rust's check returned them), the target folder
 * and typed options – never a program or an argument. The URL list lives only here
 * while the dialog is open and in the job; it is never written to the settings.
 */
@Injectable({ providedIn: 'root' })
export class UrlDownloadStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly dialogs = inject(DialogService);
  private readonly settings = inject(SettingsStore);
  private readonly api = inject(UrlDownloadApi);
  private readonly clipboard = inject(ClipboardApi);
  private readonly guard = inject(McpGuardService);
  private recalled = false;
  private checkSeq = 0;
  private toolsSeq = 0;

  readonly isOpen = signal(false);
  /** The side chosen as target (its active tab's folder is read when the job starts). */
  readonly side = signal<Side | null>(null);
  readonly text = signal('');
  readonly form = signal<DownloadOptions>(DEFAULT_DOWNLOAD_OPTIONS);
  /** `null` while the programs are being looked for. */
  readonly tools = signal<DownloadTools | null>(null);
  readonly toolsError = signal<string | null>(null);
  readonly presets = signal<LoadedDownloadPresets | null>(null);
  /** Rust's check of the current text and template; `null` until the first answer. */
  readonly check = signal<DownloadCheck | null>(null);
  /** An answer for the current input is still on its way. */
  readonly checking = signal(false);
  readonly busy = signal(false);
  readonly runError = signal<string | null>(null);
  /** A short note (clipboard, command copied) – a live region shows it. */
  readonly notice = signal<string | null>(null);

  /** Left and right, from the panels as they are now (navigating updates them). */
  readonly choices = computed<readonly TargetChoice[]>(() =>
    targetChoices({ left: this.view('left'), right: this.view('right') }, this.ws.activeSide()),
  );
  readonly target = computed(() => this.choices().find((c) => c.side === this.side()) ?? null);
  readonly locks = computed(() => toolLocks(this.tools()));
  readonly presetValue = computed(() => presetValue(this.form()));
  /** The chosen own preset is not in the file (any more). */
  readonly presetGone = computed(() => {
    const id = this.form().preset;
    const loaded = this.presets();
    return id !== null && loaded !== null && !loaded.presets.some((p) => p.id === id);
  });
  readonly subLangsBad = computed(() => {
    const f = this.form();
    return f.subtitles && !subLangsOk(f.subLangs.trim());
  });
  readonly canRun = computed(() => {
    const c = this.check();
    const t = this.target();
    const locks = this.locks();
    return (
      !this.busy() &&
      !this.checking() &&
      !locks.noYtDlp &&
      c !== null &&
      c.urls.length > 0 &&
      c.problems.length === 0 &&
      !c.tooMany &&
      c.template === null &&
      t !== null &&
      t.blocked === null &&
      t.path !== null &&
      !this.presetGone() &&
      !this.subLangsBad() &&
      !(locks.noFfmpeg && needsFfmpeg(this.form()))
    );
  });

  private view(side: Side): SideView | null {
    const store = this.ws.panel(side)?.store;
    if (!store) {
      return null;
    }
    return {
      path: store.path(),
      result: store.searchKey() !== null,
      archive: store.archive() !== null,
      remote: store.remote() !== null,
      tabId: this.ws.activeTab(side).id,
    };
  }

  /**
   * The MCP client whose folder (or marks) still stand on the chosen side (design 071,
   * review 078 #4): a client can navigate a panel – also the default target – into a
   * folder of its choice. The dialog says so next to the target.
   */
  readonly targetChangedBy = computed<string | null>(() => {
    const side = this.side();
    if (side === null) {
      return null;
    }
    const marks = this.ws.panel(side)?.store.marked() ?? new Set<string>();
    return this.guard.influence(side, marks);
  });

  /** At least one side shows a local folder. */
  canOpen(): boolean {
    return this.choices().some((c) => c.blocked === null);
  }

  open(): void {
    if (!this.recalled) {
      this.recalled = true;
      const kept = recallDialog(this.settings, 'urlDownload');
      if (kept !== undefined) {
        this.form.set(restoreDownloadForm(kept));
      }
    }
    // chosen anew each time (design 078 E-f)
    this.form.update((f) => ({ ...f, overwrite: false, cookiesBrowser: null }));
    this.side.set(defaultTarget(this.choices()));
    this.text.set('');
    this.check.set(null);
    this.checking.set(false);
    this.busy.set(false);
    this.runError.set(null);
    this.notice.set(null);
    this.isOpen.set(true);
    this.dialogs.show('url-download');
    void this.rescan();
    this.recheck();
  }

  close(): void {
    this.isOpen.set(false);
    // the URLs are gone with the dialog
    this.text.set('');
    this.check.set(null);
    this.checkSeq++;
    this.dialogs.close();
  }

  /** Looks for the programs and reads the own presets (again). */
  async rescan(): Promise<void> {
    const seq = ++this.toolsSeq;
    this.tools.set(null);
    this.toolsError.set(null);
    try {
      const [tools, presets] = await Promise.all([this.api.tools(), this.api.presets()]);
      if (seq !== this.toolsSeq) {
        return;
      }
      this.presets.set(presets);
      this.tools.set(tools);
      if (tools.ffmpeg.state !== 'ok') {
        this.form.update(withoutFfmpeg);
        this.recheck();
      }
    } catch (e) {
      if (seq === this.toolsSeq) {
        this.toolsError.set(errorText(toFsError(e)));
      }
    }
  }

  setSide(side: Side): void {
    if (this.choices().some((c) => c.side === side && c.blocked === null)) {
      this.side.set(side);
    }
  }

  setText(text: string): void {
    this.text.set(text);
    this.runError.set(null);
    this.recheck();
  }

  update(patch: Partial<DownloadOptions>): void {
    let next = { ...this.form(), ...patch };
    if (!next.playlist) {
      next = { ...next, playlistSubfolder: false };
    }
    if (this.tools() !== null && this.locks().noFfmpeg) {
      next = withoutFfmpeg(next);
    }
    this.form.set(next);
    this.runError.set(null);
    this.recheck();
  }

  /** The preset select: a built-in one sets the fields, an own one replaces them. */
  choosePreset(value: string): void {
    this.update(applyPreset(this.form(), value));
  }

  ownPresetValue(id: string): string {
    return `${OWN_PREFIX}${id}`;
  }

  /** Asks Rust about the text and the template; an older answer never replaces a newer one. */
  private recheck(): void {
    const seq = ++this.checkSeq;
    this.checking.set(true);
    void this.api.check(this.text(), this.form()).then(
      (c) => {
        if (seq === this.checkSeq) {
          this.check.set(c);
          this.checking.set(false);
        }
      },
      (e) => {
        if (seq === this.checkSeq) {
          this.check.set(null);
          this.checking.set(false);
          this.runError.set(errorText(toFsError(e)));
        }
      },
    );
  }

  /** The button "Paste from clipboard" – the only place the clipboard is read (E-g). */
  async paste(): Promise<void> {
    let text: string;
    try {
      text = await this.clipboard.readText();
    } catch {
      this.notice.set(URL_DOWNLOAD_TEXTS.pasteFailed);
      return;
    }
    const { text: next, added } = appendUrls(this.text(), clipboardUrls(text));
    if (added > 0) {
      this.setText(next);
    }
    this.notice.set(URL_DOWNLOAD_TEXTS.pasted(added));
  }

  /** The yt-dlp command for the first valid URL, to try it in a terminal. */
  async copyCommand(): Promise<void> {
    const url = this.check()?.urls[0];
    if (!url) {
      return;
    }
    try {
      const { line, shell } = await this.api.commandLine(url, this.form());
      await this.clipboard.writeText(line);
      this.runError.set(null);
      this.notice.set(
        URL_DOWNLOAD_TEXTS.commandCopied(
          shell === 'sh' ? URL_DOWNLOAD_TEXTS.yourShell : SHELL_NAMES[shell],
        ),
      );
    } catch (e) {
      // the shell cannot take the command safely (cmd.exe and `%`): nothing is copied
      const err = toFsError(e);
      this.notice.set(null);
      this.runError.set(
        err.code === 'unquotable_name' ? URL_DOWNLOAD_TEXTS.commandNotForShell : errorText(err),
      );
    }
  }

  async run(): Promise<void> {
    const c = this.check();
    const t = this.target();
    if (!this.canRun() || !c || !t || t.path === null) {
      return;
    }
    const form = { ...this.form(), subLangs: this.form().subLangs.trim() };
    this.busy.set(true);
    let id: string;
    try {
      id = await this.jobs.start({
        kind: 'download',
        urls: c.urls,
        targetDir: t.path,
        options: form,
      });
    } catch (e) {
      this.runError.set(errorText(toFsError(e)));
      this.busy.set(false);
      return;
    }
    // the user saw the target (with the hint, if a client chose it) and started: it is theirs
    this.guard.forget(t.side);
    // the options – never the URLs, the cookies choice or "overwrite"
    rememberDialog(this.settings, 'urlDownload', rememberedForm(form));
    this.jobs.report(URL_DOWNLOAD_TEXTS.started(c.urls.length));
    this.close();
    this.busy.set(false);
    void this.jobs.whenFinished(id).then((job) => this.afterJob(job));
  }

  private afterJob(job: JobInfo): void {
    const t = URL_DOWNLOAD_TEXTS;
    const s = job.summary;
    switch (job.state) {
      case 'failed':
        this.jobs.report(t.failed(s?.error ? errorText(s.error) : ''));
        break;
      case 'cancelled':
        this.jobs.report(t.cancelled);
        break;
      case 'doneWithErrors':
        this.jobs.report(t.doneWithErrors(s?.itemsFailed ?? 0));
        break;
      case 'done':
        this.jobs.report(t.done(s?.download?.fileCount ?? 0, s?.download?.present ?? 0));
        break;
      default:
        break;
    }
  }
}
