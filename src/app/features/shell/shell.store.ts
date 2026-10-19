import { computed, inject, Injectable, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { JobInfo } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { ClipboardApi } from '../../core/os/clipboard';
import { ShellSession } from '../../core/session/session.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { ShellSupportApi } from '../../core/shell/shell-support-api';
import { ShellChunk, ShellRunResult } from '../../core/shell/shell.models';
import { OsStore } from '../osintegration/os.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { OutputBuffer, remember } from './shell-logic';
import { SHELL_TEXTS } from './shell-texts';

export const OUTPUT_MIN = 60;
export const OUTPUT_MAX = 800;
/** Output that arrives before `run_shell` answered is kept for at most this many events. */
const MAX_EARLY_EVENTS = 200;

type Early = { chunks: readonly ShellChunk[]; dropped: number }[];
/** Characters of early output that did not fit into the early buffer. */
type EarlyLost = Map<string, number>;

/**
 * State of the shell bar (design 021, root): visibility and output area (in the
 * session via `WorkspaceStore.shell`), history, the running job and its output.
 * It never runs a command – only `ShellBar` calls `ShellApi.run` and hands the
 * result here.
 */
@Injectable({ providedIn: 'root' })
export class ShellStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly settings = inject(SettingsStore);
  private readonly support = inject(ShellSupportApi);
  private readonly actions = inject(ActionService);
  private readonly clipboard = inject(ClipboardApi);
  private readonly os = inject(OsStore);

  readonly enabled = computed(() => this.settings.get('shell.enabled'));
  readonly visible = computed(() => this.ws.shell().visible);
  readonly outputOpen = computed(() => this.ws.shell().outputOpen);
  readonly outputHeight = computed(() => this.ws.shell().outputHeight);
  readonly history = signal<readonly string[]>([]);
  /** Id of the running shell job. */
  readonly running = signal<string | null>(null);
  /** `run_shell` was called and has not answered yet. */
  readonly starting = signal(false);
  readonly busy = computed(() => this.running() !== null || this.starting());
  /** The field has the focus (`TOGGLE_SHELL` focuses or hides). */
  readonly fieldFocused = signal(false);
  /** Bumped to move the focus into the field. */
  readonly focusRequest = signal(0);
  /** Text to insert at the caret (`SHELL_INSERT_*`). */
  readonly insertRequest = signal<{ text: string; seq: number } | null>(null);
  /** For the live region: ends of commands. */
  readonly announcement = signal('');

  /** Working folder: the active panel's folder, or the search folder of a result tab. */
  readonly cwd = computed(() => this.ws.actionDir());
  readonly inArchive = computed(() => this.ws.panel()?.store.archive() != null);
  /** Why the field is locked, or `null`. */
  readonly locked = computed<'disabled' | 'archive' | 'noFolder' | null>(() => {
    if (!this.enabled()) {
      return 'disabled';
    }
    if (this.inArchive()) {
      return 'archive';
    }
    return this.cwd() === null ? 'noFolder' : null;
  });

  private readonly buffer = new OutputBuffer();
  private readonly version = signal(0);
  readonly segments = computed(() => {
    this.version();
    return [...this.buffer.segments];
  });
  readonly trimmed = computed(() => {
    this.version();
    return this.buffer.trimmed;
  });
  readonly hasOutput = computed(() => this.segments().length > 0);

  private early = new Map<string, Early>();
  private earlyLost: EarlyLost = new Map();
  private historyLoaded = false;
  private seq = 0;

  constructor() {
    this.jobs.onShellOutput((id, chunks, dropped) => this.receive(id, chunks, dropped));
  }

  // ---- visibility and focus ----

  /** `TOGGLE_SHELL` (design 021 E13): always toggles the visibility, wherever the focus is. */
  toggle(): void {
    if (this.visible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.patch({ visible: true });
    void this.loadHistory();
    this.focusRequest.update((n) => n + 1);
  }

  hide(): void {
    this.patch({ visible: false });
    this.fieldFocused.set(false);
    this.ws.requestFocus(this.ws.activeSide());
  }

  /** Esc in an empty field: back to the list. */
  focusList(): void {
    this.ws.requestFocus(this.ws.activeSide());
  }

  setOutputOpen(open: boolean): void {
    this.patch({ outputOpen: open });
  }

  setOutputHeight(px: number): void {
    const h = Math.round(Math.min(OUTPUT_MAX, Math.max(OUTPUT_MIN, px)));
    if (h !== this.outputHeight()) {
      this.patch({ outputHeight: h });
    }
  }

  private patch(p: Partial<ShellSession>): void {
    this.ws.shell.update((s) => ({ ...s, ...p }));
  }

  // ---- history ----

  async loadHistory(force = false): Promise<void> {
    if (this.historyLoaded && !force) {
      return;
    }
    this.historyLoaded = true;
    try {
      this.history.set(await this.support.loadHistory());
    } catch {
      // the history is a convenience
    }
  }

  async clearHistory(): Promise<void> {
    await this.support.clearHistory();
    this.history.set([]);
  }

  // ---- running (called by ShellBar) ----

  /** A line is about to run in `cwd`: prompt line, history. */
  beginRun(cwd: string, line: string): void {
    this.starting.set(true);
    this.early.clear();
    this.earlyLost.clear();
    this.history.update((h) => remember(h, line));
    this.buffer.appendLine('prompt', `${cwd}> ${line}`);
    this.bump();
    if (!this.outputOpen()) {
      this.setOutputOpen(true);
    }
  }

  /** The answer of `run_shell`. */
  apply(result: ShellRunResult): void {
    this.starting.set(false);
    switch (result.type) {
      case 'started': {
        for (const n of result.notices) {
          if (n === 'loginEnvUnavailable') {
            this.buffer.appendLine('info', SHELL_TEXTS.loginEnvUnavailable);
          }
        }
        this.running.set(result.jobId);
        for (const e of this.early.get(result.jobId) ?? []) {
          this.append(e.chunks, e.dropped);
        }
        const lost = this.earlyLost.get(result.jobId) ?? 0;
        if (lost > 0) {
          this.buffer.appendLine('info', SHELL_TEXTS.dropped(Math.max(1, Math.round(lost / 1024))));
        }
        this.early.clear();
        this.earlyLost.clear();
        this.bump();
        void this.jobs.whenFinished(result.jobId).then((job) => this.finish(job));
        break;
      }
      case 'navigate':
        this.ws.requestNavigate(this.ws.activeSide(), result.path);
        break;
      case 'back':
        void this.actions.run('NAVIGATE_BACK');
        break;
      case 'clear':
        this.clear();
        break;
    }
  }

  /** `run_shell` refused (busy, disabled, invalid line, `cd` target …). */
  fail(err: unknown): void {
    this.starting.set(false);
    this.early.clear();
    this.buffer.appendLine('error', errorText(toFsError(err)));
    this.bump();
  }

  /** Enter while a command runs: one command at a time (design 021 E3). */
  busyHint(): void {
    this.buffer.appendLine('info', SHELL_TEXTS.stillRunning);
    this.bump();
  }

  cancel(): void {
    const id = this.running();
    if (id) {
      void this.jobs.cancel(id);
    }
  }

  clear(): void {
    this.buffer.clear();
    this.bump();
  }

  async copyOutput(): Promise<void> {
    await this.clipboard.writeText(this.buffer.text());
    this.announcement.set(SHELL_TEXTS.copied);
  }

  // ---- inserting names ----

  /** `SHELL_INSERT_NAMES` / `_PATHS`: marked entries, else the cursor entry, quoted by Rust. */
  async insert(paths: boolean): Promise<void> {
    const entries = this.os.selection();
    if (entries.length === 0) {
      return;
    }
    const text = await this.support.quote(
      entries.map((e) => (paths ? e.path : e.name)),
      !paths,
    );
    if (!this.visible()) {
      this.patch({ visible: true });
      void this.loadHistory();
    }
    this.insertRequest.set({ text, seq: ++this.seq });
    this.focusRequest.update((n) => n + 1);
  }

  // ---- output ----

  private receive(id: string, chunks: readonly ShellChunk[], dropped: number): void {
    if (id === this.running()) {
      this.append(chunks, dropped);
      this.bump();
      return;
    }
    if (this.starting()) {
      const list = this.early.get(id) ?? [];
      if (list.length < MAX_EARLY_EVENTS) {
        list.push({ chunks, dropped });
      } else {
        const size = chunks.reduce((n, c) => n + c.text.length, 0) + dropped;
        this.earlyLost.set(id, (this.earlyLost.get(id) ?? 0) + size);
      }
      this.early.set(id, list);
    }
  }

  private append(chunks: readonly ShellChunk[], dropped: number): void {
    if (dropped > 0) {
      this.buffer.appendLine('info', SHELL_TEXTS.dropped(Math.max(1, Math.round(dropped / 1024))));
    }
    for (const c of chunks) {
      this.buffer.append(c.stream, c.text);
    }
  }

  private finish(job: JobInfo): void {
    if (this.running() !== job.id) {
      return;
    }
    this.running.set(null);
    const s = job.summary;
    const shell = s?.shell ?? null;
    if (job.state === 'cancelled') {
      this.buffer.appendLine('info', SHELL_TEXTS.cancelled);
      this.announcement.set(SHELL_TEXTS.cancelled);
    } else if (s?.error) {
      this.buffer.appendLine('error', errorText(s.error));
      this.announcement.set(errorText(s.error));
    } else {
      if (shell?.signal != null) {
        this.buffer.appendLine('info', SHELL_TEXTS.signal(shell.signal));
      } else if (shell?.exitCode != null && shell.exitCode !== 0) {
        this.buffer.appendLine('info', SHELL_TEXTS.exitCode(shell.exitCode));
      }
      this.announcement.set(SHELL_TEXTS.finished(shell?.exitCode ?? null));
    }
    this.bump();
  }

  private bump(): void {
    this.version.update((v) => v + 1);
  }
}
