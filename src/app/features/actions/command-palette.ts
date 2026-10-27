import { ACT_TEXTS } from './actions-texts';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  effect,
  OnDestroy,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { ACTION_IDS, ACTIONS, ActionId, CATEGORY_LABELS } from '../../core/actions/action-catalog';
import {
  hasCommandModifier,
  isFunctionKey,
  strokeFromEvent,
  strokeToString,
} from '../../core/actions/shortcut';
import { describeFsError } from '../../core/fs/fs-error';
import { iconFor } from '../../core/file-icon/file-icon.service';
import { PaletteHit } from '../../core/palette/palette.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { formatSize } from '../../shared/format';
import { ThemeService } from '../../core/theme/theme.service';
import { THEME_TEXTS } from '../themes/theme-texts';
import { fuzzyMatch } from './fuzzy';
import { WorkspaceStore } from '../workspace/workspace.store';
import { PreviewContent } from '../preview/preview-content';
import { DEFAULT_CONTEXT, PreviewContext } from '../preview/preview-providers';
import { HIT_ACTION_IDS, HIT_ACTIONS, hitActionFor } from '../palette/palette-actions';
import {
  buildRows,
  GroupId,
  highlight,
  isSelectable,
  ItemRow,
  nearestSelectable,
  nextSelectable,
  PaletteRow,
  shortPath,
  visibleWindow,
} from '../palette/palette-logic';
import { hasFilter, matchesPath } from '../palette/palette-query';
import { HitAction, PaletteStore } from '../palette/palette.store';
import { PALETTE_TEXTS } from '../palette/palette-texts';

/** Height of one row of the list (px) – the list is virtualised (design 043 E5). */
export const ROW_HEIGHT = 30;
const MAX_FOLDERS = 300;
const TOOLS_CATEGORY = 'Tools';

/**
 * "Command Palette" (Mod+Shift+P) – the entry to everything (design 043): actions,
 * known folders and files from Rust (index, live walk) in one virtualised list with
 * groups; a hit has its own actions (Tab/→, or the keys of the panel actions: F5 copies
 * it, F3 previews …). "Call action" (F10) and "Open with tool" use the same component
 * with actions or tools only. APG combobox with listbox; Enter runs, Esc closes.
 */
@Component({
  selector: 'app-command-palette',
  imports: [Modal, PreviewContent],
  template: `
    <app-modal
      [heading]="heading() ?? t.commandPalette"
      [width]="universal() && palette.previewOn() ? '64rem' : '44rem'"
      (closed)="close()"
    >
      <input
        data-autofocus
        class="query"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        [attr.aria-controls]="subOpen() ? subId : listId"
        [attr.aria-activedescendant]="activeDescendant()"
        [attr.aria-describedby]="universal() ? hintId : null"
        [placeholder]="
          scope() === 'tools' ? t.searchTools : universal() ? p.placeholder : t.searchActions
        "
        spellcheck="false"
        autocomplete="off"
        [value]="query()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
      />
      <div class="body">
        @if (subOpen() && subHit(); as hit) {
          <div
            class="sub"
            role="listbox"
            [id]="subId"
            [attr.aria-label]="p.hitActionsFor(hit.name)"
          >
            <div class="sub-head" role="presentation">
              <i [class]="icon(hit)" aria-hidden="true"></i> {{ hit.name }}
            </div>
            @for (a of subItems(); track a.action; let i = $index) {
              <div
                role="option"
                class="option"
                [id]="subId + '-' + i"
                [class.active]="i === subActive()"
                [attr.aria-selected]="i === subActive()"
                [attr.aria-disabled]="a.ready ? null : 'true'"
                [class.unavailable]="!a.ready"
                [attr.data-sub]="i"
              >
                <span class="label">{{ a.label }}</span>
                @if (a.shortcut) {
                  <kbd>{{ a.shortcut }}</kbd>
                }
              </div>
            }
          </div>
        }
        <div
          #list
          class="list"
          role="listbox"
          [hidden]="subOpen()"
          [id]="listId"
          [attr.aria-label]="t.actions"
          [attr.aria-busy]="palette.loading()"
          (scroll)="onScroll()"
        >
          <div class="spacer" [style.height.px]="rows().length * rowHeight">
            <div class="window" [style.transform]="'translateY(' + win().first * rowHeight + 'px)'">
              @for (r of windowRows(); track r.row.key) {
                @switch (r.row.kind) {
                  @case ('header') {
                    <div class="head" role="presentation">
                      <span>{{ groupLabel(r.row.group) }}</span>
                      <span class="count">{{ headerCount(r.row) }}</span>
                    </div>
                  }
                  @case ('more') {
                    <div
                      role="option"
                      class="option more"
                      [id]="optionId(r.index)"
                      [class.active]="r.index === activeIndex()"
                      [attr.aria-selected]="r.index === activeIndex()"
                      [attr.data-index]="r.index"
                    >
                      {{ p.more(r.row.hidden) }}
                    </div>
                  }
                  @case ('hit') {
                    <div
                      role="option"
                      class="option hit-row"
                      [id]="optionId(r.index)"
                      [class.active]="r.index === activeIndex()"
                      [class.marked]="palette.marked().has(r.row.hit.path)"
                      [attr.aria-selected]="r.index === activeIndex()"
                      [attr.aria-setsize]="rows().length"
                      [attr.aria-posinset]="r.index + 1"
                      [attr.data-index]="r.index"
                      [attr.title]="r.row.hit.path"
                    >
                      <span class="label">
                        <i [class]="icon(r.row.hit)" aria-hidden="true"></i>
                        <span class="name">
                          @for (part of nameParts(r.row.hit); track $index) {
                            <span [class.hit]="part.hit">{{ part.text }}</span>
                          }
                        </span>
                        <span class="dir">{{ short(r.row.hit.dir) }}</span>
                      </span>
                      <span class="meta">
                        @if (r.row.hit.size !== null && r.row.hit.kind !== 'directory') {
                          <span class="cat">{{ size(r.row.hit.size) }}</span>
                        }
                        <span class="more-actions" aria-hidden="true">›</span>
                      </span>
                    </div>
                  }
                  @default {
                    @if (asItem(r.row); as row) {
                      <div
                        role="option"
                        class="option"
                        [id]="optionId(r.index)"
                        [class.active]="r.index === activeIndex()"
                        [class.unavailable]="!row.ready"
                        [attr.aria-selected]="r.index === activeIndex()"
                        [attr.aria-disabled]="row.ready ? null : 'true'"
                        [attr.aria-setsize]="rows().length"
                        [attr.aria-posinset]="r.index + 1"
                        [attr.data-index]="r.index"
                        [attr.title]="row.kind === 'folder' ? row.id : null"
                      >
                        <span class="label">
                          @if (row.kind === 'folder') {
                            <i class="fa fa-folder" aria-hidden="true"></i>
                          }
                          <span class="name">
                            @for (part of row.parts; track $index) {
                              <span [class.hit]="part.hit">{{ part.text }}</span>
                            }
                          </span>
                        </span>
                        <span class="meta">
                          @if (row.hint) {
                            <span class="hint">{{ row.hint }}</span>
                          } @else {
                            <span class="cat">{{ row.category }}</span>
                          }
                          @if (row.shortcut) {
                            <kbd>{{ row.shortcut }}</kbd>
                          }
                        </span>
                      </div>
                    }
                  }
                }
              }
            </div>
          </div>
          @if (rows().length === 0) {
            <div class="option empty" role="option" aria-selected="false" aria-disabled="true">
              {{
                palette.loading()
                  ? p.searching
                  : scope() === 'tools'
                    ? t.noTool
                    : universal() && query().trim()
                      ? p.noHits
                      : t.noAction
              }}
            </div>
          }
        </div>
        @if (universal() && palette.previewOn()) {
          <aside
            class="preview"
            [attr.aria-label]="p.previewTitle"
            [attr.aria-busy]="palette.previewLoading()"
          >
            @if (palette.active(); as hit) {
              <div class="preview-head" [attr.title]="hit.path">{{ hit.name }}</div>
              @if (palette.previewError(); as e) {
                <p class="note">{{ describe(e) }}</p>
              } @else if (palette.preview(); as pv) {
                <app-preview-content [preview]="pv" [context]="previewContext" />
              } @else if (!palette.previewLoading()) {
                <p class="note">{{ p.previewNone }}</p>
              }
            } @else {
              <p class="note">{{ p.previewNone }}</p>
            }
          </aside>
        }
      </div>
      @if (universal()) {
        <div class="foot">
          <span class="status" [class.busy]="palette.loading()">{{ statusText() }}</span>
          <span class="hint" [id]="hintId">{{ p.hitActionsHint }} · {{ p.previewHint }}</span>
        </div>
        <p class="sr-only" aria-live="polite">{{ liveText() }}</p>
      }
    </app-modal>
  `,
  styleUrl: './command-palette.css',
  host: {
    '(pointerdown)': 'onPointerDown($event)',
    '(click)': 'onClick($event)',
    '(contextmenu)': 'onContextMenu($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPalette implements OnInit, OnDestroy {
  protected readonly t = ACT_TEXTS;
  protected readonly p = PALETTE_TEXTS;
  /** `null`: the palette's own heading (follows the language). */
  readonly heading = input<string | null>(null);
  readonly scope = input<'all' | 'tools'>('all');
  protected readonly actions = inject(ActionService);
  protected readonly dialogs = inject(DialogService);
  protected readonly palette = inject(PaletteStore);
  private readonly theme = inject(ThemeService);
  private readonly ws = inject(WorkspaceStore);
  protected readonly listId = 'fnf-palette-list';
  protected readonly subId = 'fnf-palette-sub';
  protected readonly hintId = 'fnf-palette-hint';
  protected readonly rowHeight = ROW_HEIGHT;
  protected readonly previewContext: PreviewContext = {
    ...DEFAULT_CONTEXT,
    compact: true,
    wrap: true,
  };
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  /** Without a palette query (F10, tools) the text lives here. */
  private readonly localQuery = signal('');
  protected readonly active = signal(0);
  protected readonly expanded = signal<ReadonlySet<GroupId>>(new Set());
  protected readonly subOpen = signal(false);
  protected readonly subActive = signal(0);
  private readonly scrollTop = signal(0);
  private readonly viewport = signal(0);

  /** The universal palette (not "Call action" or "Open with tool"). */
  protected readonly universal = computed(() => this.scope() === 'all' && this.heading() === null);
  protected readonly query = computed(() =>
    this.universal() ? this.palette.text() : this.localQuery(),
  );

  constructor() {
    // the store's active hit follows the list (preview, hit actions)
    effect(() => {
      const row = this.activeRow();
      const hit = this.universal() && row?.kind === 'hit' ? row.hit : null;
      untracked(() => {
        if (this.palette.active() !== hit) {
          this.palette.active.set(hit);
        }
      });
    });
  }

  ngOnInit(): void {
    // the store is shared: a fresh start each time the universal palette opens
    if (this.universal()) {
      this.palette.opened();
    }
  }

  ngOnDestroy(): void {
    if (this.universal()) {
      this.palette.closed();
    }
  }

  /** Actions, tools and colour schemes for the typed text, best first. */
  private readonly itemRows = computed<ItemRow[]>(() => {
    const universal = this.universal();
    const parsed = this.palette.parsed();
    const q = !universal
      ? this.localQuery()
      : parsed.mode === 'actions'
        ? parsed.actionText
        : parsed.plain;
    const rows: ItemRow[] = [];
    const ids = this.scope() === 'tools' ? [] : ACTION_IDS;
    for (const id of ids) {
      if (
        id === 'OPEN_COMMAND_PALETTE' ||
        id === 'OPEN_CALL_ACTION_DLG' ||
        HIT_ACTION_IDS.has(id)
      ) {
        continue;
      }
      const meta = ACTIONS[id];
      const match = fuzzyMatch(q, meta.label);
      if (!match) {
        continue;
      }
      const state = this.actions.state(id);
      rows.push({
        key: id,
        id,
        kind: 'action',
        label: meta.label,
        category: CATEGORY_LABELS[meta.category],
        shortcut: this.actions.shortcutLabel(id),
        ready: state === 'ready',
        hint: state === 'unavailable' ? `prompt ${meta.availableIn}` : '',
        score: match.score + (state === 'unavailable' ? -100 : 0),
        parts: split(meta.label, match.positions),
      });
    }
    for (const x of this.actions.extras()) {
      // "Open with tool…" lists the tools only, not the starter entries (design 032)
      if (this.scope() === 'tools' && !x.id.startsWith('tool:')) {
        continue;
      }
      const match = fuzzyMatch(q, x.label);
      if (!match) {
        continue;
      }
      rows.push({
        key: `extra:${x.id}`,
        kind: 'extra',
        id: x.id,
        label: x.label,
        category: x.category ?? TOOLS_CATEGORY,
        shortcut: this.actions.extraShortcutLabel(x.id),
        ready: x.enabled(),
        hint: '',
        score: match.score,
        parts: split(x.label, match.positions),
      });
    }
    const themes = this.scope() === 'tools' ? [] : this.theme.themes();
    for (const th of themes) {
      const label = THEME_TEXTS.paletteEntry(th.name);
      const match = fuzzyMatch(q, label);
      if (!match) {
        continue;
      }
      rows.push({
        key: `theme:${th.id}`,
        kind: 'theme',
        id: th.id,
        label,
        category: CATEGORY_LABELS.config,
        shortcut: '',
        ready: true,
        hint: '',
        score: match.score - 1,
        parts: split(label, match.positions),
      });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows;
  });

  /** Known folders (tabs, favourites, recent, histories) for the words; the typed path. */
  private readonly folderRows = computed<ItemRow[]>(() => {
    if (!this.universal()) {
      return [];
    }
    const q = this.palette.parsed();
    const rows: ItemRow[] = [];
    if (q.mode === 'path' && q.path) {
      rows.push(this.folderRow(q.path, this.p.goTo(q.path), 1000));
    }
    if (q.mode === 'files') {
      for (const path of this.folders()) {
        if (matchesPath(q, path, this.palette.status().roots)) {
          rows.push(this.folderRow(path, path, 0));
        }
      }
    }
    return rows;
  });

  private folderRow(id: string, label: string, score: number): ItemRow {
    return {
      key: `folder:${id}`,
      kind: 'folder',
      id,
      label,
      category: this.t.folders,
      shortcut: '',
      ready: true,
      hint: '',
      score,
      parts: [{ text: shortPath(label, 80), hit: false }],
    };
  }

  protected readonly rows = computed<PaletteRow[]>(() => {
    if (!this.universal()) {
      return this.itemRows().map((r) => ({ ...r, group: 'actions' as const }));
    }
    const query = this.palette.parsed();
    return buildRows({
      query,
      actions: this.itemRows(),
      folders: this.folderRows(),
      hits: this.palette.hits(),
      expanded: this.expanded(),
      actionsMatch: query.mode === 'actions' || (query.mode === 'files' && !hasFilter(query)),
    });
  });

  /** Known folders, each once: tabs of both sides, their histories, favourites, recent. */
  private readonly folders = computed<string[]>(() => {
    const panels = this.ws.panels();
    const tabs = [...panels.left.tabs, ...panels.right.tabs].filter((t) => !t.search);
    const all = [
      ...tabs.map((t) => t.path),
      ...[...this.ws.favorites()],
      ...this.ws.recent(),
      ...tabs.flatMap((t) => t.history),
    ];
    return [...new Set(all.filter((p): p is string => !!p))].slice(0, MAX_FOLDERS);
  });

  protected readonly win = computed(() =>
    visibleWindow(this.scrollTop(), this.viewport(), ROW_HEIGHT, this.rows().length),
  );

  /** Only the rows in view are in the DOM (and always the active one). */
  protected readonly windowRows = computed(() => {
    const { first, count } = this.win();
    const rows = this.rows();
    return rows.slice(first, first + count).map((row, k) => ({ row, index: first + k }));
  });

  /** The active row clamped to a selectable one. */
  protected readonly activeIndex = computed(() => {
    const rows = this.rows();
    const i = Math.min(this.active(), rows.length - 1);
    return i < 0 ? -1 : isSelectable(rows[i]) ? i : nearestSelectable(rows, i);
  });

  protected readonly activeRow = computed(() => this.rows()[this.activeIndex()] ?? null);

  protected readonly activeDescendant = computed(() => {
    if (this.subOpen()) {
      return `${this.subId}-${this.subActive()}`;
    }
    const i = this.activeIndex();
    const { first, count } = this.win();
    return i >= first && i < first + count ? this.optionId(i) : null;
  });

  protected readonly subHit = computed<PaletteHit | null>(() => {
    const row = this.activeRow();
    return row?.kind === 'hit' ? row.hit : null;
  });

  protected readonly subItems = computed(() =>
    HIT_ACTIONS.map((a) => ({
      action: a.action,
      label: ACTIONS[a.id].label,
      shortcut: this.actions.shortcutLabel(a.via[0]),
      ready: this.palette.can(a.action),
    })),
  );

  protected readonly statusText = computed(() => {
    const s = this.palette.status();
    const st = this.palette.stats();
    const n = this.palette.hits().length;
    const parts: string[] = [];
    if (this.palette.loading()) {
      parts.push(this.p.searching);
    } else if (st) {
      parts.push(this.p.results(n), this.p.took(st.elapsedMs));
    }
    const marked = this.palette.marked().size;
    if (marked) {
      parts.push(this.p.marked(marked));
    }
    parts.push(
      s.state === 'ready'
        ? s.truncated
          ? this.p.index.truncated
          : this.p.index.ready(s.entries)
        : this.p.index[s.state],
    );
    if (this.palette.message()) {
      parts.push(this.palette.message()!);
    }
    return parts.join(' · ');
  });

  protected readonly liveText = computed(() =>
    this.palette.loading() ? '' : this.p.results(this.rows().filter(isSelectable).length),
  );

  protected groupLabel(g: GroupId): string {
    return g === 'actions'
      ? this.p.groupActions
      : g === 'folders'
        ? this.p.groupFolders
        : this.palette.parsed().mode === 'path'
          ? this.p.groupEntries
          : this.p.groupFiles;
  }

  protected headerCount(row: Extract<PaletteRow, { kind: 'header' }>): string {
    const st = this.palette.stats();
    const total = row.group === 'files' && st ? Math.max(row.total, st.matched) : row.total;
    return this.p.counted(row.total, total);
  }

  protected asItem(row: PaletteRow): ItemRow | null {
    return row.kind === 'action' ||
      row.kind === 'extra' ||
      row.kind === 'theme' ||
      row.kind === 'folder'
      ? row
      : null;
  }

  protected icon(hit: PaletteHit): string {
    return iconFor(hit);
  }

  protected nameParts(hit: PaletteHit): { text: string; hit: boolean }[] {
    return highlight(hit.name, hit.ranges);
  }

  protected short(dir: string): string {
    return shortPath(dir, 56);
  }

  protected size(bytes: number): string {
    return formatSize(bytes);
  }

  protected describe = describeFsError;

  /** Keep the focus in the input when an option is clicked. */
  protected onPointerDown(evt: PointerEvent): void {
    if ((evt.target as Element | null)?.closest?.('[role="option"]')) {
      evt.preventDefault();
    }
  }

  protected onClick(evt: MouseEvent): void {
    const target = evt.target as Element | null;
    const sub = target?.closest?.<HTMLElement>('[data-sub]');
    if (sub) {
      void this.runSub(Number(sub.dataset['sub']));
      return;
    }
    const option = target?.closest?.<HTMLElement>('[data-index]');
    if (option) {
      this.setActive(Number(option.dataset['index']));
      this.choose(Number(option.dataset['index']));
    }
  }

  /** Right click on a hit: its actions. */
  protected onContextMenu(evt: MouseEvent): void {
    const option = (evt.target as Element | null)?.closest?.<HTMLElement>('[data-index]');
    if (option) {
      evt.preventDefault();
      this.setActive(Number(option.dataset['index']));
      this.openSub();
    }
  }

  protected optionId(i: number): string {
    return `${this.listId}-${i}`;
  }

  protected onInput(evt: Event): void {
    const value = (evt.target as HTMLInputElement).value;
    this.subOpen.set(false);
    this.expanded.set(new Set());
    if (this.universal()) {
      this.palette.setText(value);
    } else {
      this.localQuery.set(value);
    }
    this.setActive(0, true);
  }

  protected onScroll(): void {
    const el = this.list()?.nativeElement;
    if (el) {
      this.scrollTop.set(el.scrollTop);
      this.viewport.set(el.clientHeight);
    }
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (this.subOpen()) {
      this.onSubKey(evt);
      return;
    }
    const rows = this.rows();
    const i = this.activeIndex();
    const row = this.activeRow();
    const input = evt.target as HTMLInputElement;
    const noMods = !evt.ctrlKey && !evt.metaKey && !evt.altKey && !evt.shiftKey;
    switch (evt.key) {
      case 'ArrowDown':
        if (!evt.altKey && !evt.ctrlKey && !evt.metaKey) {
          this.move(nextSelectable(rows, i, 1));
          evt.preventDefault();
          return;
        }
        break;
      case 'ArrowUp':
        if (!evt.altKey && !evt.ctrlKey && !evt.metaKey) {
          this.move(nextSelectable(rows, i < 0 ? 0 : i, -1));
          evt.preventDefault();
          return;
        }
        break;
      case 'PageDown':
        this.move(nearestSelectable(rows, Math.min(rows.length - 1, i + this.pageRows())));
        evt.preventDefault();
        return;
      case 'PageUp':
        this.move(nearestSelectable(rows, Math.max(0, i - this.pageRows())));
        evt.preventDefault();
        return;
      case 'Enter':
        if (noMods) {
          this.choose(i);
          evt.preventDefault();
          return;
        }
        break;
      case 'Tab':
        if (noMods && row?.kind === 'hit') {
          this.openSub();
          evt.preventDefault();
          return;
        }
        break;
      case 'ArrowRight':
        if (
          noMods &&
          row?.kind === 'hit' &&
          input.selectionStart === input.value.length &&
          input.selectionEnd === input.value.length
        ) {
          this.openSub();
          evt.preventDefault();
          return;
        }
        break;
    }
    // the keys of the panel actions act on the hit (F5 copies it, F3 previews …)
    if (!this.universal() || (row?.kind !== 'hit' && this.palette.marked().size === 0)) {
      return;
    }
    const action = this.hitActionForKey(evt);
    if (action) {
      evt.preventDefault();
      evt.stopPropagation();
      void this.palette.runAction(action);
    }
  }

  /** The hit action of a key (a panel action's shortcut); plain typing keys never. */
  private hitActionForKey(evt: KeyboardEvent): HitAction | null {
    const platform = this.actions.platform();
    const stroke = strokeFromEvent(evt, platform);
    if (!stroke) {
      return null;
    }
    const typing =
      !hasCommandModifier(stroke) && !isFunctionKey(stroke.key) && stroke.key !== 'Insert';
    if (typing) {
      return null;
    }
    const id = this.actions.keymap().lookup.get(strokeToString(stroke)) as ActionId | undefined;
    return id ? hitActionFor(id) : null;
  }

  private onSubKey(evt: KeyboardEvent): void {
    const n = this.subItems().length;
    switch (evt.key) {
      case 'ArrowDown':
        this.subActive.set((this.subActive() + 1) % n);
        break;
      case 'ArrowUp':
        this.subActive.set((this.subActive() - 1 + n) % n);
        break;
      case 'Home':
        this.subActive.set(0);
        break;
      case 'End':
        this.subActive.set(n - 1);
        break;
      case 'Enter':
        void this.runSub(this.subActive());
        break;
      case 'Escape':
      case 'ArrowLeft':
      case 'Tab':
        this.subOpen.set(false);
        break;
      default: {
        const action = this.hitActionForKey(evt);
        if (!action) {
          return;
        }
        void this.palette.runAction(action);
        this.subOpen.set(false);
      }
    }
    evt.preventDefault();
    evt.stopPropagation();
  }

  private openSub(): void {
    if (this.activeRow()?.kind === 'hit') {
      this.subActive.set(0);
      this.subOpen.set(true);
    }
  }

  private async runSub(i: number): Promise<void> {
    const item = this.subItems()[i];
    if (!item?.ready) {
      return;
    }
    this.subOpen.set(false);
    await this.palette.runAction(item.action);
  }

  private pageRows(): number {
    return Math.max(1, Math.floor((this.viewport() || ROW_HEIGHT * 12) / ROW_HEIGHT) - 1);
  }

  protected close(): void {
    this.dialogs.close();
  }

  protected choose(i: number): void {
    const row = this.rows()[i];
    if (!row || !isSelectable(row)) {
      const trimmed = this.query().trim();
      if (
        trimmed &&
        this.scope() === 'all' &&
        this.heading() === null &&
        this.palette.parsed().mode === 'path'
      ) {
        this.navigate(trimmed);
      }
      return;
    }
    if (row.kind === 'more') {
      this.expanded.update((s) => new Set(s).add(row.group));
      return;
    }
    if (row.kind === 'hit') {
      void this.palette.runAction('open');
      return;
    }
    const { kind, id } = row;
    if (kind === 'folder') {
      this.navigate(id);
      return;
    }
    this.dialogs.close();
    // after the dialog is gone, so a dialog opened by the action is not closed again
    if (kind === 'theme') {
      void this.theme.select(id);
    } else if (kind === 'extra') {
      setTimeout(() => void this.actions.runExtra(id));
    } else {
      setTimeout(() => void this.actions.run(id as ActionId));
    }
  }

  private navigate(path: string): void {
    const side = this.ws.activeSide();
    this.dialogs.close({ restoreFocus: false });
    this.ws.setActive(side);
    this.ws.requestNavigate(side, path);
    this.ws.requestFocus(side);
  }

  private setActive(i: number, top = false): void {
    this.active.set(Math.max(0, i));
    if (top) {
      const el = this.list()?.nativeElement;
      if (el) {
        el.scrollTop = 0;
      }
      this.scrollTop.set(0);
    }
  }

  /** Moves the cursor and scrolls the virtual list so the row is in view. */
  private move(i: number): void {
    if (i < 0) {
      return;
    }
    this.setActive(i);
    const el = this.list()?.nativeElement;
    const view = el?.clientHeight || ROW_HEIGHT * 12;
    const top = i * ROW_HEIGHT;
    let scroll = this.scrollTop();
    if (top < scroll) {
      scroll = top;
    } else if (top + ROW_HEIGHT > scroll + view) {
      scroll = top + ROW_HEIGHT - view;
    }
    if (scroll !== this.scrollTop()) {
      if (el) {
        el.scrollTop = scroll;
      }
      this.scrollTop.set(scroll);
    }
  }
}

function split(text: string, positions: readonly number[]): { text: string; hit: boolean }[] {
  const hits = new Set(positions);
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i);
    const last = parts.at(-1);
    if (last && last.hit === hit) {
      last.text += text[i];
    } else {
      parts.push({ text: text[i], hit });
    }
  }
  return parts;
}
