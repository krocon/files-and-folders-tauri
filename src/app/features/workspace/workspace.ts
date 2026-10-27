import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { KeyboardDispatcher } from '../../core/actions/keyboard-dispatcher';
import { ConfirmDialog } from '../../shared/dialog/confirm-dialog';
import { DialogService } from '../../shared/dialog/dialog.service';
import { ConfirmService } from '../../shared/dialog/confirm.service';
import { JobsStore } from '../../core/jobs/jobs.store';
import { ConflictDialog } from '../jobs/conflict-dialog';
import { JobListDialog } from '../jobs/job-list-dialog';
import { JOB_TEXTS } from '../jobs/job-format';
import { registerJobActions } from '../jobs/job-actions';
import { CopyMoveDialog } from '../ops/copy-move-dialog';
import { DeleteDialog } from '../ops/delete-dialog';
import { NameDialog } from '../ops/name-dialog';
import { registerOpsActions } from '../ops/ops-actions';
import { OpsStore } from '../ops/ops.store';
import { MultiRenameDialog } from '../multirename/multirename-dialog';
import { registerMultiRenameActions } from '../multirename/multirename-actions';
import { MultiRenameStore } from '../multirename/multirename.store';
import { GroupFilesDialog } from '../groupfiles/groupfiles-dialog';
import { registerGroupFilesActions } from '../groupfiles/groupfiles-actions';
import { GroupFilesStore } from '../groupfiles/groupfiles.store';
import { CleanFoldersDialog } from '../cleanfolders/clean-dialog';
import { registerCleanFoldersActions } from '../cleanfolders/clean-actions';
import { ChecksumDialog } from '../checksum/checksum-dialog';
import { ChecksumResultDialog } from '../checksum/checksum-result-dialog';
import { registerChecksumActions } from '../checksum/checksum-actions';
import { ChecksumStore } from '../checksum/checksum.store';
import { DiffDialog } from '../diff/diff-dialog';
import { registerDiffActions } from '../diff/diff-actions';
import { DiffStore } from '../diff/diff.store';
import { CleanFoldersStore } from '../cleanfolders/clean.store';
import { MultiMkdirDialog } from '../multimkdir/multimkdir-dialog';
import { registerMultiMkdirActions } from '../multimkdir/multimkdir-actions';
import { MultiMkdirStore } from '../multimkdir/multimkdir.store';
import { registerPreviewActions } from '../preview/preview-actions';
import { PropertiesDialog } from '../preview/properties-dialog';
import { AttributesDialog } from '../attributes/attributes-dialog';
import { registerAttributesActions } from '../attributes/attributes-actions';
import { AttributesStore } from '../attributes/attributes.store';
import { PropertiesStore } from '../preview/properties.store';
import { QuickViewStore } from '../preview/quick-view.store';
import { ViewerDialog } from '../preview/viewer-dialog';
import { ViewerStore } from '../preview/viewer.store';
import { registerArchiveActions } from '../archive/archive-actions';
import { registerDiskUsageActions } from '../diskusage/disk-usage-actions';
import { DiskUsageStore } from '../diskusage/disk-usage.store';
import { ArchiveStore } from '../archive/archive.store';
import { PackDialog } from '../archive/pack-dialog';
import { UnpackDialog } from '../archive/unpack-dialog';
import { ArchivePasswordDialog } from '../archive/password-dialog';
import { DuplicatesDialog } from '../duplicates/duplicates-dialog';
import { DuplicateRulesDialog } from '../duplicates/duplicate-rules-dialog';
import { DedupeDialog } from '../duplicates/dedupe-dialog';
import { DuplicatesStore } from '../duplicates/duplicates.store';
import { FindDialog } from '../search/find-dialog';
import { FindStore } from '../search/find.store';
import { FolderFinderDialog } from '../search/folder-finder-dialog';
import { FolderFinderStore } from '../search/folder-finder.store';
import { registerSearchActions } from '../search/search-actions';
import { registerFlatActions } from '../flat/flat-actions';
import { ThemeService } from '../../core/theme/theme.service';
import { registerThemeActions } from '../themes/theme-actions';
import { ThemeDialog } from '../themes/theme-dialog';
import { SearchStore } from '../search/search.store';
import { CommandPalette } from '../actions/command-palette';
import { registerPaletteActions } from '../palette/palette-actions';
import { PaletteStore } from '../palette/palette.store';
import { registerOsActions } from '../osintegration/os-actions';
import { ShellBar } from '../shell/shell-bar';
import { registerShellActions } from '../shell/shell-actions';
import { ShellStore } from '../shell/shell.store';
import { OsStore } from '../osintegration/os.store';
import { ToolConfigDialog } from '../osintegration/tool-config-dialog';
import { StarterDialog } from '../starter/starter-dialog';
import { registerStarterActions } from '../starter/starter-actions';
import { StarterStore } from '../starter/starter.store';
import { MarkPatternDialog } from '../actions/mark-pattern-dialog';
import { ShortcutDialog } from '../actions/shortcut-dialog';
import { registerWorkspaceActions } from '../actions/workspace-actions';
import { registerMenuActions } from '../menus/menu-actions';
import { AboutDialog } from '../about/about-dialog';
import { registerAboutActions } from '../about/about-actions';
import { MenuService } from '../menus/menu.service';
import { ContextMenu } from './context-menu';
import { ButtonBar } from './button-bar/button-bar';
import { DragGhost } from '../dnd/drag-ghost';
import { FilePanel } from './file-panel';
import { splitterFromPointer, splitterKey } from './splitter';
import { TEXTS } from './texts';
import { ACT_TEXTS } from '../actions/actions-texts';
import { SettingsDialog } from '../settings/settings-dialog';
import { registerSettingsActions } from '../settings/settings-actions';
import { SettingsStore } from '../../core/settings/settings.store';
import { SETTINGS_TEXTS } from '../settings/settings-texts';
import { describeSettingsWarning } from '../settings/settings-warnings';
import { WorkspaceStore } from './workspace.store';
import { ButtonConfigDialog } from '../config/button-config-dialog';
import { ButtonConfigStore } from '../config/button-config.store';
import { registerConfigActions } from '../config/config-actions';
import { FileTypesDialog } from '../config/file-types-dialog';
import { FileTypesStore } from '../config/file-types.store';
import { MrImportDialog } from '../mrimport/mr-import-dialog';
import { registerMrImportActions } from '../mrimport/mr-import-actions';
import { MrImportStore } from '../mrimport/mr-import.store';
import { MenuApi } from '../../core/menu/menu-api';
import { ConnectionsDialog } from '../remote/connections-dialog';
import { RemotePromptDialog } from '../remote/remote-prompt-dialog';
import { registerRemoteActions } from '../remote/remote-actions';
import { RemoteStore } from '../remote/remote.store';

/**
 * The main window (`docs/ui-layout.md`): a CSS grid with the rows header · tabs ·
 * list · status (each split left | divider | right with one shared column
 * width) and the button bar. Owns the splitter, the announcement of the active
 * side and the window-wide tab shortcuts (until prompt 002).
 */
@Component({
  selector: 'app-workspace',
  imports: [
    FilePanel,
    DragGhost,
    ButtonBar,
    CommandPalette,
    MarkPatternDialog,
    ShortcutDialog,
    ConfirmDialog,
    JobListDialog,
    ConflictDialog,
    CopyMoveDialog,
    DeleteDialog,
    NameDialog,
    MultiRenameDialog,
    GroupFilesDialog,
    CleanFoldersDialog,
    ChecksumDialog,
    ChecksumResultDialog,
    DiffDialog,
    MultiMkdirDialog,
    ToolConfigDialog,
    StarterDialog,
    ViewerDialog,
    PropertiesDialog,
    AttributesDialog,
    FindDialog,
    FolderFinderDialog,
    PackDialog,
    UnpackDialog,
    ArchivePasswordDialog,
    DuplicatesDialog,
    DuplicateRulesDialog,
    DedupeDialog,
    ThemeDialog,
    SettingsDialog,
    AboutDialog,
    ContextMenu,
    ShellBar,
    ButtonConfigDialog,
    FileTypesDialog,
    MrImportDialog,
    ConnectionsDialog,
    RemotePromptDialog,
  ],
  templateUrl: './workspace.html',
  styleUrl: './workspace.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--fnf-split]': 'ws.splitter()',
    '[class.resizing]': 'dragging()',
    '(document:visibilitychange)': 'onVisibility()',
    '(window:pagehide)': 'onPageHide()',
    '(document:contextmenu)': 'onContextMenu($event)',
  },
})
export class Workspace implements OnInit {
  protected readonly act = ACT_TEXTS;
  private readonly settings = inject(SettingsStore);
  private readonly diskUsage = inject(DiskUsageStore);
  protected readonly ws = inject(WorkspaceStore);
  protected readonly actions = inject(ActionService);
  protected readonly dialogs = inject(DialogService);
  protected readonly jobs = inject(JobsStore);
  private readonly confirm = inject(ConfirmService);
  private readonly ops = inject(OpsStore);
  private readonly mr = inject(MultiRenameStore);
  private readonly gf = inject(GroupFilesStore);
  private readonly cl = inject(CleanFoldersStore);
  private readonly cs = inject(ChecksumStore);
  private readonly diff = inject(DiffStore);
  private readonly mm = inject(MultiMkdirStore);
  private readonly os = inject(OsStore);
  protected readonly shell = inject(ShellStore);
  private readonly viewer = inject(ViewerStore);
  private readonly quick = inject(QuickViewStore);
  private readonly props = inject(PropertiesStore);
  private readonly attrs = inject(AttributesStore);
  private readonly find = inject(FindStore);
  private readonly search = inject(SearchStore);
  /** Created at the start: it sends the palette settings to Rust (index build, design 043). */
  private readonly palette = inject(PaletteStore);
  private readonly finder = inject(FolderFinderStore);
  private readonly archive = inject(ArchiveStore);
  private readonly dup = inject(DuplicatesStore);
  private readonly theme = inject(ThemeService);
  private readonly buttonConfig = inject(ButtonConfigStore);
  private readonly fileTypes = inject(FileTypesStore);
  private readonly mrImport = inject(MrImportStore);
  private readonly starter = inject(StarterStore);
  private readonly remote = inject(RemoteStore);
  private readonly menuApi = inject(MenuApi);
  private readonly keyboard = inject(KeyboardDispatcher);
  protected readonly menus = inject(MenuService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly texts = TEXTS;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly dragging = signal(false);
  protected readonly modalOpen = computed(() => this.dialogs.open() !== null);
  protected readonly splitPercent = computed(() => Math.round(this.ws.splitter() * 100));
  /** Live region text: "Left panel, /Users/marc". */
  protected readonly announcement = signal('');

  constructor() {
    let previous: string | null = null;
    effect(() => {
      const side = this.ws.activeSide();
      const ready = this.ws.ready();
      untracked(() => {
        if (ready && previous !== null && previous !== side) {
          const path = this.ws.activeTab(side).path;
          this.announcement.set(`${TEXTS.sideName(side)}, ${path ?? TEXTS.homeFolder}`);
        }
        if (ready) {
          previous = side;
        }
      });
    });
    // a job asks: show the question unless another dialog (other than the task list) is open
    effect(() => {
      const job = this.jobs.conflictToShow();
      const open = this.dialogs.open();
      untracked(() => {
        if (job && (open === null || open === 'jobs')) {
          this.dialogs.show('conflict');
        }
      });
    });
    // a dialog closed and its opener is gone (e.g. a conflict that appeared after the copy
    // dialog): the keyboard focus goes back to the active list instead of staying on <body>
    effect(() => {
      const open = this.dialogs.open();
      untracked(() => {
        if (open === null && this.ws.ready()) {
          setTimeout(() => {
            const active = document.activeElement;
            if (this.dialogs.open() === null && (!active || active === document.body)) {
              this.ws.requestFocus(this.ws.activeSide());
            }
          });
        }
      });
    });
    // success messages of design 011 (copied, tool started) for screen readers
    effect(() => {
      const text = this.os.status();
      if (text) {
        untracked(() => this.announcement.set(text));
      }
    });
    // connected / disconnected (design 034)
    effect(() => {
      const text = this.remote.status();
      if (text) {
        untracked(() => this.announcement.set(text));
      }
    });
    // starter entry started (design 032)
    effect(() => {
      const text = this.starter.status();
      if (text) {
        untracked(() => this.announcement.set(text));
      }
    });
    // problems with settings.json (codes from Rust, design 015) and failed saves
    effect(() => {
      const warnings = this.settings.warnings();
      const failed = this.settings.saveError();
      untracked(() => {
        for (const w of warnings) {
          this.actions.report(describeSettingsWarning(w));
        }
        if (failed) {
          this.actions.report(SETTINGS_TEXTS.saveFailed(failed));
        }
        if (warnings.length > 0 || failed) {
          this.settings.dismissWarnings();
        }
      });
    });
    effect(() => {
      const req = this.jobs.quitRequest();
      if (req) {
        untracked(() => void this.askQuit(req.running));
      }
    });
  }

  private async askQuit(running: number): Promise<void> {
    const ok = await this.confirm.ask({
      title: JOB_TEXTS.quitTitle,
      message: JOB_TEXTS.quitMessage(running),
      confirmLabel: JOB_TEXTS.quitConfirm,
      danger: true,
    });
    if (ok) {
      await Promise.all([this.ws.flush(), this.settings.flush()]);
      await this.jobs.cancelAllAndQuit();
    }
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(
      registerWorkspaceActions(this.actions, this.ws, this.dialogs, this.settings),
    );
    this.destroyRef.onDestroy(registerSettingsActions(this.actions, this.dialogs));
    this.destroyRef.onDestroy(registerJobActions(this.actions, this.dialogs));
    this.destroyRef.onDestroy(registerOpsActions(this.actions, this.ops));
    this.destroyRef.onDestroy(registerMultiRenameActions(this.actions, this.mr, this.jobs));
    this.destroyRef.onDestroy(registerGroupFilesActions(this.actions, this.gf));
    this.destroyRef.onDestroy(registerCleanFoldersActions(this.actions, this.cl));
    this.destroyRef.onDestroy(registerChecksumActions(this.actions, this.cs));
    this.destroyRef.onDestroy(registerDiffActions(this.actions, this.diff));
    this.destroyRef.onDestroy(registerMultiMkdirActions(this.actions, this.mm));
    this.destroyRef.onDestroy(registerOsActions(this.actions, this.os, this.dialogs));
    this.destroyRef.onDestroy(registerShellActions(this.actions, this.shell));
    this.destroyRef.onDestroy(
      registerPreviewActions(this.actions, this.ws, this.viewer, this.quick, this.props),
    );
    this.destroyRef.onDestroy(
      registerSearchActions(this.actions, this.ws, this.find, this.search, this.finder),
    );
    this.destroyRef.onDestroy(registerFlatActions(this.actions, this.ws));
    this.destroyRef.onDestroy(registerPaletteActions(this.actions, this.palette, this.dialogs));
    this.destroyRef.onDestroy(registerArchiveActions(this.actions, this.archive, this.dup));
    this.destroyRef.onDestroy(
      registerDiskUsageActions(this.actions, this.ws, this.diskUsage, this.jobs, this.settings),
    );
    this.destroyRef.onDestroy(registerAttributesActions(this.actions, this.attrs));
    this.destroyRef.onDestroy(registerThemeActions(this.actions, this.theme, this.dialogs));
    this.destroyRef.onDestroy(registerMenuActions(this.actions, this.menus));
    this.destroyRef.onDestroy(registerAboutActions(this.actions, this.dialogs));
    this.destroyRef.onDestroy(registerConfigActions(this.actions, this.dialogs, this.menuApi));
    this.destroyRef.onDestroy(registerMrImportActions(this.actions, this.mrImport));
    this.destroyRef.onDestroy(registerStarterActions(this.actions, this.starter, this.menus));
    this.destroyRef.onDestroy(registerRemoteActions(this.actions, this.ws, this.remote));
    this.destroyRef.onDestroy(this.keyboard.attach(document));
    void this.settings.init();
    this.menus.init();
    void this.jobs.init();
    void this.ws.init();
    void this.actions.init().then(() => Promise.all([this.os.init(), this.starter.init()]));
    void this.theme.init();
    void this.buttonConfig.init();
    void this.fileTypes.init();
  }

  // ---- splitter ----

  protected onSplitterDown(evt: PointerEvent): void {
    if (evt.button !== 0) {
      return;
    }
    const el = evt.target as HTMLElement;
    el.setPointerCapture?.(evt.pointerId);
    this.dragging.set(true);
    evt.preventDefault(); // no text selection while dragging …
    el.focus(); // … but the separator gets the focus (arrow keys)
  }

  protected onSplitterMove(evt: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.ws.setSplitter(splitterFromPointer(evt.clientX, rect.left, rect.width));
  }

  protected onSplitterUp(): void {
    this.dragging.set(false);
  }

  protected onSplitterKey(evt: KeyboardEvent): void {
    const next = splitterKey(this.ws.splitter(), evt.key);
    if (next !== null) {
      this.ws.setSplitter(next);
      evt.preventDefault();
    }
  }

  protected resetSplitter(): void {
    this.ws.setSplitter(0.5);
  }

  /**
   * No WebView menu (Reload, Inspect) outside our own menus (design 014 E10) – text
   * fields and selected text keep it (copy/paste).
   */
  protected onContextMenu(evt: MouseEvent): void {
    if (!keepsWebViewMenu(evt.target instanceof Element ? evt.target : null)) {
      evt.preventDefault();
    }
  }

  protected onPageHide(): void {
    void this.ws.flush(); // the settings store flushes on pagehide by itself
  }

  protected onVisibility(): void {
    if (document.visibilityState === 'hidden') {
      void this.ws.flush();
      void this.settings.flush();
    }
  }
}

/**
 * The WebView's own menu (copy/paste) stays for text fields, editable content
 * (any `contenteditable` value) and a text selection under the pointer – a
 * selection elsewhere does not unlock it on rows or buttons (review 014 #6).
 */
export function keepsWebViewMenu(target: Element | null): boolean {
  if (!target) {
    return false;
  }
  if (
    (target as HTMLElement).isContentEditable === true ||
    target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')
  ) {
    return true;
  }
  const sel = target.ownerDocument.getSelection();
  if (!sel || sel.toString() === '') {
    return false;
  }
  // not containsNode(…, true): it misses an element that holds the whole selection
  for (let i = 0; i < sel.rangeCount; i++) {
    if (sel.getRangeAt(i).intersectsNode(target)) {
      return true;
    }
  }
  return false;
}
