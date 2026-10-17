import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { TextPreview } from '../../../core/preview/preview.models';
import type { PreviewContext } from '../preview-providers';
import { Match, segmentsOf, splitLines } from '../text-search';

/** Lines per block; blocks off screen are skipped by the layout (`content-visibility`). */
const BLOCK = 500;

/**
 * Text with line numbers (design 010 E8). Built with `textContent` only – the
 * text is user data and never parsed as HTML. Matches become `<mark>` elements.
 */
@Component({
  selector: 'app-text-view',
  template: `<div #lines class="lines" [class.wrap]="context().wrap"></div>`,
  styleUrl: './text-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--fnf-gutter]': 'gutter()' },
})
export class TextView {
  readonly preview = input.required<TextPreview>();
  readonly context = input.required<PreviewContext>();
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('lines');

  protected readonly lines = computed(() => splitLines(this.preview().text));
  protected readonly gutter = computed(() => `${String(this.lines().length).length + 1}ch`);
  private lineEls: HTMLElement[] = [];
  private marked = new Set<number>();

  constructor() {
    effect(() => {
      const lines = this.lines();
      const box = this.box().nativeElement;
      untracked(() => this.build(box, lines));
    });
    effect(() => {
      const { matches, current } = this.context();
      this.lines();
      untracked(() => this.mark(matches, current));
    });
  }

  private build(box: HTMLElement, lines: readonly string[]): void {
    box.textContent = '';
    this.lineEls = [];
    this.marked.clear();
    const doc = box.ownerDocument;
    for (let b = 0; b < lines.length; b += BLOCK) {
      const block = doc.createElement('div');
      block.className = 'block';
      const end = Math.min(lines.length, b + BLOCK);
      block.style.setProperty('--fnf-block-lines', String(end - b));
      for (let i = b; i < end; i++) {
        const el = doc.createElement('div');
        el.className = 'ln';
        el.dataset['n'] = String(i + 1);
        // one grid item for the text: marks and text nodes must not become columns
        const text = doc.createElement('span');
        text.textContent = lines[i];
        el.appendChild(text);
        block.appendChild(el);
        this.lineEls.push(text);
      }
      box.appendChild(block);
    }
  }

  private mark(matches: readonly Match[], current: number): void {
    const lines = this.lines();
    for (const i of this.marked) {
      this.lineEls[i].textContent = lines[i];
    }
    this.marked.clear();
    const byLine = new Map<number, Match[]>();
    for (const m of matches) {
      const list = byLine.get(m.line);
      if (list) {
        list.push(m);
      } else {
        byLine.set(m.line, [m]);
      }
    }
    const cur = matches[current] ?? null;
    let currentEl: HTMLElement | null = null;
    for (const [i, ms] of byLine) {
      const el = this.lineEls[i];
      if (!el) {
        continue;
      }
      el.textContent = '';
      for (const seg of segmentsOf(lines[i], ms, cur)) {
        if (seg.mark === 'none') {
          el.appendChild(el.ownerDocument.createTextNode(seg.text));
        } else {
          const mark = el.ownerDocument.createElement('mark');
          mark.textContent = seg.text;
          if (seg.mark === 'current') {
            mark.className = 'current';
            currentEl = mark;
          }
          el.appendChild(mark);
        }
      }
      this.marked.add(i);
    }
    currentEl?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }
}
