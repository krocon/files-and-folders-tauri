import { UpdateApi } from '../app/core/update/update-api';
import { UpdateInfo, UpdateState } from '../app/core/update/update.models';

export function updateInfo(over: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    current: '1.4.0',
    latest: '1.5.0',
    newer: true,
    releaseUrl: 'https://github.com/krocon/files-and-folders-tauri/releases/tag/v1.5.0',
    name: 'Files and Folders 1.5.0',
    publishedAt: '2026-11-20T10:00:00Z',
    notes: '- Check for updates',
    notesTruncated: false,
    checkedAt: 0,
    ...over,
  };
}

/** In-memory UpdateApi: `answer` is what `check` resolves (or an error to reject with). */
export class FakeUpdateApi extends UpdateApi {
  answer: UpdateInfo | { error: unknown } = updateInfo();
  state: UpdateState = {};
  checks = 0;
  readonly opened: (string | null)[] = [];
  /** When set, `check` waits for this promise before answering. */
  gate: Promise<void> | null = null;

  async check(): Promise<UpdateInfo> {
    this.checks++;
    this.state = { ...this.state, lastCheck: Date.now() };
    const answer = this.answer;
    if (this.gate) {
      await this.gate;
    }
    if ('error' in answer) {
      throw answer.error;
    }
    return answer;
  }

  loadState(): Promise<UpdateState> {
    return Promise.resolve({ ...this.state });
  }

  skip(version: string | null): Promise<void> {
    this.state = { ...this.state, skipped: version ?? undefined };
    return Promise.resolve();
  }

  openReleasePage(url: string | null): Promise<void> {
    this.opened.push(url);
    return Promise.resolve();
  }
}
