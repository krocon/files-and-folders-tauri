import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { ButtonBar } from './button-bar/button-bar';
import { FilePanel } from './file-panel';
import { splitterFromPointer, splitterKey } from './splitter';
import { TEXTS } from './texts';
import { WorkspaceStore } from './workspace.store';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The main window (`docs/ui-layout.md`): a CSS grid with the rows header · tabs ·
 * list · status (each split left | divider | right with one shared column
 * width) and the button bar. Owns the splitter, the announcement of the active
 * side and the window-wide tab shortcuts (until prompt 002).
 */
@Component({
  selector: 'app-workspace',
  imports: [FilePanel, ButtonBar],
  templateUrl: './workspace.html',
  styleUrl: './workspace.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--fnf-split]': 'ws.splitter()',
    '[class.resizing]': 'dragging()',
    '(keydown)': 'onKeydown($event)',
    '(document:visibilitychange)': 'onVisibility()',
    '(window:pagehide)': 'onPageHide()',
  },
})
export class Workspace implements OnInit {
  protected readonly ws = inject(WorkspaceStore);
  protected readonly texts = TEXTS;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly dragging = signal(false);
  protected readonly splitPercent = computed(() => Math.round(this.ws.splitter() * 100));
  /** Live region text: "Left panel, /Users/marc". */
  protected readonly announcement = signal('');

  constructor() {
    let previous: string | null = null;
    effect(() => {
      const side = this.ws.activeSide();
      const ready = this.ws.ready();
      untracked(() => {
        if (ready && previous !== null && previous !== side) {
          const path = this.ws.activeTab(side).path;
          this.announcement.set(`${TEXTS.sideName(side)}, ${path ?? TEXTS.homeFolder}`);
        }
        if (ready) {
          previous = side;
        }
      });
    });
  }

  ngOnInit(): void {
    void this.ws.init();
  }

  // ---- splitter ----

  protected onSplitterDown(evt: PointerEvent): void {
    if (evt.button !== 0) {
      return;
    }
    const el = evt.target as HTMLElement;
    el.setPointerCapture?.(evt.pointerId);
    this.dragging.set(true);
    evt.preventDefault(); // no text selection while dragging …
    el.focus(); // … but the separator gets the focus (arrow keys)
  }

  protected onSplitterMove(evt: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.ws.setSplitter(splitterFromPointer(evt.clientX, rect.left, rect.width));
  }

  protected onSplitterUp(): void {
    this.dragging.set(false);
  }

  protected onSplitterKey(evt: KeyboardEvent): void {
    const next = splitterKey(this.ws.splitter(), evt.key);
    if (next !== null) {
      this.ws.setSplitter(next);
      evt.preventDefault();
    }
  }

  protected resetSplitter(): void {
    this.ws.setSplitter(0.5);
  }

  // ---- window-wide keys (interim until the action system of prompt 002) ----

  protected onKeydown(evt: KeyboardEvent): void {
    const side = this.ws.activeSide();
    const primary = IS_MAC ? evt.metaKey : evt.ctrlKey;
    if (evt.key === 'Tab' && evt.ctrlKey && !evt.altKey && !evt.metaKey) {
      this.ws.cycleTab(side, evt.shiftKey ? -1 : 1);
    } else if (primary && evt.altKey && !evt.shiftKey && evt.code === 'KeyT') {
      this.ws.cloneTab(side);
    } else if (primary && evt.altKey && !evt.shiftKey && evt.code === 'KeyW') {
      this.ws.closeTab(side);
    } else {
      return;
    }
    evt.preventDefault();
    evt.stopPropagation();
    this.ws.requestFocus(side);
  }

  protected onPageHide(): void {
    void this.ws.flush();
  }

  protected onVisibility(): void {
    if (document.visibilityState === 'hidden') {
      void this.ws.flush();
    }
  }
}
