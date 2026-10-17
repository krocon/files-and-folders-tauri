import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Preview } from '../../core/preview/preview.models';
import {
  PREVIEW_PROVIDERS,
  PreviewContext,
  PreviewProvider,
  providerFor,
} from './preview-providers';

/** Shows a preview with the first provider that can (design 010 E7). */
@Component({
  selector: 'app-preview-content',
  imports: [NgComponentOutlet],
  template: `<ng-container
    *ngComponentOutlet="provider().component; inputs: { preview: preview(), context: context() }"
  />`,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-provider]': 'provider().id' },
})
export class PreviewContent {
  readonly preview = input.required<Preview>();
  readonly context = input.required<PreviewContext>();
  readonly providers = input<readonly PreviewProvider[]>(PREVIEW_PROVIDERS);
  protected readonly provider = computed(() => providerFor(this.preview(), this.providers()));
}
