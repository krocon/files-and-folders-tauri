import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ClipboardApi } from '../../core/os/clipboard';
import { describeFsError } from '../../core/fs/fs-error';
import { Properties } from '../../core/preview/preview.models';
import { Modal } from '../../shared/dialog/modal';
import { formatSize } from '../../shared/format';
import { modeOctal, modeString } from './permissions';
import { PV_TEXTS } from './preview-texts';
import { PropertiesStore } from './properties.store';
import { ActionService } from '../../core/actions/action.service';
import { AttributesStore } from '../attributes/attributes.store';

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

export interface PropertyRow {
  readonly label: string;
  readonly value: string;
}

/** Plain text for the Copy button: the name, then `label: value` per row (pure; tested). */
export function propertiesText(
  name: string,
  rows: readonly PropertyRow[],
  folderSize: string | null,
): string {
  const lines = [name, ...rows.map((r) => `${r.label}: ${r.value}`)];
  if (folderSize) {
    lines.push(`${PV_TEXTS.size}: ${folderSize}`);
  }
  return lines.join('\n');
}

/** Rows of the properties dialog (pure; tested). */
export function propertyRows(p: Properties): PropertyRow[] {
  const t = PV_TEXTS;
  const date = (ms: number | null) => (ms === null ? t.unknown : dateTime.format(new Date(ms)));
  const rows: PropertyRow[] = [
    { label: t.name, value: p.name },
    { label: t.path, value: p.path },
    {
      label: t.type,
      value:
        t.kinds[p.kind] +
        (p.targetKind ? ` → ${t.kinds[p.targetKind]}` : '') +
        (p.format ? ` · ${p.format.label}${p.format.mime ? ` (${p.format.mime})` : ''}` : ''),
    },
  ];
  if (p.linkTarget !== null) {
    rows.push({
      label: t.linkTarget,
      value: p.linkTarget + (p.targetKind === null ? ` ${t.dangling}` : ''),
    });
  }
  if (p.size !== null) {
    rows.push({ label: t.size, value: `${formatSize(p.size)} (${t.bytes(p.size)})` });
  }
  rows.push(
    { label: t.created, value: date(p.createdMs) },
    { label: t.modified, value: date(p.modifiedMs) },
    { label: t.accessed, value: date(p.accessedMs) },
  );
  if (p.unix) {
    const u = p.unix;
    rows.push(
      { label: t.permissions, value: `${modeString(u.mode)} (${modeOctal(u.mode)})` },
      { label: t.owner, value: `${u.owner ?? u.uid} : ${u.group ?? u.gid}` },
    );
  }
  if (p.windows) {
    const w = p.windows;
    const flags = [
      [w.readonly, t.readonly],
      [w.hidden, t.hidden],
      [w.system, t.system],
      [w.archive, t.archive],
    ] as const;
    rows.push({
      label: t.attributes,
      value:
        flags
          .filter(([on]) => on)
          .map(([, l]) => l)
          .join(', ') || t.unknown,
    });
  } else if (!p.unix) {
    rows.push({ label: t.readonly, value: p.readonly ? t.yes : t.no });
  }
  return rows;
}

/** Properties (Alt+Enter, design 010 E5) – read only. */
@Component({
  selector: 'app-properties-dialog',
  imports: [Modal],
  template: `
    @if (s.entry(); as entry) {
      <app-modal
        [heading]="t.propertiesTitle(entry.name)"
        width="min(40rem, 92vw)"
        (closed)="s.close()"
      >
        @if (s.props(); as p) {
          <dl class="props">
            @for (r of rows(); track r.label) {
              <dt>{{ r.label }}</dt>
              <dd>{{ r.value }}</dd>
            }
            @if (p.kind === 'directory') {
              <dt>{{ t.size }}</dt>
              <dd class="size">
                @switch (s.size().state) {
                  @case ('running') {
                    <span aria-live="polite">{{ t.calculating }}</span>
                    <button type="button" class="btn" (click)="s.cancelSize()">
                      {{ t.cancel }}
                    </button>
                  }
                  @case ('done') {
                    <span aria-live="polite">{{ sizeText() }}</span>
                  }
                  @default {
                    <button type="button" class="btn" (click)="s.calcSize()">
                      {{ t.calcSize }}
                    </button>
                    @if (sizeError(); as e) {
                      <span class="error">{{ e }}</span>
                    }
                  }
                }
              </dd>
            }
          </dl>
        } @else if (s.error(); as e) {
          <p class="error" role="alert">{{ describe(e) }} – {{ e.message }}</p>
        } @else {
          <p class="hint">{{ t.loading }}</p>
        }
        <div class="buttons">
          <span class="status" role="status">{{ copied() ? t.copied : '' }}</span>
          <button type="button" class="btn" [disabled]="!s.props()" (click)="copy()">
            {{ t.copy }}
          </button>
          @if (canChange()) {
            <button type="button" class="btn" [title]="t.changeAttributesHint" (click)="change()">
              {{ t.changeAttributes }}
            </button>
          }
          <button type="button" class="btn primary" data-autofocus (click)="s.close()">
            {{ t.close }}
          </button>
        </div>
      </app-modal>
    }
  `,
  styles: `
    .props {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--spacing-1) var(--spacing-3);
      margin: 0;
      font-size: var(--font-size-sm);
    }
    dt {
      color: var(--color-muted);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
      user-select: text;
    }
    .size {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }
    .hint {
      margin: 0;
      font-size: var(--font-size-xs);
      color: var(--color-muted);
    }
    .error {
      color: var(--color-danger);
      margin: 0;
    }
    .buttons {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: var(--spacing-2);
    }
    .status {
      margin-right: auto;
      font-size: var(--font-size-sm);
      color: var(--color-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PropertiesDialog {
  protected readonly s = inject(PropertiesStore);
  private readonly attrs = inject(AttributesStore);
  private readonly actions = inject(ActionService);
  private readonly clipboard = inject(ClipboardApi);
  protected readonly copied = signal(false);
  /** "Change…" (design 024 E1): not for links, not where the action is off (archive, unchecked). */
  protected readonly canChange = computed(() => {
    const e = this.s.entry();
    return (
      !!e && e.kind !== 'symlink' && this.actions.state('OPEN_CHANGE_ATTRIBUTES_DLG') === 'ready'
    );
  });

  /** Hands the entry over to the change-attributes dialog (the focus returns to the list). */
  protected change(): void {
    const entry = this.s.entry();
    if (entry) {
      this.s.release();
      void this.attrs.openFor([entry]);
    }
  }
  /** Copy: the shown properties as text (like About). */
  protected async copy(): Promise<void> {
    const entry = this.s.entry();
    if (!entry || !this.s.props()) {
      return;
    }
    try {
      await this.clipboard.writeText(
        propertiesText(entry.name, this.rows(), this.sizeText() || null),
      );
      this.copied.set(true);
    } catch {
      // clipboard not available – the text stays visible in the dialog
    }
  }

  protected readonly t = PV_TEXTS;
  protected readonly describe = describeFsError;
  protected readonly rows = computed(() => {
    const p = this.s.props();
    return p ? propertyRows(p) : [];
  });
  protected readonly sizeText = computed(() => {
    const st = this.s.size();
    return st.state === 'done'
      ? this.t.dirSize(st.size.bytes, st.size.files, st.size.dirs, st.size.unreadable)
      : '';
  });
  protected readonly sizeError = computed(() => {
    const st = this.s.size();
    return st.state === 'failed' && st.error ? describeFsError(st.error) : null;
  });
}
