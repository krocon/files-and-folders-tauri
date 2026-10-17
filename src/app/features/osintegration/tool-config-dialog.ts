import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { toFsError } from '../../core/fs/fs-error';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { OS_TEXTS } from './os-texts';
import { OsStore, TOOL_PREFIX } from './os.store';

/**
 * Tool configuration (design 011 E3): shows the effective tools, problems and the
 * file; the file is edited with the default app (an editor in the app comes with 015).
 */
@Component({
  selector: 'app-tool-config-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.configTitle" width="40rem" (closed)="dialogs.close()">
      <p class="intro">{{ t.configIntro }}</p>
      <p class="file">
        <span class="lbl">{{ t.configFile }}: </span>
        <code>{{ os.file() ?? t.configNoFile }}</code>
      </p>
      @if (problems().length) {
        <div class="warn" role="alert">
          <strong>{{ t.warnings }}</strong>
          <ul>
            @for (w of problems(); track $index) {
              <li>{{ w }}</li>
            }
          </ul>
        </div>
      }
      <table class="tools">
        <caption class="sr-only">
          {{
            t.toolsHeading
          }}
        </caption>
        <tbody>
          @for (tool of os.tools(); track tool.id) {
            <tr>
              <th scope="row">{{ tool.label }}</th>
              <td>
                <code>{{ tool.program }}</code>
              </td>
              <td>
                {{
                  tool.needsFiles
                    ? tool.perFile
                      ? t.perFile(tool.fileLimit)
                      : t.allFiles(tool.fileLimit)
                    : t.noFiles
                }}
              </td>
              <td>
                @if (actions.extraShortcutLabel(prefix + tool.id); as k) {
                  <kbd>{{ k }}</kbd>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      <p class="sr-only" aria-live="polite">{{ os.status() }}</p>
      <div class="buttons">
        <button type="button" class="btn" (click)="openFile()">{{ t.openFile }}</button>
        <button type="button" class="btn" (click)="reload()">{{ t.reload }}</button>
        <button type="button" class="btn primary" data-autofocus (click)="dialogs.close()">
          {{ t.close }}
        </button>
      </div>
    </app-modal>
  `,
  styles: `
    .intro,
    .file {
      margin: 0;
      font-size: var(--font-size-sm);
    }
    .file code,
    td code {
      font-family: var(--font-mono);
      word-break: break-all;
    }
    .lbl {
      color: var(--color-muted);
    }
    .warn,
    .error {
      margin: 0;
      color: var(--color-danger);
      font-size: var(--font-size-sm);
    }
    .warn ul {
      margin: var(--spacing-1) 0 0;
      padding-left: 1.2em;
    }
    .tools {
      border-collapse: collapse;
      font-size: var(--font-size-sm);
      width: 100%;
    }
    .tools th {
      text-align: left;
      font-weight: 600;
    }
    .tools th,
    .tools td {
      padding: 2px var(--spacing-2) 2px 0;
      vertical-align: top;
    }
    .buttons {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-2);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    .primary {
      color: var(--color-button-primary-text);
      background: var(--color-button-primary-bg);
      border-color: var(--color-button-primary-bg);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolConfigDialog {
  protected readonly os = inject(OsStore);
  protected readonly actions = inject(ActionService);
  protected readonly dialogs = inject(DialogService);
  protected readonly t = OS_TEXTS;
  protected readonly prefix = TOOL_PREFIX;
  protected readonly error = signal('');
  protected readonly problems = () => [...this.os.warnings(), ...this.actions.extraProblems()];

  protected async openFile(): Promise<void> {
    this.error.set('');
    try {
      await this.os.openConfigFile();
    } catch (e) {
      this.error.set(toFsError(e).message);
    }
  }

  protected async reload(): Promise<void> {
    this.error.set('');
    await this.os.reload();
  }
}
