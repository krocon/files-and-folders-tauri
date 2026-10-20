import { computed, inject, Injectable, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { ACTIONS } from '../../core/actions/action-catalog';
import { formatShortcut } from '../../core/actions/shortcut';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { isNavigableDir, isParentRow } from '../../core/fs/fs.models';
import { MrImportApi } from '../../core/mrimport/mr-import-api';
import { MrScan } from '../../core/mrimport/mr-import.models';
import { SettingsPart } from '../../core/settings/settings.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { ThemeService } from '../../core/theme/theme.service';
import { ConfirmService } from '../../shared/dialog/confirm.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { ButtonConfigStore } from '../config/button-config.store';
import { FileTypesStore } from '../config/file-types.store';
import { OsStore } from '../osintegration/os.store';
import { PRESETS_BUILT_IN } from '../search/find-form';
import { SearchStore } from '../search/search.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import {
  AreaPlan,
  combine,
  Conflict,
  defaultSelection,
  ImportMode,
  ImportState,
  MrAreaId,
  planAll,
} from './mr-import-logic';
import { MR_IMPORT_TEXTS } from './mr-import-texts';

/**
 * Import assistant for the old configuration (design 026, root: the state survives the
 * confirmation dialog): scan a folder, plan against the current state, write the chosen
 * areas and reload the stores.
 */
@Injectable({ providedIn: 'root' })
export class MrImportStore {
  private readonly api = inject(MrImportApi);
  private readonly dialogs = inject(DialogService);
  private readonly confirm = inject(ConfirmService);
  private readonly actions = inject(ActionService);
  private readonly settings = inject(SettingsStore);
  private readonly theme = inject(ThemeService);
  private readonly buttons = inject(ButtonConfigStore);
  private readonly fileTypes = inject(FileTypesStore);
  private readonly search = inject(SearchStore);
  private readonly os = inject(OsStore);
  private readonly ws = inject(WorkspaceStore);

  readonly path = signal('');
  readonly scan = signal<MrScan | null>(null);
  readonly mode = signal<ImportMode>('merge');
  readonly chosen = signal<ReadonlySet<MrAreaId>>(new Set());
  readonly busy = signal(false);
  /** Result or error of the last step (live region). */
  readonly message = signal('');
  readonly error = signal('');
  private seq = 0;

  /** What the app has now (planning input). */
  private readonly state = computed<ImportState>(() => ({
    platform: this.actions.platform(),
    override: this.actions.override(),
    buttons: this.buttons.override(),
    fileTypes: this.fileTypes.user(),
    builtInFileTypes: this.fileTypes.builtIn,
    templates: this.search.templates(),
    builtInPresets: PRESETS_BUILT_IN,
    toolIds: this.os.tools().map((t) => t.id),
    themeNames: this.theme.themes().map((t) => t.name),
    settings: this.settings.values() as unknown as Readonly<Record<string, unknown>>,
  }));

  readonly plans = computed<readonly AreaPlan[]>(() => {
    const scan = this.scan();
    return scan ? planAll(scan, this.state(), this.mode()) : [];
  });

  /** Conflicts in the chosen areas (they need a confirmation, E12). */
  readonly conflictCount = computed(() =>
    this.plans()
      .filter((p) => this.chosen().has(p.area))
      .reduce((n, p) => n + p.conflicts.length, 0),
  );
  readonly canImport = computed(
    () =>
      !this.busy() &&
      this.plans().some((p) => this.chosen().has(p.area) && p.count > 0 && p.apply !== null),
  );

  /** Opens the assistant; the path is the folder under the cursor or of the active panel. */
  open(): void {
    if (!this.scan() && !this.path()) {
      const panel = this.ws.panel();
      const entry = panel?.store.cursorEntry();
      const dir = entry && isNavigableDir(entry) && !isParentRow(entry) ? entry.path : null;
      this.path.set(dir ?? panel?.store.path() ?? '');
    }
    this.dialogs.show('mr-import');
  }

  close(): void {
    this.dialogs.close();
  }

  /** Reads the folder (stale answers are dropped). */
  async find(): Promise<void> {
    const path = this.path().trim();
    if (!path) {
      return;
    }
    const seq = ++this.seq;
    this.busy.set(true);
    this.error.set('');
    this.message.set(MR_IMPORT_TEXTS.searching);
    try {
      const scan = await this.api.scan(path);
      if (seq !== this.seq) {
        return;
      }
      this.scan.set(scan);
      this.chosen.set(defaultSelection(this.plans()));
      this.message.set(MR_IMPORT_TEXTS.found(scan.root));
    } catch (err) {
      if (seq !== this.seq) {
        return;
      }
      const e = toFsError(err);
      this.scan.set(null);
      this.chosen.set(new Set());
      this.message.set('');
      this.error.set(e.code === 'not_found' ? MR_IMPORT_TEXTS.notFound(path) : errorText(e));
    } finally {
      if (seq === this.seq) {
        this.busy.set(false);
      }
    }
  }

  toggle(area: MrAreaId, on: boolean): void {
    const next = new Set(this.chosen());
    if (on) {
      next.add(area);
    } else {
      next.delete(area);
    }
    this.chosen.set(next);
  }

  /** Asks if own entries are replaced (E12), then writes and reloads. */
  async run(): Promise<void> {
    if (!this.canImport()) {
      return;
    }
    const conflicts = this.conflictCount();
    if (conflicts > 0 || this.mode() === 'replace') {
      const ok = await this.confirm.ask({
        title: MR_IMPORT_TEXTS.confirmTitle,
        message:
          this.mode() === 'replace'
            ? MR_IMPORT_TEXTS.confirmReplace
            : MR_IMPORT_TEXTS.confirmConflicts(conflicts),
        confirmLabel: MR_IMPORT_TEXTS.importButton,
      });
      // the confirmation replaced this dialog (one at a time): come back
      this.dialogs.show('mr-import');
      if (!ok) {
        return;
      }
    }
    this.busy.set(true);
    this.error.set('');
    this.message.set(MR_IMPORT_TEXTS.importing);
    const plans = this.plans().filter((p) => this.chosen().has(p.area));
    try {
      await this.settings.flush();
      const report = await this.api.apply(combine(plans, this.chosen()));
      const notes: string[] = [];
      const done = new Set<MrAreaId>();
      for (const p of plans) {
        if (p.apply && partsOf(p).every((part) => report.imported.includes(part))) {
          done.add(p.area);
        }
      }
      for (const w of report.warnings) {
        const name = MR_IMPORT_TEXTS.areaNames[areaOf(w.key)] ?? w.key ?? '';
        if (w.code === 'part_failed') {
          notes.push(MR_IMPORT_TEXTS.partFailed(name, w.path ?? ''));
        } else if (w.code === 'part_skipped') {
          notes.push(MR_IMPORT_TEXTS.partSkipped(name));
        }
      }
      const themesBlocked = report.warnings.some((w) => w.key === 'themes');
      const colors = plans.find((p) => p.area === 'colors');
      if (colors && !themesBlocked) {
        let ok = 0;
        for (const path of colors.colorPaths) {
          try {
            await this.theme.importFile(path, { select: false });
            ok++;
          } catch (err) {
            notes.push(MR_IMPORT_TEXTS.colorFailed(path, errorText(toFsError(err))));
          }
        }
        if (ok > 0) {
          done.add('colors');
        }
      }
      await this.reload(report.imported);
      const names = areaList(done);
      this.message.set(
        [
          names ? MR_IMPORT_TEXTS.done(names) : MR_IMPORT_TEXTS.doneNothing,
          report.backups.length > 0 ? MR_IMPORT_TEXTS.backups(report.backups.length) : '',
          ...notes,
        ]
          .filter((x) => x !== '')
          .join(' '),
      );
      this.chosen.set(new Set());
    } catch (err) {
      this.message.set('');
      this.error.set(MR_IMPORT_TEXTS.failed(errorText(toFsError(err))));
    } finally {
      this.busy.set(false);
    }
  }

  /** The stores of the written files read them again. */
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
        case 'tools':
          tasks.push(this.os.reload());
          break;
        case 'buttons':
          tasks.push(this.buttons.init());
          break;
        case 'fileTypes':
          tasks.push(this.fileTypes.init());
          break;
      }
    }
    await Promise.all(tasks);
  }

  /** A conflict as text (labels in the current language). */
  conflictText(area: MrAreaId, c: Conflict): string {
    const t = MR_IMPORT_TEXTS;
    if (c.kind === 'shortcut') {
      return t.shortcutConflict(
        formatShortcut(c.shortcut, this.actions.platform()),
        ACTIONS[c.from].label,
        ACTIONS[c.to].label,
      );
    }
    if (area === 'colors') {
      return t.copied(c.name);
    }
    return area === 'setup' ? t.changedSetting(c.name) : t.replaced(c.name);
  }
}

/** Bundle parts an area writes. */
function partsOf(p: AreaPlan): SettingsPart[] {
  const a = p.apply ?? {};
  const out: SettingsPart[] = [];
  const parts: [unknown, SettingsPart][] = [
    [a.keymap, 'keymap'],
    [a.buttons, 'buttons'],
    [a.fileTypes, 'fileTypes'],
    [a.settings, 'settings'],
    [a.tools, 'tools'],
  ];
  for (const [value, part] of parts) {
    if (value !== undefined) {
      out.push(part);
    }
  }
  return out;
}

/** The area of a bundle part (for messages). */
function areaOf(part: string | null): MrAreaId {
  switch (part) {
    case 'keymap':
      return 'shortcuts';
    case 'themes':
      return 'colors';
    case 'settings':
      return 'setup';
    default:
      return (part ?? 'setup') as MrAreaId;
  }
}

function areaList(done: ReadonlySet<MrAreaId>): string {
  return [...done].map((a) => MR_IMPORT_TEXTS.areaNames[a]).join(', ');
}
