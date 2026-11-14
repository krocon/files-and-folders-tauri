import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ImageOverviewApi } from '../../core/imageoverview/image-overview-api';
import { OverviewItem, THUMB_STEPS } from '../../core/imageoverview/image-overview.models';
import { MenuApi } from '../../core/menu/menu-api';
import { PreviewApi } from '../../core/preview/preview-api';
import { SettingsStore } from '../../core/settings/settings.store';
import { formatModified, formatSize } from '../../shared/format';
import { ImageOverviewStore } from './image-overview.store';
import { IMAGE_OVERVIEW_TEXTS } from './image-overview-texts';

/** The large step of the thumbnails – for raw files and what the WebView cannot show. */
const LARGE_STEP = THUMB_STEPS.length - 1;

/**
 * The large view of the image overview (design 074 E14): one image over the whole app,
 * either in the window or on the whole screen (`F` switches, the setting remembers it).
 * The original comes through `read_preview` (the WebView decodes it, HEIC on macOS too);
 * raw files and what that refuses come as the 2048 px thumbnail. ←/→, PgUp/PgDn, Home/End
 * page through the images of the overview, `Z` switches fit ↔ 100 %, Esc goes back to the
 * tile. A modal dialog: focus stays inside, the window behind is inert.
 */
@Component({
  selector: 'app-large-view',
  templateUrl: './large-view.html',
  styleUrl: './large-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-label]': 'label()',
    tabindex: '-1',
    '(keydown)': 'onKey($event)',
    '(mousemove)': 'wake()',
  },
})
export class LargeView {
  protected readonly store = inject(ImageOverviewStore);
  private readonly preview = inject(PreviewApi);
  private readonly overviewApi = inject(ImageOverviewApi);
  private readonly menu = inject(MenuApi);
  private readonly settings = inject(SettingsStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly t = IMAGE_OVERVIEW_TEXTS;

  protected readonly item = computed<OverviewItem | null>(() => {
    const i = this.store.large();
    return i === null ? null : (this.store.items()[i] ?? null);
  });
  protected readonly label = computed(() => this.t.largeLabel(this.item()?.name ?? ''));
  protected readonly position = computed(() =>
    this.t.position((this.store.large() ?? 0) + 1, this.store.items().length),
  );
  protected readonly mode = computed(() => this.settings.get('imageOverview.largeMode'));
  /** `src` of the image shown, `null` while it is asked for. */
  protected readonly src = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly actual = signal(false);
  protected readonly size = signal<{ w: number; h: number } | null>(null);
  /** The bars fade out after a moment without the mouse. */
  protected readonly idle = signal(false);
  protected readonly info = computed(() => {
    const i = this.item();
    if (!i) {
      return '';
    }
    const s = this.size();
    const parts = [i.rel, formatSize(i.size), formatModified(i.modifiedMs)];
    if (s) {
      parts.splice(2, 0, this.t.dimensions(s.w, s.h));
    }
    return parts.join(' · ');
  });

  private seq = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** We switched the window to full screen – switch it back on close. */
  private wentFullscreen = false;
  private readonly before =
    (this.host.nativeElement.ownerDocument.activeElement as HTMLElement | null) ?? null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      const item = this.item();
      untracked(() => void this.load(item));
    });
    queueMicrotask(() => this.host.nativeElement.focus());
    if (untracked(this.mode) === 'screen') {
      void this.enterScreen();
    }
    this.wake();
    destroyRef.onDestroy(() => {
      if (this.idleTimer !== null) {
        clearTimeout(this.idleTimer);
      }
      if (this.wentFullscreen) {
        void this.menu.toggleFullscreen().catch(() => undefined);
      }
      this.before?.focus?.({ preventScroll: true });
    });
  }

  private thumb(item: OverviewItem): string {
    return this.overviewApi.thumbUrl(
      this.store.overviewId() ?? '',
      item.index,
      LARGE_STEP,
      item.modifiedMs,
    );
  }

  /** The original if the WebView can show it, else the large thumbnail. */
  private async urlOf(item: OverviewItem): Promise<string> {
    if (item.kind === 'raw') {
      return this.thumb(item);
    }
    try {
      const p = await this.preview.readPreview(item.path);
      return p.kind === 'image' ? this.preview.imageUrl(p.token) : this.thumb(item);
    } catch {
      return this.thumb(item);
    }
  }

  private async load(item: OverviewItem | null): Promise<void> {
    const seq = ++this.seq;
    this.failed.set(false);
    this.size.set(null);
    this.actual.set(false);
    if (!item) {
      this.src.set(null);
      return;
    }
    const url = await this.urlOf(item);
    if (seq === this.seq) {
      this.src.set(url);
      this.prefetch();
    }
  }

  /** The neighbours, so paging feels instant. */
  private prefetch(): void {
    const i = this.store.large();
    if (i === null) {
      return;
    }
    for (const n of [i + 1, i - 1]) {
      const item = this.store.items()[n];
      if (item) {
        void this.urlOf(item).then((url) => {
          const img = new Image();
          img.decoding = 'async';
          img.src = url;
        });
      }
    }
  }

  protected onLoad(e: Event): void {
    const img = e.target as HTMLImageElement;
    this.size.set({ w: img.naturalWidth, h: img.naturalHeight });
  }

  protected async onError(): Promise<void> {
    const item = this.item();
    const src = this.src();
    // the original failed in the WebView: try the large thumbnail once
    if (item && src !== null && src !== this.thumb(item)) {
      this.src.set(this.thumb(item));
      return;
    }
    this.failed.set(true);
  }

  private async enterScreen(): Promise<void> {
    try {
      const now = await this.menu.toggleFullscreen();
      if (now) {
        this.wentFullscreen = true;
      } else {
        // it was full screen already: back to that, and leave it so on close
        await this.menu.toggleFullscreen();
      }
    } catch {
      // full screen not possible: the window mode still works
    }
  }

  protected async toggleMode(): Promise<void> {
    const next = this.mode() === 'window' ? 'screen' : 'window';
    this.settings.set('imageOverview.largeMode', next);
    if (next === 'screen') {
      await this.enterScreen();
    } else if (this.wentFullscreen) {
      this.wentFullscreen = false;
      await this.menu.toggleFullscreen().catch(() => undefined);
    }
  }

  protected close(): void {
    this.store.closeLarge();
  }

  protected wake(): void {
    this.idle.set(false);
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => this.idle.set(true), 2000);
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    switch (e.key) {
      case 'Escape':
        this.close();
        break;
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        this.store.step(1);
        break;
      case 'ArrowLeft':
      case 'PageUp':
      case 'Backspace':
        this.store.step(-1);
        break;
      case 'Home':
        this.store.stepTo(0);
        break;
      case 'End':
        this.store.stepTo(this.store.items().length - 1);
        break;
      case 'f':
      case 'F':
        void this.toggleMode();
        break;
      case 'z':
      case 'Z':
        this.actual.update((a) => !a);
        break;
      case 'Tab':
        this.trapFocus(e);
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.wake();
  }

  /** Tab stays inside the dialog. */
  private trapFocus(e: KeyboardEvent): void {
    const focusable = [
      ...this.host.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled])'),
    ];
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const doc = this.host.nativeElement.ownerDocument;
    const i = focusable.indexOf(doc.activeElement as HTMLElement);
    const next = e.shiftKey
      ? focusable[i <= 0 ? focusable.length - 1 : i - 1]
      : focusable[i < 0 || i === focusable.length - 1 ? 0 : i + 1];
    next.focus();
    e.preventDefault();
    this.wake();
  }
}
