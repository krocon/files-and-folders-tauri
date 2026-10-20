import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DND_TEXTS } from './dnd-logic';
import { DragStore } from './drag.store';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The hint next to the pointer while dragging (design 012 E5): what, how and
 * where to. Never takes pointer events (the hit test must see the list below).
 */
@Component({
  selector: 'app-drag-ghost',
  template: `
    @if (store.drag(); as d) {
      @if (text(); as t) {
        <div
          class="ghost"
          [class.no-target]="!d.target"
          [class.move]="d.kind === 'move'"
          [style.left.px]="flip(d.x) ? null : d.x + 16"
          [style.right.px]="flip(d.x) ? viewportWidth() - d.x + 16 : null"
          [style.top.px]="d.y + 18"
        >
          <span class="what">{{ t }}</span>
          @if (!d.fromSystem) {
            <span class="hint">{{ hint }}</span>
          }
        </div>
      }
    }
    <div class="live" role="status" aria-live="polite">{{ text() }}</div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 50;
    }
    .ghost {
      position: fixed;
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-width: 440px;
      padding: var(--spacing-1) var(--spacing-2);
      font-size: var(--font-size-sm);
      color: var(--color-accent-text);
      background: var(--color-accent);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-popup);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ghost.no-target {
      color: var(--color-tooltip-text);
      background: var(--color-tooltip-bg);
      border: var(--border-width) solid var(--color-border);
    }
    .what {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hint {
      font-size: var(--font-size-xs);
      opacity: 0.85;
      /* the hint grew with the link modifier (design 031): wrap instead of cutting it off */
      white-space: normal;
    }
    .live {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DragGhost {
  protected readonly store = inject(DragStore);
  protected get hint(): string {
    return DND_TEXTS.hint(IS_MAC);
  }
  /** Near the right edge the hint goes left of the pointer – it stays readable up to the edge. */
  protected flip(x: number): boolean {
    return x > this.viewportWidth() - 460;
  }
  protected viewportWidth(): number {
    return typeof window === 'undefined' ? Infinity : window.innerWidth;
  }
  /** Changes only with kind and target, not with every pointer move. */
  protected readonly text = computed(() => {
    const d = this.store.drag();
    return d ? this.store.label(d) : '';
  });
}
