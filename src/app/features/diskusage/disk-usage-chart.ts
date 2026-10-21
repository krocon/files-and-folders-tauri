import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { JobsStore } from '../../core/jobs/jobs.store';
import { sizeOf, UsageNode } from '../../core/diskusage/disk-usage.models';
import { Side } from '../../core/session/session.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { ThemeService } from '../../core/theme/theme.service';
import { formatSize } from '../../shared/format';
import { WorkspaceStore } from '../workspace/workspace.store';
import { Arc, arcPath, RING_DEPTH, Shape, sunburst, Tile, treemap } from './chart-layout';
import { DiskUsageStore } from './disk-usage.store';
import { USAGE_TEXTS } from './disk-usage-texts';
import { fillOf, hex, labelOn, readPalette, UsagePalette } from './usage-colors';
import { shareText, usageOf } from './usage-rows';

interface Drawn {
  readonly key: string;
  readonly shape: Shape;
  readonly d?: string;
  readonly rect?: { x: number; y: number; w: number; h: number };
  readonly fill: string;
  readonly label: { x: number; y: number; text: string; color: string } | null;
}

/**
 * The chart and the basket of a disk-usage tab (design 033 E1–E3), shown in the
 * other panel like the quick view. Rings or tiles of the shown node; click on a
 * folder goes into it, the centre goes up; hovering shows a tooltip and the list
 * cursor highlights its segment. Below: the marked entries of all levels.
 */
@Component({
  selector: 'app-disk-usage-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let st = state();
    <div class="head">
      <strong class="title" [attr.title]="st?.view?.node?.path ?? null">{{ title() }}</strong>
      <span class="kinds" role="group" [attr.aria-label]="t.chartLabel">
        <button
          type="button"
          class="btn small"
          [attr.aria-pressed]="kind() === 'sunburst'"
          (click)="setKind('sunburst')"
        >
          {{ t.sunburst }}
        </button>
        <button
          type="button"
          class="btn small"
          [attr.aria-pressed]="kind() === 'treemap'"
          (click)="setKind('treemap')"
        >
          {{ t.treemap }}
        </button>
      </span>
    </div>
    @if (volume(); as vol) {
      <div class="volume" [attr.title]="vol.title">
        <span class="seg used" [style.flex-grow]="vol.scanned"></span>
        <span class="seg uncounted" [style.flex-grow]="vol.uncounted"></span>
        <span class="seg free" [style.flex-grow]="vol.free"></span>
      </div>
      <div class="volume-legend" aria-hidden="true">
        <span><i class="dot used"></i>{{ t.volumeUsed }}</span>
        <span><i class="dot uncounted"></i>{{ t.volumeUncounted }}</span>
        <span><i class="dot free"></i>{{ t.volumeFree }}</span>
      </div>
    }
    <div class="canvas" #canvas>
      <svg
        role="img"
        [attr.aria-label]="ariaLabel()"
        [attr.width]="width()"
        [attr.height]="height()"
        [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
        (pointerleave)="hover.set(null)"
      >
        @for (d of drawn(); track d.key) {
          @if (d.d) {
            <path
              [attr.d]="d.d"
              [attr.fill]="d.fill"
              [class.virtual]="d.shape.virtual"
              [class.hot]="d.shape.node.id === highlight() && !d.shape.virtual"
              [class.nav]="d.shape.node.kind === 'dir'"
              [class.removing]="isRemoving(d.shape)"
              (pointerenter)="enter(d, $event)"
              (pointermove)="move($event)"
              (click)="pick(d.shape)"
            />
          } @else if (d.rect; as r) {
            <rect
              [attr.x]="r.x"
              [attr.y]="r.y"
              [attr.width]="r.w"
              [attr.height]="r.h"
              [attr.fill]="d.fill"
              [class.virtual]="d.shape.virtual"
              [class.hot]="d.shape.node.id === highlight() && !d.shape.virtual"
              [class.nav]="d.shape.node.kind === 'dir'"
              [class.removing]="isRemoving(d.shape)"
              (pointerenter)="enter(d, $event)"
              (pointermove)="move($event)"
              (click)="pick(d.shape)"
            />
          }
          @if (d.label; as l) {
            <text
              [attr.x]="l.x"
              [attr.y]="l.y"
              [attr.fill]="l.color"
              text-anchor="middle"
              dominant-baseline="middle"
              aria-hidden="true"
            >
              {{ l.text }}
            </text>
          }
        }
        @if (kind() === 'sunburst' && st?.view; as v) {
          <circle
            class="centre"
            [class.nav]="canUp()"
            [attr.cx]="cx()"
            [attr.cy]="cy()"
            [attr.r]="ring() * 0.9"
            (click)="up()"
          >
            <title>{{ canUp() ? t.up : '' }}</title>
          </circle>
          <text
            class="centre-text"
            [attr.x]="cx()"
            [attr.y]="cy()"
            text-anchor="middle"
            dominant-baseline="middle"
            aria-hidden="true"
          >
            {{ centreText() }}
          </text>
        }
      </svg>
      @if (tip(); as tp) {
        <div class="tip" role="presentation" [style.left.px]="tp.x" [style.top.px]="tp.y">
          <strong>{{ tp.name }}</strong>
          @for (line of tp.lines; track $index) {
            <span>{{ line }}</span>
          }
        </div>
      }
    </div>
    <section class="basket" [attr.aria-label]="t.basketTitle">
      <div class="basket-head">
        <strong>{{ t.basketTitle }}</strong>
        <span class="sum">{{ basketSum() }}</span>
        <button
          type="button"
          class="btn small"
          [disabled]="basket().effective.length === 0"
          (click)="clear()"
        >
          {{ t.clear }}
        </button>
        <button
          type="button"
          class="btn small danger"
          [disabled]="pending().length === 0"
          [attr.title]="t.removeTitle"
          (click)="remove()"
        >
          {{ t.remove }}
        </button>
      </div>
      @if (basketRows().length === 0) {
        <p class="note">{{ t.basketEmpty }}</p>
      } @else {
        <ul>
          @for (b of basketRows(); track b.id) {
            <li
              [class.covered]="b.covered"
              [class.removing]="removing().has(b.path)"
              [attr.title]="b.path"
            >
              <span class="name">{{ b.name }}</span>
              <span class="size">{{ b.covered ? t.inMarkedFolder : b.size }}</span>
              <button
                type="button"
                class="unmark"
                [attr.aria-label]="t.unmark(b.name)"
                [attr.title]="t.unmark(b.name)"
                (click)="unmark(b.id)"
              >
                <i class="fa fa-times" aria-hidden="true"></i>
              </button>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--color-list-bg);
      color: var(--color-text);
      font-size: var(--font-size-sm);
    }
    .head,
    .basket-head {
      display: flex;
      gap: var(--spacing-2);
      align-items: center;
      padding: var(--spacing-1) var(--spacing-2);
      border-bottom: var(--border-width) solid var(--color-border);
    }
    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kinds {
      display: flex;
      gap: 2px;
    }
    .volume {
      display: flex;
      height: 8px;
      margin: var(--spacing-1) var(--spacing-2) 0;
      overflow: hidden;
      border-radius: 4px;
    }
    .seg {
      flex-basis: 0;
    }
    .used {
      background: var(--color-usage-bar);
    }
    .uncounted {
      background: var(--color-usage-uncounted);
    }
    .free {
      background: var(--color-usage-free);
    }
    .volume-legend {
      display: flex;
      gap: var(--spacing-3);
      padding: 0 var(--spacing-2);
      color: var(--color-muted);
      font-size: var(--font-size-xs);
    }
    .dot {
      display: inline-block;
      width: 0.7em;
      height: 0.7em;
      margin-right: 0.3em;
      border-radius: 2px;
    }
    .canvas {
      position: relative;
      flex: 1;
      min-height: 120px;
      overflow: hidden;
    }
    svg {
      display: block;
    }
    path,
    rect {
      stroke: var(--color-list-bg);
      stroke-width: 1;
    }
    .virtual {
      stroke-dasharray: 3 2;
      opacity: 0.85;
    }
    .nav {
      cursor: pointer;
    }
    /* taken away by a running delete/move (design 033 follow-up) */
    .removing {
      animation: fnf-usage-fade 0.9s ease-in-out infinite alternate;
    }
    li.removing .name {
      font-style: italic;
      text-decoration: line-through;
    }
    @keyframes fnf-usage-fade {
      from {
        opacity: 0.85;
      }
      to {
        opacity: 0.25;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .removing {
        animation: none;
        opacity: 0.4;
      }
    }
    .hot {
      stroke: var(--color-text);
      stroke-width: 2.5;
    }
    text {
      font-size: 11px;
      pointer-events: none;
    }
    .centre {
      fill: var(--color-surface);
      stroke: var(--color-border);
    }
    .centre-text {
      fill: var(--color-text);
      font-size: 13px;
      font-weight: 600;
    }
    .tip {
      position: absolute;
      z-index: 2;
      display: flex;
      flex-direction: column;
      max-width: 22em;
      padding: var(--spacing-1) var(--spacing-2);
      pointer-events: none;
      color: var(--color-tooltip-text);
      background: var(--color-tooltip-bg);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-popup);
      overflow-wrap: anywhere;
    }
    .basket {
      display: flex;
      flex-direction: column;
      max-height: 40%;
      min-height: 0;
      border-top: var(--border-width) solid var(--color-border);
    }
    .basket-head strong {
      flex: none;
      white-space: nowrap;
    }
    .sum {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: end;
      color: var(--color-muted);
      white-space: nowrap;
    }
    .note {
      margin: var(--spacing-2);
      color: var(--color-muted);
    }
    ul {
      margin: 0;
      padding: 0;
      overflow: auto;
      list-style: none;
    }
    li {
      display: flex;
      gap: var(--spacing-2);
      align-items: center;
      padding: 2px var(--spacing-2);
    }
    li.covered {
      color: var(--color-muted);
    }
    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .size {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .unmark {
      padding: 0 var(--spacing-1);
      color: inherit;
      background: none;
      border: none;
      cursor: pointer;
    }
    .unmark:focus-visible {
      outline: var(--focus-ring-width) solid var(--color-focus);
    }
  `,
})
export class DiskUsageChart {
  readonly scanId = input.required<string>();
  /** The side of the disk-usage tab (the list). */
  readonly side = input.required<Side>();

  protected readonly t = USAGE_TEXTS;
  private readonly usage = inject(DiskUsageStore);
  private readonly ws = inject(WorkspaceStore);
  private readonly actions = inject(ActionService);
  private readonly settings = inject(SettingsStore);
  private readonly theme = inject(ThemeService);
  private readonly jobs = inject(JobsStore);
  /** Entries running delete/move jobs take away. */
  protected readonly removing = computed(() => this.jobs.removing());
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');

  protected readonly state = computed(() => this.usage.state(this.scanId()) ?? null);
  protected readonly kind = computed(() => this.settings.get('diskUsage.chart'));
  protected readonly width = signal(300);
  protected readonly height = signal(300);
  protected readonly hover = signal<Drawn | null>(null);
  private readonly pointer = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  private readonly palette = signal<UsagePalette | null>(null);

  protected readonly cx = computed(() => this.width() / 2);
  protected readonly cy = computed(() => this.height() / 2);
  /** Width of one ring (the centre takes one). */
  protected readonly ring = computed(
    () => Math.max(8, Math.min(this.width(), this.height()) / 2 - 4) / (RING_DEPTH + 1),
  );

  protected readonly title = computed(() => {
    const v = this.state()?.view;
    if (!v) {
      return this.t.header;
    }
    const name = v.node.name || this.t.selection;
    return `${name} · ${formatSize(sizeOf(v.node, v.sizeMode))}`;
  });

  protected readonly canUp = computed(() => (this.state()?.view?.crumbs.length ?? 0) > 1);

  protected readonly centreText = computed(() => {
    const v = this.state()?.view;
    return v ? formatSize(sizeOf(v.node, v.sizeMode)) : '';
  });

  /** The list's cursor entry (highlighted in the chart). */
  protected readonly highlight = computed(() => {
    const h = this.hover();
    if (h) {
      return h.shape.node.id;
    }
    const entry = this.ws.panel(this.side())?.store.cursorEntry();
    return usageOf(entry)?.id ?? null;
  });

  protected readonly drawn = computed<Drawn[]>(() => {
    const st = this.state();
    const root = st?.chart;
    const p = this.palette();
    if (!st?.view || !root || !p) {
      return [];
    }
    const mode = st.view.sizeMode;
    if (this.kind() === 'treemap') {
      return treemap(root, mode, this.width(), this.height()).map((tile, i) =>
        this.drawTile(tile, i, p),
      );
    }
    return sunburst(root, mode).map((arc, i) => this.drawArc(arc, i, p));
  });

  protected readonly ariaLabel = computed(() => {
    const st = this.state();
    const v = st?.view;
    if (!v) {
      return this.t.header;
    }
    const parts = (v.node.children ?? [])
      .filter((c) => c.kind !== 'files' && c.kind !== 'rest')
      .slice(0, 5)
      .map((c) => {
        const whole = sizeOf(v.node, v.sizeMode);
        return `${c.name} ${shareText(whole > 0 ? sizeOf(c, v.sizeMode) / whole : 0)}`;
      })
      .join(', ');
    return this.t.chartAria(v.node.name || this.t.selection, parts);
  });

  protected readonly tip = computed(() => {
    const d = this.hover();
    const v = this.state()?.view;
    if (!d || !v) {
      return null;
    }
    const n = d.shape.node;
    const whole = sizeOf(v.node, v.sizeMode);
    const lines = [
      this.t.tipSize(formatSize(n.allocated), formatSize(n.logical)),
      this.t.tipShare(shareText(whole > 0 ? sizeOf(n, v.sizeMode) / whole : 0)),
    ];
    if (n.kind === 'dir') {
      lines.push(this.t.tipObjects(n.files, n.dirs));
    }
    if (n.kind === 'mount') {
      lines.push(this.t.mountNote);
    } else if (n.unreadable > 0) {
      lines.push(this.t.unreadable(n.unreadable));
    }
    const pos = this.pointer();
    const w = this.width();
    return {
      name: nameOf(n),
      lines,
      x: Math.min(pos.x + 12, Math.max(0, w - 200)),
      y: pos.y + 12,
    };
  });

  protected readonly volume = computed(() => {
    const v = this.state()?.view;
    const vol = v?.volume;
    if (!v || !vol || vol.total <= 0) {
      return null;
    }
    const used = Math.max(0, vol.total - vol.free);
    const scanned = Math.min(used, v.scannedAllocated);
    const uncounted = Math.max(0, used - scanned);
    return {
      scanned,
      uncounted,
      free: vol.free,
      title: this.t.volumeTitle(
        formatSize(scanned),
        formatSize(uncounted),
        formatSize(vol.free),
        formatSize(vol.total),
      ),
    };
  });

  protected readonly basket = computed(() => {
    this.state(); // follows the basket
    return this.usage.basket(this.scanId());
  });

  protected readonly basketRows = computed(() => {
    const st = this.state();
    const b = this.basket();
    if (!st) {
      return [];
    }
    const mode = st.view?.sizeMode ?? 'allocated';
    return [...st.basket.values()].map((r) => ({
      id: r.usage.id,
      name: r.name,
      path: r.path,
      size: formatSize(mode === 'allocated' ? r.usage.allocated : r.usage.logical),
      covered: b.covered.has(r.usage.id),
    }));
  });

  /** Basket entries not being removed yet – what "Remove…" would delete. */
  protected readonly pending = computed(() => {
    const removing = this.removing();
    return this.basket().effective.filter((r) => !removing.has(r.path));
  });

  protected readonly basketSum = computed(() => {
    const b = this.basket();
    if (b.effective.length === 0) {
      return '';
    }
    const busy = b.effective.length - this.pending().length;
    const sum = this.t.basketSum(b.effective.length, formatSize(b.size));
    return busy > 0 ? `${sum} · ${this.t.basketRemoving(busy)}` : sum;
  });

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.canvas().nativeElement;
      const measure = () => {
        this.width.set(Math.max(100, Math.floor(el.clientWidth)));
        this.height.set(Math.max(100, Math.floor(el.clientHeight)));
      };
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        destroy.onDestroy(() => ro.disconnect());
      }
    });
    // colours follow the colour scheme (read once the scheme's variables are set)
    effect(() => {
      this.theme.applied();
      untracked(() =>
        setTimeout(() => {
          const style = getComputedStyle(document.documentElement);
          this.palette.set(readPalette((name) => style.getPropertyValue(name)));
        }),
      );
    });
  }

  private drawArc(arc: Arc, i: number, p: UsagePalette): Drawn {
    const r = this.ring();
    const r0 = r * arc.depth;
    const r1 = r0 + r - 1;
    const fill = fillOf(arc, p);
    const span = arc.a1 - arc.a0;
    const mid = (arc.a0 + arc.a1) / 2;
    const radius = (r0 + r1) / 2;
    const text = nameOf(arc.node);
    // horizontal text must stay inside its ring: the further it is from 12/6 o'clock, the
    // less of the ring's thickness it may cross (and never longer than the arc)
    const room = Math.min(span * radius, (r - 4) / Math.max(0.15, Math.abs(Math.sin(mid))));
    const chars = Math.floor(room / 6.5);
    const fits = chars >= 4 && arc.depth <= 2;
    return {
      key: `a${i}-${arc.node.id}-${arc.node.kind}`,
      shape: arc,
      d: arcPath(this.cx(), this.cy(), r0, r1, arc.a0, arc.a1),
      fill: hex(fill),
      label: fits
        ? {
            x: this.cx() + radius * Math.sin(mid),
            y: this.cy() - radius * Math.cos(mid),
            text: clip(text, chars),
            color: labelOn(fill),
          }
        : null,
    };
  }

  private drawTile(tile: Tile, i: number, p: UsagePalette): Drawn {
    const fill = fillOf(tile, p);
    const text = nameOf(tile.node);
    const fits = tile.w > 40 && tile.h > 16;
    return {
      key: `t${i}-${tile.node.id}-${tile.node.kind}`,
      shape: tile,
      rect: { x: tile.x, y: tile.y, w: Math.max(0, tile.w), h: Math.max(0, tile.h) },
      fill: hex(fill),
      label:
        fits && (tile.node.kind !== 'dir' || tile.depth === TILE_LABEL_DEPTH)
          ? {
              x: tile.x + tile.w / 2,
              y: tile.node.kind === 'dir' ? tile.y + 9 : tile.y + tile.h / 2,
              text: clip(text, Math.floor(tile.w / 6.5)),
              color: labelOn(fill),
            }
          : null,
    };
  }

  protected isRemoving(shape: Shape): boolean {
    return this.removingIds().has(shape.node.id) || this.removingIds().has(shape.parent);
  }

  /** Nodes being taken away, and everything drawn inside them (shapes come parents first). */
  private readonly removingIds = computed<ReadonlySet<number>>(() => {
    const paths = this.removing();
    const ids = new Set<number>();
    if (paths.size === 0) {
      return ids;
    }
    for (const d of this.drawn()) {
      const n = d.shape.node;
      if ((n.path !== null && paths.has(n.path)) || ids.has(d.shape.parent)) {
        if (!d.shape.virtual) {
          ids.add(n.id);
        }
      }
    }
    return ids;
  });

  protected enter(d: Drawn, evt: PointerEvent): void {
    this.hover.set(d);
    this.move(evt);
  }

  protected move(evt: PointerEvent): void {
    const box = this.canvas().nativeElement.getBoundingClientRect();
    this.pointer.set({ x: evt.clientX - box.left, y: evt.clientY - box.top });
  }

  /** Click: a folder opens in the list, a file of the shown level gets the cursor. */
  protected pick(shape: Shape): void {
    const n = shape.node;
    const side = this.side();
    if (shape.virtual) {
      return;
    }
    if (n.kind === 'dir') {
      void this.usage.goTo(this.scanId(), n.id);
    } else if (shape.depth === 1 && n.path !== null) {
      this.ws.panel(side)?.store.setCursor(n.path);
    }
    this.ws.setActive(side);
    this.ws.requestFocus(side);
  }

  protected up(): void {
    if (this.canUp()) {
      void this.usage.up(this.scanId());
      this.ws.setActive(this.side());
      this.ws.requestFocus(this.side());
    }
  }

  protected setKind(kind: 'sunburst' | 'treemap'): void {
    this.settings.set('diskUsage.chart', kind);
  }

  protected unmark(id: number): void {
    this.usage.unmark(this.scanId(), id);
  }

  protected clear(): void {
    this.usage.clearBasket(this.scanId());
  }

  /** "Remove…": the normal delete of the disk-usage side (dialog, trash, F8 rules). */
  protected remove(): void {
    this.ws.setActive(this.side());
    void this.actions.run('OPEN_DELETE_DLG');
  }
}

/** Folder tiles are labelled at their top on the first level. */
const TILE_LABEL_DEPTH = 1;

function nameOf(n: UsageNode): string {
  if (n.kind === 'files') {
    return USAGE_TEXTS.smallFiles(n.files);
  }
  if (n.kind === 'rest') {
    return USAGE_TEXTS.rest(n.files);
  }
  return n.name || USAGE_TEXTS.selection;
}

function clip(text: string, max: number): string {
  if (max < 2) {
    return '';
  }
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}
