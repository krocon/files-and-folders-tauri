import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { SearchHit } from '../../core/search/search.models';
import { Side } from '../../core/session/session.models';
import { formatModified, formatSize } from '../../shared/format';
import { SearchStore } from '../search/search.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { markedGroups, shownDecision } from './duplicates-rules';
import { DUP_TEXTS } from './duplicates-texts';
import { DuplicatesStore } from './duplicates.store';

interface Tile {
  readonly row: SearchHit;
  readonly decision: string;
  readonly kind: string;
  readonly reason: string;
  readonly meta: string;
}

/**
 * The group under the cursor of a duplicate tab (design 042 E1), shown in the other panel
 * like the disk-usage chart: a tile per file – picture (images, a comic's title page) or
 * icon, decision, name, folder, size, date, pixels. A click puts the list cursor there;
 * the list stays the place to work (Space, Enter, F8) – tiles take no focus.
 */
@Component({
  selector: 'app-duplicate-group-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="view" role="region" [attr.aria-label]="t.groupRegion">
      @if (group(); as g) {
        <div class="head">
          <strong>{{ t.groupOf(g.number, g.total) }}</strong>
          <span class="muted">{{ g.size }}</span>
          <span class="grow"></span>
          <button type="button" class="btn small" (click)="keep()">{{ t.keepThis }}</button>
        </div>
        <ul class="tiles">
          @for (tile of g.tiles; track tile.row.path) {
            <li
              class="tile"
              [class.cursor]="tile.row.path === g.cursor"
              [class.goes]="tile.kind === 'delete'"
            >
              <!-- the list is the place to work: no tab stop here (design 042 E1) -->
              <button
                type="button"
                class="pic"
                tabindex="-1"
                [attr.aria-label]="tile.row.name"
                (click)="goTo(tile.row.path)"
              >
                @if (thumb(tile.row.path); as url) {
                  <img
                    [src]="url"
                    alt=""
                    draggable="false"
                    (error)="dup.thumbFailed(tile.row.path)"
                  />
                } @else {
                  <i class="fa fa-file-o" aria-hidden="true"></i>
                }
              </button>
              <div class="badge" [attr.data-kind]="tile.kind">
                {{ tile.decision }}
                @if (tile.reason) {
                  <span class="muted">· {{ tile.reason }}</span>
                }
              </div>
              <div class="name" [attr.title]="tile.row.path">{{ tile.row.name }}</div>
              <div class="muted path" [attr.title]="tile.row.dir">{{ tile.row.dir }}</div>
              <div class="muted">{{ tile.meta }}</div>
            </li>
          }
        </ul>
      } @else {
        <p class="empty">{{ t.noGroup }}</p>
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
    .view {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
    }
    .head {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-1) var(--spacing-2);
      border-bottom: var(--border-width) solid var(--color-border);
    }
    .grow {
      flex: 1;
    }
    .btn.small {
      min-height: 0;
      min-width: 0;
      padding: 0 var(--spacing-2);
      line-height: inherit;
    }
    .tiles {
      list-style: none;
      margin: 0;
      padding: var(--spacing-2);
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
      gap: var(--spacing-2);
      overflow: auto;
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      padding: var(--spacing-1);
      border: var(--border-width) solid var(--color-border);
      border-radius: var(--radius-sm);
    }
    .tile.cursor {
      outline: var(--focus-ring-width) solid var(--color-accent);
    }
    .tile.goes .pic {
      opacity: 0.55;
    }
    .pic {
      height: 8rem;
      width: 100%;
      padding: 0;
      border: 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-surface);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .pic img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .pic .fa {
      font-size: 2.5rem;
      color: var(--color-muted);
    }
    .badge {
      font-weight: 600;
    }
    .badge[data-kind='delete'] {
      color: var(--color-danger);
    }
    .name,
    .path {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .muted {
      color: var(--color-muted);
      font-weight: normal;
    }
    .empty {
      margin: var(--spacing-3);
      color: var(--color-muted);
    }
  `,
})
export class DuplicateGroupView {
  /** The side whose duplicate tab is shown. */
  readonly side = input.required<Side>();
  protected readonly t = DUP_TEXTS;
  private readonly ws = inject(WorkspaceStore);
  protected readonly dup = inject(DuplicatesStore);
  private readonly search = inject(SearchStore);

  private readonly key = computed(() => this.ws.panel(this.side())?.store.searchKey() ?? null);

  protected readonly group = computed(() => {
    const store = this.ws.panel(this.side())?.store;
    const key = this.key();
    if (!store || !key) {
      return null;
    }
    const rows = (this.search.results().get(key)?.hits ?? []) as readonly SearchHit[];
    const cursor = store.cursorPath();
    const at = rows.find((r) => r.path === cursor);
    if (at?.group === undefined) {
      return null;
    }
    const marks = store.marked();
    const groups = markedGroups(rows, marks);
    this.dup.decided(); // reasons follow the rules
    const members = rows.filter((r) => r.group === at.group);
    const tiles: Tile[] = members.map((row) => {
      const d = shownDecision(
        row,
        marks.has(row.path),
        groups.has(at.group!),
        this.dup.decisionOf(key, row.path),
      );
      const parts = [formatSize(row.size), formatModified(row.modifiedMs)];
      if (row.width !== undefined && row.height !== undefined) {
        parts.push(`${row.width} × ${row.height}`);
      }
      if (row.pages !== undefined) {
        parts.push(DUP_TEXTS.pages(row.pages));
      }
      if (row.distance !== undefined) {
        parts.push(DUP_TEXTS.distance(row.distance));
      }
      return {
        row,
        kind: d?.decision ?? '',
        decision: d ? (DUP_TEXTS.decision[d.decision] ?? d.decision) : '',
        reason: d ? this.dup.reasonLabel(key, d.reason) : '',
        meta: parts.join(' · '),
      };
    });
    const total = new Set(rows.map((r) => r.group)).size;
    return {
      number: at.group,
      total,
      cursor,
      size: formatSize(members[0]?.size ?? null),
      tiles,
    };
  });

  constructor() {
    effect(() => {
      const g = this.group();
      if (g) {
        untracked(() => this.dup.wantThumbs(g.tiles.map((t) => t.row.path)));
      }
    });
  }

  protected thumb(path: string): string | null {
    return this.dup.thumbs().get(path) ?? null;
  }

  protected goTo(path: string): void {
    this.ws.panel(this.side())?.controller()?.moveCursorTo(path);
  }

  protected keep(): void {
    this.dup.keepThis(this.side());
  }
}
