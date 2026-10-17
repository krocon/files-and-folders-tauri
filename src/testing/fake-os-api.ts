import { ClipboardApi } from '../app/core/os/clipboard';
import { OsApi } from '../app/core/os/os-api';
import { LoadedTools, ToolContext, Volume } from '../app/core/os/os.models';

/** In-memory OsApi: records every call; `fail` makes the next call reject. */
export class FakeOsApi extends OsApi {
  volumes: Volume[] = [];
  tools: LoadedTools = { tools: [], warnings: [], file: '/config/tools.json' };
  readonly reveals: string[] = [];
  readonly terminals: string[] = [];
  readonly runs: { toolId: string; context: ToolContext }[] = [];
  configOpened = 0;
  fail: { code: string; message: string; path: null } | null = null;
  /** Keeps `listVolumes` pending until `releaseVolumes()`. */
  holdVolumes = false;
  private held: (() => void)[] = [];

  private check(): void {
    const f = this.fail;
    if (f) {
      this.fail = null;
      throw f;
    }
  }

  listVolumes(): Promise<readonly Volume[]> {
    const v = this.volumes;
    if (!this.holdVolumes) {
      return Promise.resolve(v);
    }
    return new Promise((resolve) => this.held.push(() => resolve(v)));
  }

  releaseVolumes(order: 'fifo' | 'lifo' = 'fifo'): void {
    const h = order === 'fifo' ? this.held : [...this.held].reverse();
    this.held = [];
    h.forEach((f) => f());
  }

  async reveal(path: string): Promise<void> {
    this.check();
    this.reveals.push(path);
  }

  async openTerminal(dir: string): Promise<void> {
    this.check();
    this.terminals.push(dir);
  }

  async loadTools(): Promise<LoadedTools> {
    this.check();
    return this.tools;
  }

  async runTool(toolId: string, context: ToolContext): Promise<number> {
    this.check();
    this.runs.push({ toolId, context });
    return 1;
  }

  async openToolsConfig(): Promise<string> {
    this.check();
    this.configOpened++;
    return this.tools.file ?? '';
  }
}

export class FakeClipboardApi extends ClipboardApi {
  readonly written: string[] = [];
  fail = false;

  async writeText(text: string): Promise<void> {
    if (this.fail) {
      throw { code: 'io', message: 'no clipboard', path: null };
    }
    this.written.push(text);
  }
}
