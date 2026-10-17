import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { PreviewApi } from '../../../core/preview/preview-api';
import { ImagePreview } from '../../../core/preview/preview.models';
import type { PreviewContext } from '../preview-providers';
import { PV_TEXTS } from '../preview-texts';

/**
 * An image from the `fnfpreview` scheme (design 010 E3): decoded natively by the
 * WebView (`decoding="async"`), fitted or zoomed.
 */
@Component({
  selector: 'app-image-view',
  template: `
    <div class="stage" [class.fit]="context().zoom === 'fit'">
      @if (failed()) {
        <p class="info">{{ t.imageFailed }}</p>
      } @else {
        <img
          [src]="url()"
          [alt]="''"
          decoding="async"
          [style.width]="width()"
          (load)="onLoad($event)"
          (error)="failed.set(true)"
        />
      }
    </div>
    @if (natural(); as n) {
      <span class="dims">{{ t.imageSize(n.w, n.h) }}</span>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .stage {
      flex: 1;
      min-height: 0;
      overflow: auto;
      /* auto margins centre without cutting off a zoomed image (unlike place-items) */
      display: flex;
      background: repeating-conic-gradient(var(--color-surface-raised) 0% 25%, transparent 0% 50%)
        50% / 16px 16px;
    }
    .stage.fit {
      position: relative;
    }
    /* fit by absolute positioning: the box has a definite size */
    .stage.fit img {
      position: absolute;
      inset: 0;
      margin: auto;
      max-width: 100%;
      max-height: 100%;
    }
    img {
      margin: auto;
      flex: none;
      image-orientation: from-image;
    }
    .dims {
      font-size: 0.8rem;
      color: var(--color-muted);
      padding: 0.15rem 0.4rem;
    }
    .info {
      color: var(--color-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageView {
  readonly preview = input.required<ImagePreview>();
  readonly context = input.required<PreviewContext>();
  private readonly api = inject(PreviewApi);
  protected readonly t = PV_TEXTS;
  protected readonly failed = signal(false);
  protected readonly natural = signal<{ w: number; h: number } | null>(null);
  protected readonly url = computed(() => this.api.imageUrl(this.preview().token));
  protected readonly width = computed(() => {
    const z = this.context().zoom;
    const n = this.natural();
    return z === 'fit' || !n ? null : `${Math.round(n.w * z)}px`;
  });

  protected onLoad(evt: Event): void {
    const img = evt.target as HTMLImageElement;
    this.natural.set({ w: img.naturalWidth, h: img.naturalHeight });
  }
}
