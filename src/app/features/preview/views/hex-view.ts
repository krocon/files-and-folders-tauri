import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BinaryPreview } from '../../../core/preview/preview.models';
import { hexDump } from '../hex';
import type { PreviewContext } from '../preview-providers';

/** Hex dump of the first bytes of a binary file (design 010 E8). */
@Component({
  selector: 'app-hex-view',
  template: `<pre class="hex">{{ dump() }}</pre>`,
  styles: `
    .hex {
      margin: 0;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      line-height: 1.35;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HexView {
  readonly preview = input.required<BinaryPreview>();
  readonly context = input.required<PreviewContext>();
  protected readonly dump = computed(() => hexDump(this.preview().bytes));
}
