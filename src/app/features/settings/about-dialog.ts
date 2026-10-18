import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { SETTINGS_TEXTS } from './settings-texts';
import pkg from '../../../../package.json';

/** About… (design 015 E7): name, version, the components it is built on. */
@Component({
  selector: 'app-about-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.aboutTitle" width="28rem" (closed)="dialogs.close()">
      <div class="about">
        <p class="name">Files and Folders</p>
        <p>{{ t.version(version) }}</p>
        <p>{{ t.aboutText }}</p>
        <p class="muted">{{ t.aboutStack }}</p>
        <p class="muted">{{ t.aboutTable }}</p>
        <p class="muted">© {{ t.aboutAuthor }}</p>
        <div class="buttons">
          <button type="button" class="btn primary" data-autofocus (click)="dialogs.close()">
            {{ t.close }}
          </button>
        </div>
      </div>
    </app-modal>
  `,
  styles: `
    .about {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }
    p {
      margin: 0;
    }
    .name {
      font-size: var(--font-size-md);
      font-weight: 600;
    }
    .muted {
      color: var(--color-muted);
      font-size: var(--font-size-sm);
    }
    .buttons {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--spacing-2);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutDialog {
  protected readonly t = SETTINGS_TEXTS;
  protected readonly dialogs = inject(DialogService);
  protected readonly version: string = pkg.version;
}
