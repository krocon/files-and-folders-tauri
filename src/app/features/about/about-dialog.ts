import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { AboutApi } from '../../core/about/about-api';
import { AppInfo } from '../../core/about/about.models';
import { ClipboardApi } from '../../core/os/clipboard';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { ABOUT_TEXTS } from './about-texts';

export interface AboutRow {
  readonly label: string;
  readonly value: string;
}

/** Rows of the About dialog (pure; tested). */
export function aboutRows(info: AppInfo): AboutRow[] {
  const t = ABOUT_TEXTS;
  const version =
    info.crateVersion === info.version
      ? info.version
      : `${info.version} (${t.crateMismatch(info.crateVersion)})`;
  return [
    { label: t.version, value: version },
    { label: t.build, value: info.debug ? t.buildDebug : t.buildRelease },
    { label: t.platform, value: `${t.os[info.os] ?? info.os} · ${info.arch}` },
    { label: t.tauri, value: info.tauriVersion },
    { label: t.author, value: t.authorValue },
    { label: t.source, value: t.sourceValue },
    { label: t.credits, value: t.creditsValue },
  ];
}

/** Plain text for bug reports (Copy button). */
export function aboutText(info: AppInfo): string {
  return [info.name, ...aboutRows(info).map((r) => `${r.label}: ${r.value}`)].join('\n');
}

/** About (action OPEN_ABOUT_DLG; on macOS also the native "About" item) – design 017. */
@Component({
  selector: 'app-about-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.title" width="min(30rem, 92vw)" (closed)="close()">
      <div class="head">
        <img src="app-icon.svg" alt="" width="48" height="48" data-testid="about-icon" />
        <div>
          <p class="name">{{ info()?.name ?? 'Files and Folders' }}</p>
          @if (info(); as i) {
            <p class="version" data-testid="about-version">{{ t.version }} {{ i.version }}</p>
          }
        </div>
      </div>
      @if (info(); as i) {
        <dl class="rows">
          @for (r of rows(); track r.label) {
            <dt>{{ r.label }}</dt>
            <dd>{{ r.value }}</dd>
          }
        </dl>
      } @else if (failed()) {
        <p class="hint" role="status">{{ t.noBackend }}</p>
      } @else {
        <p class="hint">{{ t.loading }}</p>
      }
      <p class="sr-only" aria-live="polite">{{ status() }}</p>
      <div class="buttons">
        @if (info()) {
          <button type="button" class="btn" (click)="copy()">{{ t.copy }}</button>
        }
        <button type="button" class="btn primary" data-autofocus (click)="close()">
          {{ t.close }}
        </button>
      </div>
    </app-modal>
  `,
  styles: `
    .head {
      display: flex;
      gap: var(--spacing-3);
      align-items: center;
      margin-bottom: var(--spacing-3);
    }
    .name {
      margin: 0;
      font-size: var(--font-size-md);
      font-weight: 600;
    }
    .version {
      margin: 0;
      color: var(--color-muted);
    }
    .rows {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--spacing-1) var(--spacing-3);
      margin: 0;
      font-size: var(--font-size-sm);
    }
    dt {
      color: var(--color-muted);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
      user-select: text;
    }
    .hint {
      color: var(--color-muted);
    }
    .buttons {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-2);
      margin-top: var(--spacing-4);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutDialog implements OnInit {
  protected readonly t = ABOUT_TEXTS;
  private readonly api = inject(AboutApi);
  private readonly clipboard = inject(ClipboardApi);
  private readonly dialogs = inject(DialogService);

  protected readonly info = signal<AppInfo | null>(null);
  protected readonly failed = signal(false);
  protected readonly status = signal('');
  protected readonly rows = computed(() => {
    const i = this.info();
    return i ? aboutRows(i) : [];
  });

  ngOnInit(): void {
    this.api.getAppInfo().then(
      (i) => this.info.set(i),
      () => this.failed.set(true),
    );
  }

  protected async copy(): Promise<void> {
    const i = this.info();
    if (!i) return;
    try {
      await this.clipboard.writeText(aboutText(i));
      this.status.set(this.t.copied);
    } catch {
      // clipboard not available – nothing to report beyond the visible text
    }
  }

  protected close(): void {
    this.dialogs.close();
  }
}
