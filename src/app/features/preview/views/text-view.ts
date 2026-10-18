import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { TextPreview } from '../../../core/preview/preview.models';
import type { PreviewContext } from '../preview-providers';
import { Match, segmentsOf, splitLines } from '../text-search';

/** Lines per block; a block is filled when it nears the viewport (review 3). */
const BLOCK = 500;
/** Blocks are filled this far ahead of the visible area. */
const AHEAD = '200%';

/** Closest scrolling ancestor (root of the observer), `null` = viewport. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  const view = el.ownerDocument.defaultView;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = view?.getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') {
      return p;
    }
  }
  return null;
}

/**
 * Text with line numbers (design 010 E8). Built with `textContent` only – the
 * text is user data and never parsed as HTML. Matches become `<mark>` elements.
 * Lines live in blocks of {@link BLOCK}; only the first block is built at once,
 * the others are empty placeholders of the right height that are filled when
 * they come near the viewport (`IntersectionObserver`), so 500 000 short lines
 * do not become millions of nodes at open (review 3).
 */
@Component({
  selector: 'app-text-view',
  template: `<div #lines class="lines" [class.wrap]="context().wrap"></div>`,
  styleUrl: './text-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--fnf-gutter]': 'gutter()' },
})
export class TextView {
  readonly preview = input.required<TextPreview>();
  readonly context = input.required<PreviewContext>();
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('lines');

  protected readonly lines = computed(
    () => this.context().lines ?? splitLines(this.preview().text),
  );
  protected readonly gutter = computed(() => `${String(this.lines().length).length + 1}ch`);
  /** Text element per line; `undefined` while its block is not filled. */
  private lineEls: (HTMLElement | undefined)[] = [];
  private blocks: HTMLElement[] = [];
  private filled: boolean[] = [];
  private marked = new Set<number>();
  private byLine = new Map<number, Match[]>();
  private cur: Match | null = null;
  private observer: IntersectionObserver | null = null;

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
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
  }

  private build(box: HTMLElement, lines: readonly string[]): void {
    this.observer?.disconnect();
    this.observer = null;
    box.textContent = '';
    this.lineEls = new Array<HTMLElement | undefined>(lines.length);
    this.blocks = [];
    this.filled = [];
    this.marked.clear();
    this.byLine.clear();
    this.cur = null;
    const doc = box.ownerDocument;
    for (let b = 0; b < lines.length; b += BLOCK) {
      const block = doc.createElement('div');
      block.className = 'block';
      block.dataset['b'] = String(this.blocks.length);
      block.style.setProperty('--fnf-block-lines', String(Math.min(lines.length, b + BLOCK) - b));
      this.blocks.push(block);
      this.filled.push(false);
      box.appendChild(block);
    }
    const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    if (!IO) {
      // no observer (old engine, tests): build everything as before
      this.blocks.forEach((_, i) => this.fill(i));
      return;
    }
    if (this.blocks.length > 0) {
      this.fill(0);
    }
    if (this.blocks.length > 1) {
      this.observer = new IO(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              this.fill(Number((e.target as HTMLElement).dataset['b']));
            }
          }
        },
        { root: scrollParent(box), rootMargin: `${AHEAD} 0px` },
      );
      this.blocks.slice(1).forEach((b) => this.observer?.observe(b));
    }
  }

  /** Builds the lines of block `b` (once) and applies the marks that fall in it. */
  private fill(b: number): void {
    if (this.filled[b] || !this.blocks[b]) {
      return;
    }
    this.filled[b] = true;
    const block = this.blocks[b];
    this.observer?.unobserve(block);
    block.classList.add('filled');
    const lines = this.lines();
    const doc = block.ownerDocument;
    const frag = doc.createDocumentFragment();
    const end = Math.min(lines.length, (b + 1) * BLOCK);
    for (let i = b * BLOCK; i < end; i++) {
      const el = doc.createElement('div');
      el.className = 'ln';
      el.dataset['n'] = String(i + 1);
      // one grid item for the text: marks and text nodes must not become columns
      const text = doc.createElement('span');
      text.textContent = lines[i];
      el.appendChild(text);
      frag.appendChild(el);
      this.lineEls[i] = text;
      if (this.byLine.has(i)) {
        this.render(i);
      }
    }
    block.appendChild(frag);
  }

  private mark(matches: readonly Match[], current: number): void {
    const lines = this.lines();
    for (const i of this.marked) {
      const el = this.lineEls[i];
      if (el) {
        el.textContent = lines[i];
      }
    }
    this.marked.clear();
    this.byLine = new Map<number, Match[]>();
    for (const m of matches) {
      const list = this.byLine.get(m.line);
      if (list) {
        list.push(m);
      } else {
        this.byLine.set(m.line, [m]);
      }
    }
    this.cur = matches[current] ?? null;
    if (this.cur) {
      this.fill(Math.floor(this.cur.line / BLOCK)); // renders its marks too
    }
    for (const i of this.byLine.keys()) {
      if (this.lineEls[i]) {
        this.render(i);
      }
    }
    const currentEl = this.box().nativeElement.querySelector('mark.current');
    currentEl?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }

  /** Line `i` with its marks (its block is filled). */
  private render(i: number): void {
    const el = this.lineEls[i];
    const ms = this.byLine.get(i);
    if (!el || !ms) {
      return;
    }
    el.textContent = '';
    for (const seg of segmentsOf(this.lines()[i], ms, this.cur)) {
      if (seg.mark === 'none') {
        el.appendChild(el.ownerDocument.createTextNode(seg.text));
      } else {
        const mark = el.ownerDocument.createElement('mark');
        mark.textContent = seg.text;
        if (seg.mark === 'current') {
          mark.className = 'current';
        }
        el.appendChild(mark);
      }
    }
    this.marked.add(i);
  }
}
