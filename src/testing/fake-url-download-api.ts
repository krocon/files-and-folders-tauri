import { UrlDownloadApi } from '../app/core/urldownload/url-download-api';
import {
  DownloadCheck,
  DownloadOptions,
  DownloadTools,
  LoadedDownloadPresets,
  ToolStatus,
  UrlProblem,
} from '../app/core/urldownload/url-download.models';

export function tool(over: Partial<ToolStatus> = {}): ToolStatus {
  return {
    state: 'ok',
    version: '1.0',
    path: '/opt/bin/tool',
    name: null,
    configured: false,
    ...over,
  };
}

export const MISSING: ToolStatus = {
  state: 'missing',
  version: null,
  path: null,
  name: null,
  configured: false,
};

export function downloadTools(over: Partial<DownloadTools> = {}): DownloadTools {
  return {
    ytDlp: tool({ version: '2026.11.23', path: '/opt/homebrew/bin/yt-dlp' }),
    ffmpeg: tool({ version: '9.1', path: '/opt/homebrew/bin/ffmpeg' }),
    jsRuntime: tool({ version: '2.9.8', path: '/opt/homebrew/bin/deno', name: 'deno' }),
    ytDlpOutdated: false,
    ...over,
  };
}

/**
 * In-memory UrlDownloadApi. `check` counts like Rust for the simple cases the specs
 * use: `http(s)://` lines are valid, everything else is `scheme`/`invalid`; a template
 * with `/`, `\` or `..` is refused.
 */
export class FakeUrlDownloadApi extends UrlDownloadApi {
  toolsAnswer: DownloadTools | { error: unknown } = downloadTools();
  presetsAnswer: LoadedDownloadPresets = {
    presets: [],
    problems: [],
    warning: null,
    file: '/config/url-download.json',
  };
  toolCalls = 0;
  readonly checks: { text: string; options: DownloadOptions }[] = [];
  readonly commandLines: { url: string; options: DownloadOptions }[] = [];
  /** When set, `check` waits for this promise before answering (stale answers). */
  gate: Promise<void> | null = null;
  /** `check` rejects with this. */
  refuseCheck: unknown = null;

  async tools(): Promise<DownloadTools> {
    this.toolCalls++;
    const answer = this.toolsAnswer;
    if ('error' in answer) {
      throw answer.error;
    }
    return answer;
  }

  presets(): Promise<LoadedDownloadPresets> {
    return Promise.resolve(this.presetsAnswer);
  }

  async check(text: string, options: DownloadOptions): Promise<DownloadCheck> {
    this.checks.push({ text, options });
    const gate = this.gate;
    if (gate) {
      await gate;
    }
    if (this.refuseCheck) {
      throw this.refuseCheck;
    }
    const urls: string[] = [];
    const problems: UrlProblem[] = [];
    let duplicates = 0;
    text.split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (line === '') {
        return;
      }
      if (/^https?:\/\/[^\s/]+\S*$/.test(line)) {
        if (urls.includes(line)) {
          duplicates++;
        } else {
          urls.push(line);
        }
      } else {
        problems.push({ line: i + 1, reason: /^[a-z]+:\/\//.test(line) ? 'scheme' : 'invalid' });
      }
    });
    const t = options.template;
    const template = /[\\/]/.test(t)
      ? 'separator'
      : /:|\$|^~/.test(t)
        ? 'escape'
        : !t.endsWith('.%(ext)s')
          ? 'extension'
          : null;
    return {
      urls,
      problems,
      duplicates,
      tooMany: false,
      template,
      example: template ? '' : t.replace('%(title)s', 'My video').replace('%(ext)s', 'mp4'),
    };
  }

  commandLine(url: string, options: DownloadOptions): Promise<string> {
    this.commandLines.push({ url, options });
    return Promise.resolve(`yt-dlp -- '${url}'`);
  }
}
