import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { ACTIONS } from '../../core/actions/action-catalog';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { SettingsApi } from '../../core/settings/settings-api';
import {
  SCHEMA,
  SETTINGS_PARTS,
  SettingKey,
  SettingsPart,
  SettingsValues,
} from '../../core/settings/settings.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { ThemeService } from '../../core/theme/theme.service';
import { ConfirmService } from '../../shared/dialog/confirm.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { MultiRenameStore } from '../multirename/multirename.store';
import { OsStore } from '../osintegration/os.store';
import { ShellStore } from '../shell/shell.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { ButtonConfigStore } from '../config/button-config.store';
import { FileTypesStore } from '../config/file-types.store';
import { hitCount, NOTES, searchSettings, SectionId, SECTIONS } from './settings-logic';
import { describeSettingsWarning } from './settings-warnings';
import { SETTINGS_TEXTS } from './settings-texts';

/**
 * Settings… (Mod+,, design 015 E6): sections as vertical tabs (APG), a search over
 * all settings, every change applies at once, reset per section. Keyboard, tools
 * and colours link to their own dialogs; Data exports/imports everything.
 */
@Component({
  selector: 'app-settings-dialog',
  imports: [Modal, NgTemplateOutlet],
  template: `
    <app-modal [heading]="t.title" width="54rem" height="38rem" (closed)="dialogs.close()">
      <div class="settings">
        <input
          data-autofocus
          class="search"
          type="search"
          spellcheck="false"
          [attr.aria-label]="t.search"
          [placeholder]="t.searchPlaceholder"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
        />
        <p class="sr-only" aria-live="polite">{{ liveText() }}</p>
        <div class="body">
          @if (!searching()) {
            <div
              class="tabs"
              role="tablist"
              aria-orientation="vertical"
              [attr.aria-label]="t.categories"
            >
              @for (s of sections; track s.id; let i = $index) {
                <button
                  type="button"
                  role="tab"
                  class="tab"
                  [id]="'fnf-set-tab-' + s.id"
                  [attr.data-section]="s.id"
                  aria-controls="fnf-set-panel"
                  [attr.aria-selected]="current() === s.id"
                  [attr.tabindex]="current() === s.id ? 0 : -1"
                  (click)="select(s.id)"
                  (keydown)="onTabKey($event, i)"
                >
                  {{ t.cat[s.id] }}
                </button>
              }
            </div>
            <div
              class="panel"
              role="tabpanel"
              tabindex="0"
              id="fnf-set-panel"
              [attr.aria-labelledby]="'fnf-set-tab-' + current()"
            >
              <ng-container
                *ngTemplateOutlet="sectionTpl; context: { id: current(), keys: keysOf(current()) }"
              />
            </div>
          } @else {
            <div class="panel results">
              @for (h of hits(); track h.id) {
                <section class="group" [attr.aria-label]="t.cat[h.id]">
                  <h3>{{ t.cat[h.id] }}</h3>
                  <ng-container
                    *ngTemplateOutlet="
                      sectionTpl;
                      context: { id: h.id, keys: h.keys, content: h.content, search: true }
                    "
                  />
                </section>
              } @empty {
                <p class="empty">{{ t.noResults }}</p>
              }
            </div>
          }
        </div>
        @if (message(); as m) {
          <p class="message" role="status">{{ m }}</p>
        }
        <div class="buttons">
          <button type="button" class="btn" (click)="dialogs.close()">{{ t.close }}</button>
        </div>
      </div>
    </app-modal>

    <ng-template #sectionTpl let-id="id" let-keys="keys" let-content="content" let-search="search">
      @for (key of keys; track key) {
        <div class="item" [attr.data-key]="key">
          @switch (kindOf(key)) {
            @case ('bool') {
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="value(key)"
                  [attr.aria-describedby]="helpId(key)"
                  (change)="setBool(key, $event)"
                />
                <span>{{ label(key) }}</span>
              </label>
            }
            @case ('enum') {
              <label class="field">
                <span>{{ label(key) }}</span>
                <select [attr.aria-describedby]="helpId(key)" (change)="setEnum(key, $event)">
                  @for (v of valuesOf(key); track v) {
                    <option [value]="v" [selected]="value(key) === v">
                      {{ t.values[v] ?? v }}
                    </option>
                  }
                </select>
              </label>
            }
            @case ('json') {
              <div class="field">
                <span>{{ label(key) }}</span>
                <span class="row">
                  <span>{{
                    key === 'search.recent'
                      ? t.recentCount(listCount(key))
                      : t.templateCount(listCount(key))
                  }}</span>
                  <button
                    type="button"
                    class="btn"
                    [disabled]="listCount(key) === 0"
                    [attr.aria-describedby]="helpId(key)"
                    (click)="settings.reset([key])"
                  >
                    {{ t.clearRecent }}
                  </button>
                </span>
              </div>
            }
          }
          <p class="help" [id]="helpId(key)">
            {{ help(key) }}
            @if (note(key); as n) {
              <em class="note">{{ n }}</em>
            }
            @if (settings.isChanged(key)) {
              <span class="changed">{{ t.changed }}</span>
            }
          </p>
        </div>
      }
      @if (!search || content) {
        @switch (id) {
          @case ('keyboard') {
            <p>{{ t.keyboardIntro }}</p>
            <p>{{ t.overridden(overrideCount()) }}</p>
            <p>{{ t.conflicts(conflicts().length) }}</p>
            @if (conflicts().length > 0) {
              <ul class="conflicts">
                @for (c of conflicts(); track c) {
                  <li>{{ c }}</li>
                }
              </ul>
            }
            <div class="row">
              <button type="button" class="btn" (click)="dialogs.show('shortcuts')">
                {{ t.editShortcuts }}
              </button>
              <button
                type="button"
                class="btn"
                [disabled]="overrideCount() === 0"
                (click)="actions.resetAllOverrides()"
              >
                {{ t.resetShortcuts }}
              </button>
            </div>
          }
          @case ('shell') {
            <p>{{ t.shellIntro }}</p>
            <div class="row">
              <button type="button" class="btn" (click)="clearShellHistory()">
                {{ t.clearShellHistory }}
              </button>
            </div>
          }
          @case ('tools') {
            <p>{{ t.toolsIntro }}</p>
            <p>{{ t.toolCount(os.tools().length) }}</p>
            <div class="row">
              <button type="button" class="btn" (click)="dialogs.show('tool-config')">
                {{ t.editTools }}
              </button>
            </div>
          }
          @case ('colors') {
            <p>{{ t.colorsIntro }}</p>
            <p>
              <strong>{{
                t.currentScheme(theme.active().name, theme.selection().mode === 'system')
              }}</strong>
            </p>
            <div class="row">
              <button type="button" class="btn" (click)="dialogs.show('themes')">
                {{ t.editColors }}
              </button>
            </div>
          }
          @case ('customize') {
            <p>{{ t.customizeIntro }}</p>
            <p>{{ t.buttonSetsChanged(buttonSetsChanged()) }}</p>
            <p>{{ t.fileTypesInfo(fileTypes.categories().length, fileTypes.user() !== null) }}</p>
            <div class="row">
              <button type="button" class="btn" (click)="dialogs.show('button-config')">
                {{ t.editButtons }}
              </button>
              <button type="button" class="btn" (click)="dialogs.show('file-types')">
                {{ t.editFileTypes }}
              </button>
            </div>
          }
          @case ('data') {
            <p>{{ t.dataIntro }}</p>
            <p class="hint">{{ t.fileHint }}</p>
            <div class="row">
              <label class="field grow">
                <span>{{ t.exportTo }}</span>
                <input
                  type="text"
                  spellcheck="false"
                  [value]="exportDir()"
                  (input)="exportDir.set($any($event.target).value)"
                />
              </label>
              <button
                type="button"
                class="btn"
                [disabled]="!exportDir().trim() || busy()"
                (click)="exportAll()"
              >
                {{ t.export }}
              </button>
            </div>
            <div class="row">
              <label class="field grow">
                <span>{{ t.importFrom }}</span>
                <input
                  type="text"
                  spellcheck="false"
                  [value]="importPath()"
                  (input)="importPath.set($any($event.target).value)"
                />
              </label>
              <button
                type="button"
                class="btn"
                [disabled]="!importPath().trim() || parts().size === 0 || busy()"
                (click)="importAll()"
              >
                {{ t.import }}
              </button>
            </div>
            <fieldset class="parts">
              <legend>{{ t.importParts }}</legend>
              @for (p of allParts; track p) {
                <label class="check">
                  <input
                    type="checkbox"
                    [checked]="parts().has(p)"
                    (change)="togglePart(p, $event)"
                  />
                  <span>{{ t.parts[p] }}</span>
                </label>
              }
            </fieldset>
            @if (parts().has('tools')) {
              <p class="warn" role="note">{{ t.toolsWarning }}</p>
            }
            <div class="row">
              <button type="button" class="btn" (click)="actions.run('OPEN_IMPORT_OLD_CONFIG_DLG')">
                {{ importOldLabel }}
              </button>
            </div>
            <div class="row">
              <button type="button" class="btn danger" (click)="resetAll()">
                {{ t.resetAll }}
              </button>
            </div>
          }
        }
      }
      @if (!search && resettable(id)) {
        <div class="row end">
          <button
            type="button"
            class="btn"
            [attr.aria-label]="t.resetSectionOf(catLabel(id))"
            (click)="resetSection(id)"
          >
            {{ t.resetSection }}
          </button>
        </div>
      }
    </ng-template>
  `,
  styleUrl: './settings-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsDialog {
  protected readonly t = SETTINGS_TEXTS;
  protected readonly settings = inject(SettingsStore);
  protected readonly dialogs = inject(DialogService);
  protected readonly actions = inject(ActionService);
  protected readonly theme = inject(ThemeService);
  protected readonly os = inject(OsStore);
  private readonly api = inject(SettingsApi);
  private readonly ws = inject(WorkspaceStore);
  private readonly confirm = inject(ConfirmService);
  private readonly mr = inject(MultiRenameStore);
  private readonly shell = inject(ShellStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly sections = SECTIONS;
  protected readonly allParts = SETTINGS_PARTS;
  /** Design 026: the import assistant of the old version. */
  protected get importOldLabel(): string {
    return ACTIONS.OPEN_IMPORT_OLD_CONFIG_DLG.label;
  }
  protected readonly current = signal<SectionId>(lastSection);
  protected readonly query = signal('');
  protected readonly message = signal<string | null>(null);
  protected readonly busy = signal(false);

  /** Settings that do not exist on this platform (the HTML menu bar on macOS). */
  private readonly hidden = computed<ReadonlySet<SettingKey>>(() => {
    const platform = this.actions.platform();
    const hidden = new Set<SettingKey>();
    if (platform === 'macos') {
      hidden.add('view.menuBar');
    }
    // the shell choice exists on Windows only, the login PATH on macOS/Linux only (design 021)
    hidden.add(platform === 'windows' ? 'shell.loginPath' : 'shell.windowsShell');
    return hidden;
  });
  protected readonly searching = computed(() => this.query().trim() !== '');
  protected readonly hits = computed(() => searchSettings(this.query(), this.hidden()));
  protected readonly liveText = computed(() =>
    this.searching() ? this.t.results(hitCount(this.hits())) : '',
  );
  protected readonly conflicts = computed(() => this.actions.keymap().conflicts);
  protected readonly overrideCount = computed(() => Object.keys(this.actions.override()).length);
  private readonly buttonConfig = inject(ButtonConfigStore);
  protected readonly fileTypes = inject(FileTypesStore);
  protected readonly buttonSetsChanged = this.buttonConfig.changedCount;

  private readonly panel = this.ws.panel();
  protected readonly exportDir = signal(this.panel?.store.path() ?? '');
  protected readonly importPath = signal(suggestedImport(this.panel?.store.cursorEntry() ?? null));
  protected readonly parts = signal<ReadonlySet<SettingsPart>>(
    new Set(SETTINGS_PARTS.filter((p) => p !== 'tools')),
  );

  protected async clearShellHistory(): Promise<void> {
    try {
      await this.shell.clearHistory();
      this.message.set(this.t.shellHistoryCleared);
    } catch (err) {
      this.message.set(errorText(toFsError(err)));
    }
  }

  /** The section stays selected when the dialog opens again (this session). */
  protected select(id: SectionId): void {
    this.current.set(id);
    lastSection = id;
  }

  protected keysOf(id: SectionId): readonly SettingKey[] {
    const hidden = this.hidden();
    return (SECTIONS.find((s) => s.id === id)?.keys ?? []).filter((k) => !hidden.has(k));
  }

  protected label(key: SettingKey): string {
    return this.t.items[key].label;
  }

  protected help(key: SettingKey): string {
    return this.t.items[key].help;
  }

  protected catLabel(id: SectionId): string {
    return this.t.cat[id];
  }

  protected kindOf(key: SettingKey): string {
    return SCHEMA[key].type;
  }

  protected valuesOf(key: SettingKey): readonly string[] {
    const spec = SCHEMA[key];
    return spec.type === 'enum' ? spec.values : [];
  }

  protected value(key: SettingKey): unknown {
    return this.settings.get(key);
  }

  protected helpId(key: SettingKey): string {
    return `fnf-set-help-${key.replace('.', '-')}`;
  }

  protected note(key: SettingKey): string | null {
    const n = NOTES[key];
    return n === 'restart' ? this.t.restart : n === 'newTabs' ? this.t.newTabs : null;
  }

  protected setBool(key: SettingKey, evt: Event): void {
    this.settings.set(key, (evt.target as HTMLInputElement).checked as never);
  }

  protected setEnum(key: SettingKey, evt: Event): void {
    this.settings.set(
      key,
      (evt.target as HTMLSelectElement).value as SettingsValues[typeof key] as never,
    );
  }

  /** Entries of a remembered list (recent searches, own templates). */
  protected listCount(key: SettingKey): number {
    const v = this.settings.get(key);
    return Array.isArray(v) ? v.length : 0;
  }

  protected resettable(id: SectionId): boolean {
    return this.keysOf(id).length > 0;
  }

  protected resetSection(id: SectionId): void {
    this.settings.reset(this.keysOf(id));
  }

  /** APG tabs (vertical): ↑/↓ move and select, Home/End the first/last. */
  protected onTabKey(evt: KeyboardEvent, i: number): void {
    const n = SECTIONS.length;
    const next =
      evt.key === 'ArrowDown'
        ? (i + 1) % n
        : evt.key === 'ArrowUp'
          ? (i - 1 + n) % n
          : evt.key === 'Home'
            ? 0
            : evt.key === 'End'
              ? n - 1
              : -1;
    if (next < 0) {
      return;
    }
    evt.preventDefault();
    const id = SECTIONS[next].id;
    this.select(id);
    setTimeout(() =>
      this.host.nativeElement.querySelector<HTMLElement>(`[data-section="${id}"]`)?.focus(),
    );
  }

  protected togglePart(p: SettingsPart, evt: Event): void {
    const on = (evt.target as HTMLInputElement).checked;
    const next = new Set(this.parts());
    if (on) {
      next.add(p);
    } else {
      next.delete(p);
    }
    this.parts.set(next);
  }

  protected async exportAll(): Promise<void> {
    this.busy.set(true);
    try {
      await this.settings.flush();
      const path = await this.api.exportAll(this.exportDir().trim());
      this.message.set(this.t.exported(path));
    } catch (err) {
      this.message.set(errorText(toFsError(err)));
    } finally {
      this.busy.set(false);
    }
  }

  protected async importAll(): Promise<void> {
    this.busy.set(true);
    try {
      await this.settings.flush();
      const parts = SETTINGS_PARTS.filter((p) => this.parts().has(p));
      const report = await this.api.importAll(this.importPath().trim(), parts);
      await this.reload(report.imported);
      const names = report.imported.map((p) => this.t.parts[p]).join(', ');
      // every warning of the report (review 015 #12): parts skipped/failed, values reset
      const part = (key: string | null) => this.t.parts[key as SettingsPart] ?? key ?? '';
      const notes = report.warnings.map((w) =>
        w.code === 'part_skipped'
          ? this.t.skipped(part(w.key))
          : w.code === 'part_failed'
            ? this.t.failed(part(w.key), w.path ?? '')
            : describeSettingsWarning(w),
      );
      this.message.set(
        [names ? this.t.imported(names) : this.t.importedNothing, ...notes].join(' '),
      );
    } catch (err) {
      this.message.set(errorText(toFsError(err)));
    } finally {
      this.busy.set(false);
    }
  }

  /** The stores of the imported files read them again. */
  private async reload(parts: readonly SettingsPart[]): Promise<void> {
    const tasks: Promise<unknown>[] = [];
    for (const p of parts) {
      switch (p) {
        case 'settings':
          tasks.push(this.settings.load());
          break;
        case 'keymap':
          tasks.push(this.actions.init());
          break;
        case 'themes':
          tasks.push(this.theme.init());
          break;
        case 'tools':
          tasks.push(this.os.reload());
          break;
        case 'renamePresets':
          this.mr.invalidatePresets();
          break;
        case 'buttons':
          tasks.push(this.buttonConfig.init());
          break;
        case 'fileTypes':
          tasks.push(this.fileTypes.init());
          break;
      }
    }
    await Promise.all(tasks);
  }

  protected async resetAll(): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.t.resetAllTitle,
      message: this.t.resetAllConfirm,
      confirmLabel: this.t.resetAllButton,
      danger: true,
    });
    if (ok) {
      this.settings.resetAll();
    }
    // the confirmation replaced this dialog (one at a time): come back
    this.dialogs.show('settings');
  }
}

/** The section shown when the dialog opens again (this session). */
let lastSection: SectionId = 'general';

/** A `.json` file under the cursor is the likely import file. */
function suggestedImport(entry: { path: string; name: string; kind: string } | null): string {
  return entry && entry.kind === 'file' && /\.json$/i.test(entry.name) ? entry.path : '';
}
