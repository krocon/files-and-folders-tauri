import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { describeFsError } from '../../core/fs/fs-error';
import { formatSize } from '../../shared/format';
import { PreviewContent } from './preview-content';
import { previewNotes } from './preview-notes';
import { PV_TEXTS } from './preview-texts';
import { QuickViewStore } from './quick-view.store';

/** Quick view in the target panel (design 010 E4); shown by `FilePanel`. */
@Component({
  selector: 'app-quick-view',
  imports: [PreviewContent],
  template: `
    <div class="head">
      <strong>{{ t.quickViewLabel }}</strong>
      @if (q.entry(); as e) {
        <span class="name" [attr.title]="e.path">{{ e.name }}</span>
        <span class="meta">{{ meta() }}</span>
      }
    </div>
    @for (n of notes(); track n) {
      <p class="note">{{ n }}</p>
    }
    <div class="body" [attr.aria-busy]="q.loading()">
      @if (q.error(); as e) {
        <p class="note error">{{ describe(e) }}</p>
      } @else if (q.preview(); as p) {
        <app-preview-content [preview]="p" [context]="q.context" />
      } @else if (!q.loading()) {
        <p class="note">{{ t.quickViewEmpty }}</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--color-list-bg);
    }
    .head {
      display: flex;
      gap: var(--spacing-2);
      align-items: baseline;
      padding: var(--spacing-1) var(--spacing-2);
      font-size: var(--font-size-sm);
      border-bottom: var(--border-width) solid var(--color-border);
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      margin-left: auto;
      color: var(--color-muted);
      white-space: nowrap;
    }
    .note {
      margin: var(--spacing-1) var(--spacing-2);
      font-size: var(--font-size-xs);
      color: var(--color-muted);
    }
    .error {
      color: var(--color-danger);
    }
    .body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: var(--spacing-1);
    }
    app-preview-content {
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'region', '[attr.aria-label]': 't.quickViewLabel' },
})
export class QuickView {
  protected readonly q = inject(QuickViewStore);
  protected readonly t = PV_TEXTS;
  protected readonly describe = describeFsError;
  protected readonly notes = computed(() =>
    previewNotes(this.q.preview(), this.q.entry()?.name ?? ''),
  );
  protected readonly meta = computed(() => {
    const p = this.q.preview();
    return p && p.kind !== 'directory' && p.kind !== 'other'
      ? `${p.format.label} · ${formatSize(p.size)}`
      : p?.kind === 'directory'
        ? this.t.folder
        : '';
  });
}
