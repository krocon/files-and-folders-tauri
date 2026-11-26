import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error – node:fs is not part of the app's types; specs may read source files
import { readFileSync } from 'node:fs';
import { Modal } from './modal';

@Component({
  selector: 'app-size-dialogs',
  imports: [Modal],
  template: `
    <app-modal class="grow" heading="Grows" minHeight="38rem"><p>content</p></app-modal>
    <app-modal class="fixed" heading="Fixed" height="70vh"><p>content</p></app-modal>
    <app-modal class="plain" heading="Plain"><p>content</p></app-modal>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class SizeDialogs {}

/** The observers the modals created, to report sizes by hand (jsdom has no layout). */
let observers: { cb: ResizeObserverCallback; targets: Element[] }[] = [];

class FakeResizeObserver {
  private readonly entry: { cb: ResizeObserverCallback; targets: Element[] };
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, targets: [] };
    observers.push(this.entry);
  }
  observe(el: Element): void {
    this.entry.targets.push(el);
  }
  disconnect(): void {
    this.entry.targets.length = 0;
  }
}

function report(el: HTMLElement, height: number): void {
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height });
  for (const o of observers) {
    if (o.targets.includes(el)) {
      o.cb([], o as unknown as ResizeObserver);
    }
  }
}

describe('Modal: size follows the window and the content', () => {
  const original = globalThis.ResizeObserver;

  beforeEach(() => {
    observers = [];
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  async function dialogs() {
    const fixture = TestBed.createComponent(SizeDialogs);
    await fixture.whenStable();
    const el = (cls: string) =>
      fixture.nativeElement.querySelector(`app-modal.${cls} .dialog`) as HTMLElement;
    return { fixture, grow: el('grow'), fixed: el('fixed'), plain: el('plain') };
  }

  it('minHeight: at least that high, as high as the content – never a fixed height', async () => {
    const { grow, fixed, plain } = await dialogs();
    expect(grow.classList.contains('grows')).toBe(true);
    expect(grow.style.getPropertyValue('--dialog-min')).toBe('38rem');
    expect(grow.style.height).toBe('');
    expect(grow.style.maxHeight).toBe('');
    // the other kinds are untouched
    expect(fixed.classList.contains('grows')).toBe(false);
    expect(fixed.style.height).toBe('70vh');
    expect(plain.classList.contains('grows')).toBe(false);
    expect(plain.style.height).toBe('');
    expect(plain.style.getPropertyValue('--dialog-min')).toBe('');
  });

  it('a dialog that grew for one tab does not shrink again for the next', async () => {
    const { fixture, grow, fixed } = await dialogs();
    report(grow, 700);
    await fixture.whenStable();
    expect(grow.style.getPropertyValue('--dialog-grown')).toBe('700px');
    report(grow, 912);
    await fixture.whenStable();
    expect(grow.style.getPropertyValue('--dialog-grown')).toBe('912px');
    // a shorter tab: the height that was reached stays
    report(grow, 608);
    await fixture.whenStable();
    expect(grow.style.getPropertyValue('--dialog-grown')).toBe('912px');
    // only dialogs with minHeight keep a height
    report(fixed, 500);
    await fixture.whenStable();
    expect(fixed.style.getPropertyValue('--dialog-grown')).toBe('');
  });

  it('the style sheet: the window is used, and what grew never beats the window', () => {
    const css: string = readFileSync('src/app/shared/dialog/modal.css', 'utf8');
    // every dialog may take the room of the window, not a fixed share of it
    expect(css).toMatch(/--dialog-room:\s*calc\(100vh - /);
    expect(css).toMatch(/\.dialog\s*\{[^}]*max-height:\s*var\(--dialog-room\)/);
    expect(css).not.toMatch(/max-height:\s*80vh/);
    // min-height wins over max-height in CSS: it must be capped by the room itself
    expect(css).toMatch(
      /\.dialog\.grows\s*\{[^}]*min-height:\s*min\(\s*max\(var\(--dialog-min\), var\(--dialog-grown, 0px\)\),\s*var\(--dialog-room\)\s*\)/,
    );
    // lists inside dialogs get what a window is higher than a small one
    expect(css).toMatch(/--dialog-spare:\s*max\(0px, /);
  });
});
