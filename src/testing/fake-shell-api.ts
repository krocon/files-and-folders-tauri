import { ShellApi } from '../app/core/shell/shell-api';
import { ShellSupportApi } from '../app/core/shell/shell-support-api';
import { ShellRunResult } from '../app/core/shell/shell.models';

/** Records the lines; `answer` decides the result (default: a started job `s1`, `s2` …). */
export class FakeShellApi extends ShellApi {
  readonly runs: { cwd: string; command: string }[] = [];
  answer: ((cwd: string, command: string) => ShellRunResult | Promise<ShellRunResult>) | null =
    null;
  fail: unknown = null;
  private seq = 0;

  run(cwd: string, command: string): Promise<ShellRunResult> {
    this.runs.push({ cwd, command });
    if (this.fail) {
      return Promise.reject(this.fail);
    }
    if (this.answer) {
      return Promise.resolve(this.answer(cwd, command));
    }
    return Promise.resolve({ type: 'started', jobId: `s${++this.seq}`, notices: [] });
  }
}

/** Quotes like a POSIX shell for the tests (`'…'` when not plain). */
export class FakeShellSupportApi extends ShellSupportApi {
  history: string[] = [];
  readonly quoted: { items: readonly string[]; names: boolean }[] = [];
  cleared = 0;
  fail: unknown = null;

  quote(items: readonly string[], names: boolean): Promise<string> {
    this.quoted.push({ items, names });
    if (this.fail) {
      return Promise.reject(this.fail);
    }
    return Promise.resolve(
      items.map((i) => (/^[\w./-]+$/.test(i) ? i : `'${i.replace(/'/g, "'\\''")}'`)).join(' '),
    );
  }

  loadHistory(): Promise<readonly string[]> {
    return Promise.resolve([...this.history]);
  }

  clearHistory(): Promise<void> {
    this.cleared++;
    this.history = [];
    return Promise.resolve();
  }
}
