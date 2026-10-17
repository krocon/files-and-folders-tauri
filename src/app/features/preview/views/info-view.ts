import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Preview } from '../../../core/preview/preview.models';
import type { PreviewContext } from '../preview-providers';
import { PV_TEXTS } from '../preview-texts';

/** Folders and special files: a short note instead of content. */
@Component({
  selector: 'app-info-view',
  template: `<p class="info">{{ text() }}</p>`,
  styles: `
    .info {
      margin: 1rem;
      color: var(--color-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InfoView {
  readonly preview = input.required<Preview>();
  readonly context = input.required<PreviewContext>();
  protected readonly text = computed(() =>
    this.preview().kind === 'directory'
      ? this.context().compact
        ? PV_TEXTS.folder
        : PV_TEXTS.noFolder
      : PV_TEXTS.other,
  );
}
