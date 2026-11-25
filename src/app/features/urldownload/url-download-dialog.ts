import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { detectPlatform } from '../../core/actions/platform';
import { formatShortcut } from '../../core/actions/shortcut';
import { Side } from '../../core/session/session.models';
import {
  DOWNLOAD_AUDIO_FORMATS,
  DOWNLOAD_BROWSERS,
  DOWNLOAD_CONTAINERS,
  DOWNLOAD_HEIGHTS,
  DownloadAudioFormat,
  DownloadBrowser,
  DownloadContainer,
  ToolStatus,
} from '../../core/urldownload/url-download.models';
import { DialogKey } from '../../shared/dialog/dialog-key';
import { Modal } from '../../shared/dialog/modal';
import {
  BUILTIN_PRESETS,
  CUSTOM_PRESET,
  DOWNLOAD_TEMPLATES,
  shortenMiddle,
  TargetChoice,
} from './url-download-logic';
import { UrlDownloadStore } from './url-download.store';
import { URL_DOWNLOAD_TEXTS } from './urldownload-texts';

/** Product names – the same in every language. */
const BROWSER_NAMES: Readonly<Record<DownloadBrowser, string>> = {
  brave: 'Brave',
  chrome: 'Chrome',
  chromium: 'Chromium',
  edge: 'Edge',
  firefox: 'Firefox',
  opera: 'Opera',
  safari: 'Safari',
  vivaldi: 'Vivaldi',
};

/** How to get yt-dlp – shown as text to copy, nothing is run or opened from here. */
const INSTALL = {
  mac: 'brew install yt-dlp ffmpeg deno',
  windows: 'winget install yt-dlp.yt-dlp Gyan.FFmpeg DenoLand.Deno',
  linux: 'pipx install yt-dlp',
  page: 'https://github.com/yt-dlp/yt-dlp#installation',
};

const MAX_SHOWN_PROBLEMS = 3;

/**
 * Download from URLs (OPEN_URL_DOWNLOAD_DLG, design 078): target (left or right), URLs,
 * preset and output options. Everything yt-dlp or a web page could have written reaches
 * the page as text only (interpolation) – there is no `innerHTML` here.
 */
@Component({
  selector: 'app-url-download-dialog',
  imports: [Modal, DialogKey],
  template: `
    @if (s.isOpen()) {
      <app-modal [heading]="t.title" [compact]="true" width="min(58rem, 96vw)" (closed)="s.close()">
        <form class="tool" (submit)="$event.preventDefault(); s.run()">
          <!-- the fields scroll in a small window; the buttons stay in view -->
          <div class="scroll">
            @if (s.toolsError(); as e) {
              <p class="error" role="alert">{{ e }}</p>
            }
            @if (s.tools() === null && !s.toolsError()) {
              <p class="help" role="status">{{ t.searching }}</p>
            } @else if (s.locks().noYtDlp) {
              <section class="missing" [attr.aria-label]="t.missingTitle">
                <h3 class="missing-title">{{ t.missingTitle }}</h3>
                @if (missingDetail(); as d) {
                  <p class="error">{{ d }}</p>
                }
                <p>{{ t.missingIntro }}</p>
                <dl class="install">
                  <dt>{{ t.installMac }}</dt>
                  <dd>
                    <code>{{ install.mac }}</code>
                  </dd>
                  <dt>{{ t.installWindows }}</dt>
                  <dd>
                    <code>{{ install.windows }}</code>
                  </dd>
                  <dt>{{ t.installLinux }}</dt>
                  <dd>
                    <code>{{ install.linux }}</code>
                  </dd>
                  <dt>{{ t.projectPage }}</dt>
                  <dd>
                    <code>{{ install.page }}</code>
                  </dd>
                </dl>
                <p class="help">{{ t.missingSetting }}</p>
              </section>
            } @else {
              <label class="field">
                <span>{{ t.target }}</span>
                <select
                  class="target"
                  [attr.title]="s.target()?.path ?? null"
                  [attr.aria-describedby]="ids.targetPath"
                  (change)="setSide($event)"
                >
                  @for (c of s.choices(); track c.side) {
                    <option
                      [value]="c.side"
                      [selected]="c.side === s.side()"
                      [disabled]="c.blocked !== null"
                    >
                      {{ targetLabel(c) }}
                    </option>
                  }
                </select>
              </label>
              <p class="help path" [id]="ids.targetPath">{{ s.target()?.path ?? t.noTarget }}</p>
              @if (s.targetChangedBy(); as client) {
                <p class="warning mcp-hint" role="alert">{{ t.targetByMcp(client) }}</p>
              }

              <div class="urls-head">
                <label [attr.for]="ids.urls">{{ t.urls }}</label>
                <button appDialogKey="secondary:P" type="button" class="btn" (click)="s.paste()">
                  {{ t.paste }}
                </button>
              </div>
              <textarea
                class="urls"
                data-autofocus
                rows="4"
                spellcheck="false"
                autocomplete="off"
                autocapitalize="off"
                [id]="ids.urls"
                [attr.aria-describedby]="ids.count + ' ' + ids.startHint"
                [value]="s.text()"
                (input)="s.setText($any($event.target).value)"
                (keydown)="onUrlKey($event)"
              ></textarea>
              <div class="count-row">
                <p class="count" role="status" aria-live="polite" [id]="ids.count">
                  {{ countLine() }}
                </p>
                <p class="help" [id]="ids.startHint">{{ t.startHint(startKey) }}</p>
              </div>

              <div class="row format">
                <label class="field">
                  <span>{{ t.preset }}</span>
                  <select (change)="s.choosePreset($any($event.target).value)">
                    @for (p of builtin; track p.id) {
                      <option [value]="p.id" [selected]="s.presetValue() === p.id">
                        {{ t.presets[p.id] }}
                      </option>
                    }
                    @for (p of s.presets()?.presets ?? []; track p.id) {
                      <option
                        [value]="s.ownPresetValue(p.id)"
                        [selected]="s.presetValue() === s.ownPresetValue(p.id)"
                      >
                        {{ t.ownPreset(p.label) }}
                      </option>
                    }
                    @if (s.presetValue() === custom) {
                      <option [value]="custom" selected>{{ t.presetCustom }}</option>
                    }
                  </select>
                </label>
                <fieldset class="group" role="radiogroup" [attr.aria-label]="t.content">
                  <span class="group-label">{{ t.content }}</span>
                  <label class="check">
                    <input
                      type="radio"
                      name="fnf-dl-content"
                      [checked]="f().content === 'video'"
                      [disabled]="own()"
                      (change)="s.update({ content: 'video' })"
                    />
                    {{ t.video }}
                  </label>
                  <label class="check" [attr.title]="s.locks().noFfmpeg ? t.needsFfmpeg : null">
                    <input
                      type="radio"
                      name="fnf-dl-content"
                      [checked]="f().content === 'audio'"
                      [disabled]="own() || s.locks().noFfmpeg"
                      (change)="s.update({ content: 'audio' })"
                    />
                    {{ t.audioOnly }}
                  </label>
                </fieldset>
                <label class="field">
                  <span>{{ t.maxHeight }}</span>
                  <select
                    [disabled]="own() || f().content !== 'video'"
                    (change)="setHeight($event)"
                  >
                    <option value="" [selected]="f().maxHeight === null">{{ t.anyHeight }}</option>
                    @for (h of heights; track h) {
                      <option [value]="h" [selected]="f().maxHeight === h">
                        {{ t.height(h) }}
                      </option>
                    }
                  </select>
                </label>
                <label class="field" [attr.title]="s.locks().noFfmpeg ? t.needsFfmpeg : null">
                  <span>{{ t.container }}</span>
                  <select
                    [disabled]="own() || f().content !== 'video' || s.locks().noFfmpeg"
                    (change)="setContainer($event)"
                  >
                    @for (c of containers; track c) {
                      <option [value]="c" [selected]="f().container === c">
                        {{
                          c === 'auto' ? t.containerAuto : c === 'mp4' ? t.containerPrefer(c) : c
                        }}
                      </option>
                    }
                  </select>
                </label>
                <label class="field">
                  <span>{{ t.audio }}</span>
                  <select [disabled]="own() || f().content !== 'audio'" (change)="setAudio($event)">
                    @for (a of audioFormats; track a) {
                      <option [value]="a" [selected]="f().audioFormat === a">
                        {{ a === 'best' ? t.audioBest : a }}
                      </option>
                    }
                  </select>
                </label>
              </div>
              @if (own()) {
                <p class="help">{{ s.presetGone() ? t.presetGone : t.ownPresetNote }}</p>
              }

              <div class="row">
                <label class="field grow">
                  <span>{{ t.template }}</span>
                  <input
                    type="text"
                    spellcheck="false"
                    autocomplete="off"
                    maxlength="200"
                    [attr.list]="ids.templates"
                    [attr.aria-describedby]="ids.example"
                    [attr.aria-invalid]="templateProblem() ? 'true' : null"
                    [value]="f().template"
                    (input)="s.update({ template: $any($event.target).value })"
                  />
                  <datalist [id]="ids.templates">
                    @for (tpl of templates; track tpl) {
                      <option [value]="tpl"></option>
                    }
                  </datalist>
                </label>
              </div>
              <p class="example" [id]="ids.example" [class.error]="templateProblem() !== null">
                {{ templateProblem() ?? exampleText() }}
              </p>
              <details class="more">
                <summary>{{ t.templateFields }}</summary>
                <p class="help">{{ t.templateHelp }}</p>
              </details>

              <div class="row options">
                <fieldset class="group" role="radiogroup" [attr.aria-label]="t.playlist">
                  <span class="group-label">{{ t.playlist }}</span>
                  <label class="check">
                    <input
                      type="radio"
                      name="fnf-dl-playlist"
                      [checked]="!f().playlist"
                      (change)="s.update({ playlist: false })"
                    />
                    {{ t.playlistNo }}
                  </label>
                  <label class="check">
                    <input
                      type="radio"
                      name="fnf-dl-playlist"
                      [checked]="f().playlist"
                      (change)="s.update({ playlist: true })"
                    />
                    {{ t.playlistYes }}
                  </label>
                  <label class="check">
                    <input
                      type="checkbox"
                      [checked]="f().playlistSubfolder"
                      [disabled]="!f().playlist"
                      (change)="s.update({ playlistSubfolder: $any($event.target).checked })"
                    />
                    {{ t.playlistSubfolder }}
                  </label>
                </fieldset>
              </div>

              <div class="row options">
                <fieldset class="group" [attr.aria-label]="t.extras">
                  <span class="group-label">{{ t.extras }}</span>
                  <label class="check">
                    <input
                      type="checkbox"
                      [checked]="f().subtitles"
                      (change)="s.update({ subtitles: $any($event.target).checked })"
                    />
                    {{ t.subtitles }}
                  </label>
                  <input
                    class="langs"
                    type="text"
                    spellcheck="false"
                    autocomplete="off"
                    maxlength="100"
                    [attr.aria-label]="t.subLangs"
                    [attr.aria-invalid]="s.subLangsBad() ? 'true' : null"
                    [attr.title]="s.subLangsBad() ? t.subLangsBad : null"
                    [disabled]="!f().subtitles"
                    [value]="f().subLangs"
                    (input)="s.update({ subLangs: $any($event.target).value })"
                  />
                  <label class="check" [attr.title]="s.locks().noFfmpeg ? t.needsFfmpeg : null">
                    <input
                      type="checkbox"
                      [checked]="f().embedThumbnail"
                      [disabled]="s.locks().noFfmpeg"
                      (change)="s.update({ embedThumbnail: $any($event.target).checked })"
                    />
                    {{ t.embedThumbnail }}
                  </label>
                  <label class="check" [attr.title]="s.locks().noFfmpeg ? t.needsFfmpeg : null">
                    <input
                      type="checkbox"
                      [checked]="f().embedMetadata"
                      [disabled]="s.locks().noFfmpeg"
                      (change)="s.update({ embedMetadata: $any($event.target).checked })"
                    />
                    {{ t.embedMetadata }}
                  </label>
                  <label class="check">
                    <input
                      type="checkbox"
                      [checked]="f().overwrite"
                      (change)="s.update({ overwrite: $any($event.target).checked })"
                    />
                    {{ t.overwrite }}
                  </label>
                </fieldset>
              </div>
              @if (s.subLangsBad()) {
                <p class="error">{{ t.subLangsBad }}</p>
              }

              <div class="row options">
                <label class="inline">
                  <span class="group-label">{{ t.login }}</span>
                  <span>{{ t.cookies }}</span>
                  <select (change)="setBrowser($event)">
                    <option value="" [selected]="f().cookiesBrowser === null">
                      {{ t.cookiesNone }}
                    </option>
                    @for (b of browsers; track b) {
                      <option [value]="b" [selected]="f().cookiesBrowser === b">
                        {{ browserNames[b] }}
                      </option>
                    }
                  </select>
                </label>
              </div>
              @if (f().cookiesBrowser !== null) {
                <p class="help">{{ t.cookiesHint }}</p>
              }

              <div class="status-row">
                <p class="status">{{ statusLine() }}</p>
                <button
                  appDialogKey="secondary:K"
                  type="button"
                  class="btn"
                  [disabled]="!(s.check()?.urls?.length && s.check()?.template === null)"
                  (click)="s.copyCommand()"
                >
                  {{ t.copyCommand }}
                </button>
              </div>
              @for (w of warnings(); track w) {
                <p class="warning">{{ w }}</p>
              }
              @if (presetProblems().length > 0) {
                <div class="warning">
                  <p>{{ t.presetProblems(presetProblems().length, presetFile()) }}</p>
                  <ul>
                    @for (p of presetProblems(); track $index) {
                      <li>{{ p }}</li>
                    }
                  </ul>
                </div>
              }
              <p class="help">{{ t.rights }}</p>
            }
          </div>
          <div class="foot">
            <div class="messages">
              <p class="error" role="alert">{{ s.runError() ?? '' }}</p>
              <p class="help" role="status" aria-live="polite">{{ s.notice() ?? '' }}</p>
            </div>
            <div class="buttons">
              @if (s.tools() !== null || s.toolsError()) {
                <button appDialogKey="secondary:R" type="button" class="btn" (click)="s.rescan()">
                  {{ t.rescan }}
                </button>
              }
              <button appDialogKey="cancel" type="button" class="btn" (click)="s.close()">
                {{ t.cancel }}
              </button>
              <button
                appDialogKey="primary"
                type="submit"
                class="btn primary"
                [disabled]="!s.canRun()"
              >
                {{ t.start }}
              </button>
            </div>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrls: ['../../shared/dialog/tool-dialog.css', './url-download-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UrlDownloadDialog {
  protected readonly t = URL_DOWNLOAD_TEXTS;
  protected readonly s = inject(UrlDownloadStore);
  protected readonly f = this.s.form;
  protected readonly builtin = BUILTIN_PRESETS;
  protected readonly custom = CUSTOM_PRESET;
  protected readonly heights = DOWNLOAD_HEIGHTS;
  protected readonly containers = DOWNLOAD_CONTAINERS;
  protected readonly audioFormats = DOWNLOAD_AUDIO_FORMATS;
  protected readonly browsers = DOWNLOAD_BROWSERS;
  protected readonly browserNames = BROWSER_NAMES;
  protected readonly templates = DOWNLOAD_TEMPLATES;
  protected readonly install = INSTALL;
  private readonly platform = detectPlatform();
  /** `⌘↩` / `Ctrl+Enter`: starts from the URL field, where Enter is a line break. */
  protected readonly startKey = formatShortcut('Mod+Enter', this.platform);
  protected readonly ids = {
    urls: 'fnf-dl-urls',
    count: 'fnf-dl-count',
    startHint: 'fnf-dl-start-hint',
    targetPath: 'fnf-dl-target-path',
    templates: 'fnf-dl-templates',
    example: 'fnf-dl-example',
  };

  /** An own preset replaces the content group. */
  protected readonly own = computed(() => this.f().preset !== null);

  protected readonly countLine = computed(() => {
    const t = this.t;
    const c = this.s.check();
    if (!c) {
      return '';
    }
    const parts = [t.count(c.urls.length)];
    if (c.problems.length > 0) {
      const shown = c.problems
        .slice(0, MAX_SHOWN_PROBLEMS)
        .map((p) => t.line(p.line, t.urlReason[p.reason]));
      const more = c.problems.length - shown.length;
      if (more > 0) {
        shown.push(t.moreLines(more));
      }
      parts.push(`${t.invalid(c.problems.length)} (${shown.join('; ')})`);
    } else {
      parts.push(t.invalid(0));
    }
    if (c.duplicates > 0) {
      parts.push(t.duplicates(c.duplicates));
    }
    if (c.tooMany) {
      parts.push(t.tooMany(c.urls.length));
    }
    return parts.join(' · ');
  });

  protected readonly templateProblem = computed(() => {
    const reason = this.s.check()?.template ?? null;
    return reason === null ? null : this.t.templateReason[reason];
  });

  protected readonly exampleText = computed(() => {
    const example = this.s.check()?.example ?? '';
    return example ? this.t.example(example) : '';
  });

  protected readonly statusLine = computed(() => {
    const tools = this.s.tools();
    if (!tools) {
      return '';
    }
    return [
      this.toolText('yt-dlp', tools.ytDlp),
      this.toolText('ffmpeg', tools.ffmpeg),
      this.toolText(tools.jsRuntime.name ?? this.t.jsRuntime, tools.jsRuntime),
    ].join(' · ');
  });

  protected readonly warnings = computed(() => {
    const t = this.t;
    const tools = this.s.tools();
    if (!tools) {
      return [];
    }
    const out: string[] = [];
    if (tools.ytDlpOutdated && tools.ytDlp.version) {
      out.push(t.outdated(tools.ytDlp.version));
    }
    if (tools.ffmpeg.state !== 'ok') {
      out.push(t.noFfmpeg);
    }
    if (tools.jsRuntime.state === 'tooOld') {
      out.push(t.jsTooOld(tools.jsRuntime.name ?? '', tools.jsRuntime.version ?? ''));
    } else if (tools.jsRuntime.state !== 'ok') {
      out.push(t.noJsRuntime);
    }
    if (this.s.presets()?.warning) {
      out.push(t.presetFileBroken);
    }
    return out;
  });

  protected readonly presetProblems = computed(() =>
    (this.s.presets()?.problems ?? []).map((p) =>
      this.t.presetReason(p.id, this.t.presetReasons[p.reason] ?? p.reason, p.option ?? ''),
    ),
  );

  protected readonly presetFile = computed(() => this.s.presets()?.file ?? '');

  /** Why yt-dlp counts as missing, when it is more than "not installed". */
  protected readonly missingDetail = computed(() => {
    const y = this.s.tools()?.ytDlp;
    if (!y) {
      return null;
    }
    if (y.state === 'failed' && y.path) {
      return this.t.missingFailed(y.path);
    }
    return y.state === 'missing' && y.configured ? this.t.missingConfigured : null;
  });

  private toolText(name: string, tool: ToolStatus): string {
    return this.t.tool(name, tool.version ?? '', this.t.toolState[tool.state]);
  }

  protected targetLabel(c: TargetChoice): string {
    const side = c.side === 'left' ? this.t.left : this.t.right;
    const label =
      c.blocked !== null || c.path === null
        ? this.t.targetBlocked(side, this.t.blocked[c.blocked ?? 'noFolder'])
        : this.t.targetEntry(side, shortenMiddle(c.path));
    return c.active ? `${label} (${this.t.activePanel})` : label;
  }

  protected setSide(evt: Event): void {
    this.s.setSide((evt.target as HTMLSelectElement).value as Side);
  }

  protected setHeight(evt: Event): void {
    const v = (evt.target as HTMLSelectElement).value;
    this.s.update({ maxHeight: v === '' ? null : Number(v) });
  }

  protected setContainer(evt: Event): void {
    this.s.update({ container: (evt.target as HTMLSelectElement).value as DownloadContainer });
  }

  protected setAudio(evt: Event): void {
    this.s.update({ audioFormat: (evt.target as HTMLSelectElement).value as DownloadAudioFormat });
  }

  protected setBrowser(evt: Event): void {
    const v = (evt.target as HTMLSelectElement).value;
    this.s.update({ cookiesBrowser: v === '' ? null : (v as DownloadBrowser) });
  }

  /** In the URL field Enter is a line break; `Mod+Enter` starts (design 078, 057 E2). */
  protected onUrlKey(evt: KeyboardEvent): void {
    const mod = this.platform === 'macos' ? evt.metaKey : evt.ctrlKey;
    if (evt.key === 'Enter' && mod && !evt.altKey && !evt.shiftKey && !evt.isComposing) {
      evt.preventDefault();
      if (!evt.repeat) {
        void this.s.run();
      }
    }
  }
}
