import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  FileType,
  IconColorGroup,
  MAX_EXTENSIONS,
  MAX_FILE_TYPE_LABEL,
  MAX_FILE_TYPES,
} from '../../core/config/config.models';
import {
  FILE_TYPE_ICONS,
  fileTypeProblems,
  ICON_COLOR_GROUPS,
  parseExtensions,
} from '../../core/file-icon/file-types-logic';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { moveSlot, removeSlot } from './button-config-logic';
import { CONFIG_TEXTS, fileTypeLabel } from './config-texts';
import { FileTypesStore } from './file-types.store';

/** A category being edited: extensions as typed. */
interface Draft {
  readonly label: string;
  readonly text: string;
  readonly icon: string;
  readonly color: IconColorGroup | null;
}

function toDraft(t: FileType): Draft {
  return {
    label: t.label,
    text: t.extensions.join(' '),
    icon: t.icon ?? 'fa-file-o',
    color: t.color,
  };
}

/**
 * File types (OPEN_FILETYPE_CONFIG_DLG, design 022 E12): categories with extensions,
 * icon and colour; a draft that "Save" writes to `filetypes.json`.
 */
@Component({
  selector: 'app-file-types-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.typesTitle" width="48rem" (closed)="dialogs.close()">
      <div class="tool">
        <div class="body">
          <p class="intro">{{ t.typesIntro }}</p>
          <div class="editor">
            <div class="field side">
              <span [id]="listLabelId">{{ t.categories }}</span>
              <ul
                class="listbox"
                role="listbox"
                tabindex="0"
                data-autofocus
                [attr.aria-labelledby]="listLabelId"
                [attr.aria-describedby]="listHelpId"
                [attr.aria-activedescendant]="rows().length ? rowId(cursor()) : null"
                (keydown)="onListKey($event)"
                (click)="onRowClick($event)"
              >
                @for (r of rows(); track $index; let i = $index) {
                  <li
                    role="option"
                    [id]="rowId(i)"
                    [attr.aria-selected]="i === cursor()"
                    [attr.aria-invalid]="problems()[i].length ? 'true' : null"
                    [class.invalid]="problems()[i].length > 0"
                    [attr.data-index]="i"
                  >
                    <i class="fa icon-preview" [class]="r.icon" aria-hidden="true"></i>
                    <span class="grow">{{ display(r.label) || '…' }}</span>
                    <span class="muted">{{ t.extensionCount(count(r)) }}</span>
                  </li>
                } @empty {
                  <li class="empty" role="option" aria-selected="false" aria-disabled="true">–</li>
                }
              </ul>
              <p class="help" [id]="listHelpId">{{ t.categoriesHelp }}</p>
              <div class="stack">
                <button
                  type="button"
                  class="btn"
                  [disabled]="rows().length >= maxTypes"
                  (click)="add()"
                >
                  {{ t.add }}
                </button>
                <button type="button" class="btn" [disabled]="!current()" (click)="remove()">
                  {{ t.remove }}
                </button>
                <button type="button" class="btn" [disabled]="cursor() <= 0" (click)="move(-1)">
                  {{ t.moveUp }}
                </button>
                <button
                  type="button"
                  class="btn"
                  [disabled]="cursor() >= rows().length - 1"
                  (click)="move(1)"
                >
                  {{ t.moveDown }}
                </button>
              </div>
            </div>
            @if (current(); as r) {
              <div class="side" role="group" [attr.aria-label]="display(r.label)">
                <label class="field">
                  <span>{{ t.name }}</span>
                  <input
                    type="text"
                    class="name"
                    spellcheck="false"
                    [value]="display(r.label)"
                    [attr.aria-invalid]="labelProblem() ? 'true' : null"
                    [attr.aria-describedby]="problemId"
                    (input)="patch({ label: value($event) })"
                  />
                </label>
                <label class="field">
                  <span>{{ t.extensions }}</span>
                  <textarea
                    spellcheck="false"
                    [value]="r.text"
                    [attr.aria-invalid]="extProblem() ? 'true' : null"
                    [attr.aria-describedby]="extHelpId + ' ' + problemId"
                    (input)="patch({ text: value($event) })"
                  ></textarea>
                </label>
                <p class="help" [id]="extHelpId">{{ t.extensionsHelp }}</p>
                <div class="row">
                  <label class="field grow">
                    <span>{{ t.icon }}</span>
                    <span class="inline">
                      <i class="fa icon-preview" [class]="r.icon" aria-hidden="true"></i>
                      <select (change)="patch({ icon: value($event) })">
                        @for (i of icons; track i) {
                          <option [value]="i" [selected]="i === r.icon">
                            {{ t.iconNames[i] ?? i }}
                          </option>
                        }
                      </select>
                    </span>
                  </label>
                  <label class="field grow">
                    <span>{{ t.color }}</span>
                    <select (change)="setColor(value($event))">
                      <option value="" [selected]="r.color === null">{{ t.noColor }}</option>
                      @for (c of colors; track c) {
                        <option [value]="c" [selected]="c === r.color">
                          {{ t.colorNames[c] }}
                        </option>
                      }
                    </select>
                  </label>
                </div>
                <p class="error" [id]="problemId" aria-live="polite">{{ problemText() }}</p>
              </div>
            }
          </div>
        </div>
        <p class="error" role="alert">{{ error() }}</p>
        <div class="foot">
          <button type="button" class="btn" (click)="resetDefaults()">{{ t.resetDefaults }}</button>
          <div class="buttons">
            <button type="button" class="btn" (click)="dialogs.close()">{{ t.cancel }}</button>
            <button type="button" class="btn primary" [disabled]="busy()" (click)="save()">
              {{ t.save }}
            </button>
          </div>
        </div>
      </div>
    </app-modal>
  `,
  styleUrls: ['../../shared/dialog/tool-dialog.css', './config-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTypesDialog {
  protected readonly t = CONFIG_TEXTS;
  protected readonly store = inject(FileTypesStore);
  protected readonly dialogs = inject(DialogService);
  protected readonly icons = FILE_TYPE_ICONS;
  protected readonly colors = ICON_COLOR_GROUPS;
  protected readonly maxTypes = MAX_FILE_TYPES;
  protected readonly listLabelId = 'fnf-ft-list-label';
  protected readonly listHelpId = 'fnf-ft-list-help';
  protected readonly extHelpId = 'fnf-ft-ext-help';
  protected readonly problemId = 'fnf-ft-problem';

  protected readonly rows = signal<readonly Draft[]>(this.store.categories().map(toDraft));
  protected readonly cursor = signal(0);
  protected readonly current = computed<Draft | null>(() => this.rows()[this.cursor()] ?? null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  /** The draft as the file would hold it. */
  private readonly list = computed<FileType[]>(() =>
    this.rows().map((r) => ({
      label: r.label.trim(),
      extensions: parseExtensions(r.text).extensions,
      icon: r.icon,
      color: r.color,
    })),
  );

  protected readonly problems = computed(() =>
    this.rows().map((r, i) => {
      const p: string[] = fileTypeProblems(this.list(), i).map((code) => this.problemLabel(code));
      const invalid = parseExtensions(r.text).invalid;
      if (invalid.length > 0) {
        p.push(this.t.invalidExtensions(invalid.join(' ')));
      }
      return p;
    }),
  );

  protected readonly labelProblem = computed(() =>
    fileTypeProblems(this.list(), this.cursor()).some((c) => c.startsWith('label')),
  );
  protected readonly extProblem = computed(() => {
    const r = this.current();
    return (
      !!r &&
      (parseExtensions(r.text).invalid.length > 0 ||
        fileTypeProblems(this.list(), this.cursor()).includes('tooManyExtensions'))
    );
  });
  protected readonly problemText = computed(() => (this.problems()[this.cursor()] ?? []).join(' '));

  private problemLabel(code: string): string {
    switch (code) {
      case 'labelMissing':
        return this.t.labelMissing;
      case 'labelTooLong':
        return this.t.labelTooLong(MAX_FILE_TYPE_LABEL);
      case 'labelTaken':
        return this.t.labelTaken;
      default:
        return this.t.tooManyExtensions(MAX_EXTENSIONS);
    }
  }

  protected display(label: string): string {
    return fileTypeLabel(label);
  }

  protected count(r: Draft): number {
    return parseExtensions(r.text).extensions.length;
  }

  protected rowId(i: number): string {
    return `fnf-ft-row-${i}`;
  }

  protected value(evt: Event): string {
    return (evt.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  protected patch(p: Partial<Draft>): void {
    const i = this.cursor();
    this.rows.update((rows) => rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
    this.error.set('');
  }

  protected setColor(v: string): void {
    this.patch({
      color: (ICON_COLOR_GROUPS as readonly string[]).includes(v) ? (v as IconColorGroup) : null,
    });
  }

  protected onListKey(evt: KeyboardEvent): void {
    const n = this.rows().length;
    const i = this.cursor();
    if (evt.altKey && (evt.key === 'ArrowUp' || evt.key === 'ArrowDown')) {
      evt.preventDefault();
      this.move(evt.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    const next =
      evt.key === 'ArrowDown'
        ? Math.min(n - 1, i + 1)
        : evt.key === 'ArrowUp'
          ? Math.max(0, i - 1)
          : evt.key === 'Home'
            ? 0
            : evt.key === 'End'
              ? n - 1
              : -1;
    if (next < 0 || n === 0) {
      return;
    }
    evt.preventDefault();
    this.cursor.set(next);
    setTimeout(() =>
      document.getElementById(this.rowId(next))?.scrollIntoView?.({ block: 'nearest' }),
    );
  }

  protected onRowClick(evt: MouseEvent): void {
    const li = (evt.target as Element | null)?.closest?.<HTMLElement>('[data-index]');
    if (li) {
      this.cursor.set(Number(li.dataset['index']));
    }
  }

  protected add(): void {
    const rows = this.rows();
    if (rows.length >= MAX_FILE_TYPES) {
      return;
    }
    let name = this.t.newType;
    for (let n = 2; rows.some((r) => r.label.trim().toLowerCase() === name.toLowerCase()); n++) {
      name = `${this.t.newType} ${n}`;
    }
    const at = rows.length === 0 ? 0 : this.cursor() + 1;
    this.rows.set([
      ...rows.slice(0, at),
      { label: name, text: '', icon: 'fa-file-o', color: null },
      ...rows.slice(at),
    ]);
    this.cursor.set(at);
    // the new category's name is the next thing to type
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('app-file-types-dialog input.name');
      input?.focus();
      input?.select();
    });
  }

  protected remove(): void {
    const rows = this.rows();
    if (rows.length === 0) {
      return;
    }
    this.rows.set(removeSlot(rows, this.cursor()));
    this.cursor.set(Math.max(0, Math.min(this.cursor(), rows.length - 2)));
  }

  protected move(delta: number): void {
    const rows = this.rows();
    const moved = moveSlot(rows, this.cursor(), delta);
    if (moved !== rows) {
      this.rows.set(moved);
      this.cursor.update((c) => c + delta);
    }
  }

  protected resetDefaults(): void {
    this.rows.set(this.store.builtIn.map(toDraft));
    this.cursor.set(0);
    this.error.set('');
  }

  protected async save(): Promise<void> {
    const bad = this.problems().findIndex((p) => p.length > 0);
    if (bad >= 0) {
      this.cursor.set(bad);
      this.error.set(this.t.fixProblems);
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.store.save(this.list());
      this.dialogs.close();
    } catch (err) {
      this.error.set(this.t.saveFailed(errorText(toFsError(err))));
    } finally {
      this.busy.set(false);
    }
  }
}
