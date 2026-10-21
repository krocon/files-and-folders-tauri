import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ACTIONS } from '../../core/actions/action-catalog';
import { ActionService } from '../../core/actions/action.service';
import { canonicalShortcut } from '../../core/actions/shortcut';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { isParentRow } from '../../core/fs/fs.models';
import {
  MAX_STARTER_ITEMS,
  StarterItem,
  StarterKind,
  StarterProblem,
} from '../../core/starter/starter.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { WorkspaceStore } from '../workspace/workspace.store';
import {
  blank,
  canIndent,
  canOutdent,
  find,
  indent,
  insert,
  move,
  newId,
  outdent,
  problemMap,
  remove,
  rows,
  sameItems,
  STARTER_PREFIX,
  update,
  walk,
} from './starter-logic';
import { STARTER_TEXTS } from './starter-texts';
import { StarterStore } from './starter.store';

type TextField = 'label' | 'program' | 'params' | 'workingDir' | 'folder' | 'shortcut';

const ICONS: Readonly<Record<StarterKind, string>> = {
  program: 'fa-play-circle-o',
  folder: 'fa-folder-o',
  submenu: 'fa-caret-square-o-right',
  separator: 'fa-minus',
};

/**
 * "Change starter menu" (OPEN_STARTER_CONFIG_DLG, design 032): a draft of the entries –
 * listbox with indentation for submenus on the left, the fields of the chosen entry on
 * the right. "Save" sends the draft to Rust, which checks it (problems come back per entry).
 */
@Component({
  selector: 'app-starter-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.title" width="54rem" (closed)="dialogs.close()">
      <div class="tool">
        <div class="body">
          <p class="intro">{{ t.intro }}</p>
          <div class="editor starter">
            <div class="field side">
              <span [id]="listLabelId">{{ t.entries }}</span>
              <ul
                class="listbox entries"
                role="tree"
                tabindex="0"
                data-autofocus
                [attr.aria-labelledby]="listLabelId"
                [attr.aria-describedby]="listHelpId"
                [attr.aria-activedescendant]="selected() ? optionId(selected()!) : null"
                (keydown)="onListKey($event)"
                (click)="onListClick($event)"
              >
                @for (r of list(); track r.item.id) {
                  <li
                    role="treeitem"
                    [id]="optionId(r.item.id)"
                    [attr.aria-selected]="r.item.id === selected()"
                    [attr.aria-level]="r.depth + 1"
                    [attr.aria-expanded]="r.item.kind === 'submenu' ? 'true' : null"
                    [attr.data-id]="r.item.id"
                    [class.invalid]="problem(r.item.id) !== null"
                    [style.padding-left.rem]="0.5 + r.depth * 1.25"
                  >
                    <i class="fa {{ icon(r.item.kind) }}" aria-hidden="true"></i>
                    @if (r.item.kind === 'separator') {
                      <span class="grow sep" aria-hidden="true"></span>
                      <span class="sr-only">{{ t.kinds.separator }}</span>
                    } @else {
                      <span class="grow">{{ r.item.label || '…' }}</span>
                      @if (r.item.kind === 'submenu') {
                        <span class="muted">({{ r.item.items?.length ?? 0 }})</span>
                      }
                      @if (r.item.shortcut) {
                        <kbd>{{ r.item.shortcut }}</kbd>
                      }
                    }
                  </li>
                } @empty {
                  <li class="empty" role="treeitem" aria-selected="false" aria-disabled="true">
                    {{ t.noEntries }}
                  </li>
                }
              </ul>
              <p class="help" [id]="listHelpId">{{ t.listHelp }}</p>
              <div class="stack" role="group" [attr.aria-label]="t.addGroup">
                <button type="button" class="btn" (click)="add('program')">
                  <i class="fa fa-plus" aria-hidden="true"></i> {{ t.kinds.program }}
                </button>
                <button type="button" class="btn" (click)="add('folder')">
                  <i class="fa fa-plus" aria-hidden="true"></i> {{ t.addFolder }}
                </button>
                <button type="button" class="btn" (click)="add('submenu')">
                  <i class="fa fa-plus" aria-hidden="true"></i> {{ t.addSubmenu }}
                </button>
                <button type="button" class="btn" (click)="add('separator')">
                  <i class="fa fa-plus" aria-hidden="true"></i> {{ t.addSeparator }}
                </button>
                <button
                  type="button"
                  class="btn"
                  [disabled]="currentFolder() === null"
                  (click)="addCurrentFolder()"
                >
                  <i class="fa fa-plus" aria-hidden="true"></i> {{ t.addCurrentFolder }}
                </button>
                <button
                  type="button"
                  class="btn"
                  [disabled]="cursorFile() === null"
                  (click)="addCursorFile()"
                >
                  <i class="fa fa-plus" aria-hidden="true"></i> {{ t.addCursorFile }}
                </button>
              </div>
              <div class="stack" role="group" [attr.aria-label]="t.arrangeGroup">
                <button type="button" class="btn" [disabled]="!selected()" (click)="moveBy(-1)">
                  <i class="fa fa-arrow-up" aria-hidden="true"></i> {{ t.moveUp }}
                </button>
                <button type="button" class="btn" [disabled]="!selected()" (click)="moveBy(1)">
                  <i class="fa fa-arrow-down" aria-hidden="true"></i> {{ t.moveDown }}
                </button>
                <button type="button" class="btn" [disabled]="!indentable()" (click)="doIndent()">
                  <i class="fa fa-indent" aria-hidden="true"></i> {{ t.indent }}
                </button>
                <button type="button" class="btn" [disabled]="!outdentable()" (click)="doOutdent()">
                  <i class="fa fa-outdent" aria-hidden="true"></i> {{ t.outdent }}
                </button>
                <button
                  type="button"
                  class="btn"
                  [disabled]="!selected()"
                  (click)="removeSelected()"
                >
                  <i class="fa fa-trash-o" aria-hidden="true"></i> {{ t.remove }}
                </button>
              </div>
            </div>
            <div class="side details" role="group" [attr.aria-label]="t.details">
              @if (item(); as it) {
                <p class="kind">
                  <i class="fa {{ icon(it.kind) }}" aria-hidden="true"></i>
                  {{ t.kinds[it.kind] }}
                </p>
                @if (problem(it.id); as p) {
                  <p class="notice" role="note" [id]="problemId">{{ p }}</p>
                }
                @if (it.kind === 'separator') {
                  <p class="help">{{ t.separatorInfo }}</p>
                } @else {
                  <label class="field title">
                    <span>{{ t.label }}</span>
                    <input
                      type="text"
                      spellcheck="false"
                      maxlength="100"
                      [value]="it.label ?? ''"
                      [attr.aria-invalid]="problemCode(it.id) === 'label' ? 'true' : null"
                      (input)="set('label', $event)"
                    />
                  </label>
                  @if (it.kind === 'submenu') {
                    <p class="help">{{ t.submenuInfo }}</p>
                  }
                  @if (it.kind === 'program') {
                    <label class="field">
                      <span>{{ t.program }}</span>
                      <input
                        type="text"
                        spellcheck="false"
                        autocomplete="off"
                        [value]="it.program ?? ''"
                        [attr.aria-invalid]="problemCode(it.id) === 'program' ? 'true' : null"
                        [attr.aria-describedby]="'fnf-starter-program-help'"
                        (input)="set('program', $event)"
                      />
                      <span class="help" id="fnf-starter-program-help">{{ t.programHelp }}</span>
                    </label>
                    <label class="field">
                      <span>{{ t.params }}</span>
                      <input
                        type="text"
                        spellcheck="false"
                        autocomplete="off"
                        [value]="it.params ?? ''"
                        [attr.aria-invalid]="paramsInvalid(it.id) ? 'true' : null"
                        [attr.aria-describedby]="'fnf-starter-params-help'"
                        (input)="set('params', $event)"
                      />
                      <span class="help" id="fnf-starter-params-help">{{ t.paramsHelp }}</span>
                    </label>
                    <label class="field">
                      <span>{{ t.workingDir }}</span>
                      <input
                        type="text"
                        spellcheck="false"
                        autocomplete="off"
                        [value]="it.workingDir ?? ''"
                        [attr.aria-invalid]="problemCode(it.id) === 'working_dir' ? 'true' : null"
                        [attr.aria-describedby]="'fnf-starter-wd-help'"
                        (input)="set('workingDir', $event)"
                      />
                      <span class="help" id="fnf-starter-wd-help">{{ t.workingDirHelp }}</span>
                    </label>
                  }
                  @if (it.kind === 'folder') {
                    <label class="field">
                      <span>{{ t.folder }}</span>
                      <input
                        type="text"
                        spellcheck="false"
                        autocomplete="off"
                        [value]="it.folder ?? ''"
                        [attr.aria-invalid]="problemCode(it.id) === 'folder' ? 'true' : null"
                        [attr.aria-describedby]="'fnf-starter-folder-help'"
                        (input)="set('folder', $event)"
                      />
                      <span class="help" id="fnf-starter-folder-help">{{ t.folderHelp }}</span>
                    </label>
                  }
                  @if (it.kind === 'program' || it.kind === 'folder') {
                    <label class="field">
                      <span>{{ t.shortcut }}</span>
                      <input
                        type="text"
                        spellcheck="false"
                        autocomplete="off"
                        [value]="it.shortcut ?? ''"
                        [attr.aria-invalid]="shortcutProblem(it) ? 'true' : null"
                        [attr.aria-describedby]="'fnf-starter-key-help'"
                        (input)="set('shortcut', $event)"
                      />
                      <span class="help" id="fnf-starter-key-help">
                        {{ shortcutProblem(it) ?? t.shortcutHelp }}
                      </span>
                    </label>
                  }
                }
              } @else {
                <p class="help">{{ t.noSelection }}</p>
              }
            </div>
          </div>
        </div>
        <p class="error" role="alert">{{ error() }}</p>
        <div class="foot">
          @if (store.file(); as f) {
            <span class="help path">{{ t.file(f) }}</span>
          }
          <div class="buttons">
            <button type="button" class="btn" (click)="dialogs.close()">{{ t.cancel }}</button>
            <button
              type="button"
              class="btn primary"
              [disabled]="busy() || !changed()"
              (click)="save()"
            >
              {{ t.save }}
            </button>
          </div>
        </div>
      </div>
    </app-modal>
  `,
  styleUrls: [
    '../../shared/dialog/tool-dialog.css',
    '../config/config-dialog.css',
    './starter-dialog.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StarterDialog {
  protected readonly t = STARTER_TEXTS;
  protected readonly store = inject(StarterStore);
  protected readonly dialogs = inject(DialogService);
  private readonly actions = inject(ActionService);
  private readonly ws = inject(WorkspaceStore);
  protected readonly listLabelId = 'fnf-starter-list-label';
  protected readonly listHelpId = 'fnf-starter-list-help';
  protected readonly problemId = 'fnf-starter-problem';

  protected readonly draft = signal<readonly StarterItem[]>(this.store.items());
  protected readonly selected = signal<string | null>(this.store.items()[0]?.id ?? null);
  /** Problems from Rust (load / last save); an edited entry loses its mark until the next save. */
  protected readonly problems = signal<readonly StarterProblem[]>(this.store.problems());
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  protected readonly list = computed(() => rows(this.draft()));
  protected readonly item = computed(() => {
    const id = this.selected();
    return id === null ? null : find(this.draft(), id);
  });
  private readonly problemById = computed(() => problemMap(this.problems()));
  protected readonly changed = computed(() => !sameItems(this.draft(), this.store.items()));
  protected readonly indentable = computed(() => {
    const id = this.selected();
    return id !== null && canIndent(this.draft(), id);
  });
  protected readonly outdentable = computed(() => {
    const id = this.selected();
    return id !== null && canOutdent(this.draft(), id);
  });

  // the panel behind the dialog: offered as quick entries
  protected readonly currentFolder = computed(() => this.ws.actionDir());
  protected readonly cursorFile = computed(() => {
    const e = this.ws.panel()?.store.cursorEntry() ?? null;
    return e && !isParentRow(e) && e.kind !== 'directory' ? e : null;
  });

  protected optionId(id: string): string {
    return `fnf-starter-opt-${id}`;
  }

  protected icon(kind: StarterKind): string {
    return ICONS[kind];
  }

  protected problemCode(id: string): string | null {
    return this.problemById().get(id) ?? null;
  }

  protected problem(id: string): string | null {
    const code = this.problemCode(id);
    return code ? (this.t.problems[code as keyof typeof this.t.problems] ?? code) : null;
  }

  protected paramsInvalid(id: string): boolean {
    const c = this.problemCode(id);
    return c === 'params_quote' || c === 'params_files' || c === 'too_long';
  }

  /** Invalid notation or a key that an action, a tool or another entry already uses. */
  protected shortcutProblem(it: StarterItem): string | null {
    const raw = it.shortcut?.trim();
    if (!raw) {
      return null;
    }
    const platform = this.actions.platform();
    const canon = canonicalShortcut(raw, platform);
    if (!canon) {
      return this.t.shortcutInvalid;
    }
    const action = this.actions.keymap().lookup.get(canon);
    if (action) {
      return this.t.shortcutTaken(ACTIONS[action].label);
    }
    const tool = this.actions
      .extras()
      .find(
        (x) =>
          !x.id.startsWith(STARTER_PREFIX) &&
          x.shortcut &&
          canonicalShortcut(x.shortcut, platform) === canon,
      );
    if (tool) {
      return this.t.shortcutTaken(tool.label);
    }
    const other = walk(this.draft()).find(
      (o) =>
        o.id !== it.id && o.shortcut && canonicalShortcut(o.shortcut.trim(), platform) === canon,
    );
    return other ? this.t.shortcutTaken(other.label ?? '') : null;
  }

  private edit(next: readonly StarterItem[], select?: string | null): void {
    this.draft.set(next);
    if (select !== undefined) {
      this.selected.set(select);
      this.scrollTo(select);
    }
  }

  protected set(field: TextField, evt: Event): void {
    const id = this.selected();
    if (id === null) {
      return;
    }
    const value = (evt.target as HTMLInputElement).value;
    this.draft.update((d) => update(d, id, { [field]: value }));
    // the problem of this entry is checked again on save
    this.problems.update((p) => p.filter((x) => x.id !== id));
  }

  protected add(kind: StarterKind, patch: Partial<StarterItem> = {}): void {
    const d = this.draft();
    if (walk(d).length >= MAX_STARTER_ITEMS) {
      this.error.set(this.t.tooMany(MAX_STARTER_ITEMS));
      return;
    }
    const label =
      kind === 'program'
        ? this.t.newProgram
        : kind === 'folder'
          ? this.t.newFolder
          : kind === 'submenu'
            ? this.t.newSubmenu
            : '';
    const item = { ...blank(kind, newId(d), label), ...patch };
    const sel = this.selected();
    const into = sel !== null && find(d, sel)?.kind === 'submenu';
    this.edit(insert(d, sel, item, into), item.id);
    if (kind !== 'separator') {
      // the title field is the next thing to fill in
      setTimeout(() =>
        document.querySelector<HTMLInputElement>('app-starter-dialog .details input')?.select(),
      );
    }
  }

  protected addCurrentFolder(): void {
    const dir = this.currentFolder();
    if (dir !== null) {
      const title = this.ws.activeTab(this.ws.activeSide()).title || dir;
      this.add('folder', { label: title, folder: dir });
    }
  }

  protected addCursorFile(): void {
    const e = this.cursorFile();
    if (e) {
      this.add('program', { label: e.name, program: e.path, params: '' });
    }
  }

  protected moveBy(delta: -1 | 1): void {
    const id = this.selected();
    if (id !== null) {
      this.edit(move(this.draft(), id, delta), id);
    }
  }

  protected doIndent(): void {
    const id = this.selected();
    if (id !== null) {
      this.edit(indent(this.draft(), id), id);
    }
  }

  protected doOutdent(): void {
    const id = this.selected();
    if (id !== null) {
      this.edit(outdent(this.draft(), id), id);
    }
  }

  protected removeSelected(): void {
    const id = this.selected();
    if (id === null) {
      return;
    }
    const all = this.list();
    const i = all.findIndex((r) => r.item.id === id);
    const next = remove(this.draft(), id);
    const rest = rows(next);
    this.edit(next, rest[Math.min(i, rest.length - 1)]?.item.id ?? null);
  }

  /** APG listbox: ↑/↓/Home/End select; Alt+arrows arrange; Delete removes. */
  protected onListKey(evt: KeyboardEvent): void {
    const all = this.list();
    const i = all.findIndex((r) => r.item.id === this.selected());
    if (evt.altKey) {
      const fn: Record<string, () => void> = {
        ArrowUp: () => this.moveBy(-1),
        ArrowDown: () => this.moveBy(1),
        ArrowRight: () => this.doIndent(),
        ArrowLeft: () => this.doOutdent(),
      };
      if (fn[evt.key]) {
        evt.preventDefault();
        fn[evt.key]();
      }
      return;
    }
    let next: number;
    switch (evt.key) {
      case 'ArrowDown':
        next = Math.min(all.length - 1, i + 1);
        break;
      case 'ArrowUp':
        next = Math.max(0, i - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = all.length - 1;
        break;
      case 'Delete':
      case 'Backspace':
        evt.preventDefault();
        this.removeSelected();
        return;
      default:
        return;
    }
    evt.preventDefault();
    const id = all[next]?.item.id;
    if (id) {
      this.selected.set(id);
      this.scrollTo(id);
    }
  }

  protected onListClick(evt: MouseEvent): void {
    const li = (evt.target as Element | null)?.closest?.<HTMLElement>('[data-id]');
    if (li) {
      this.selected.set(li.dataset['id']!);
    }
  }

  protected async save(): Promise<void> {
    const keyProblem = walk(this.draft()).find((it) => this.shortcutProblem(it) !== null);
    if (keyProblem) {
      this.selected.set(keyProblem.id);
      this.scrollTo(keyProblem.id);
      this.error.set(
        this.t.invalidEntry(keyProblem.label ?? '', this.shortcutProblem(keyProblem)!),
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.store.save(this.draft());
      if (result.saved) {
        this.dialogs.close();
        return;
      }
      this.draft.set(result.items);
      this.problems.set(result.problems);
      const first = result.problems[0];
      if (first) {
        this.selected.set(first.id);
        this.scrollTo(first.id);
      }
      this.error.set(this.t.problemCount(new Set(result.problems.map((p) => p.id)).size));
    } catch (err) {
      this.error.set(this.t.saveFailed(errorText(toFsError(err))));
    } finally {
      this.busy.set(false);
    }
  }

  private scrollTo(id: string | null): void {
    if (id !== null) {
      setTimeout(() =>
        document.getElementById(this.optionId(id))?.scrollIntoView?.({ block: 'nearest' }),
      );
    }
  }
}
