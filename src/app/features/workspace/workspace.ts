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
import { CleanFoldersStore } from '../cleanfolders/clean.store';
import { MultiMkdirDialog } from '../multimkdir/multimkdir-dialog';
import { registerMultiMkdirActions } from '../multimkdir/multimkdir-actions';
import { MultiMkdirStore } from '../multimkdir/multimkdir.store';
import { registerPreviewActions } from '../preview/preview-actions';
import { PropertiesDialog } from '../preview/properties-dialog';
import { PropertiesStore } from '../preview/properties.store';
import { QuickViewStore } from '../preview/quick-view.store';
import { ViewerDialog } from '../preview/viewer-dialog';
import { ViewerStore } from '../preview/viewer.store';
import { FindDialog } from '../search/find-dialog';
import { FindStore } from '../search/find.store';
import { FolderFinderDialog } from '../search/folder-finder-dialog';
import { FolderFinderStore } from '../search/folder-finder.store';
import { registerSearchActions } from '../search/search-actions';
import { SearchStore } from '../search/search.store';
import { CommandPalette } from '../actions/command-palette';
import { registerOsActions } from '../osintegration/os-actions';
import { OsStore } from '../osintegration/os.store';
import { ToolConfigDialog } from '../osintegration/tool-config-dialog';
import { MarkPatternDialog } from '../actions/mark-pattern-dialog';
import { ShortcutDialog } from '../actions/shortcut-dialog';
import { registerWorkspaceActions } from '../actions/workspace-actions';
import { registerMenuActions } from '../menus/menu-actions';
import { MenuService } from '../menus/menu.service';
import { ContextMenu } from './context-menu';
import { ButtonBar } from './button-bar/button-bar';
import { FilePanel } from './file-panel';
import { splitterFromPointer, splitterKey } from './splitter';
import { TEXTS } from './texts';
import { WorkspaceStore } from './workspace.store';

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
    MultiMkdirDialog,
    ToolConfigDialog,
    ViewerDialog,
    PropertiesDialog,
    FindDialog,
    FolderFinderDialog,
    ContextMenu,
  ],
  templateUrl: './workspace.html',
  styleUrl: './workspace.scss',
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
  protected readonly ws = inject(WorkspaceStore);
  protected readonly actions = inject(ActionService);
  protected readonly dialogs = inject(DialogService);
  protected readonly jobs = inject(JobsStore);
  private readonly confirm = inject(ConfirmService);
  private readonly ops = inject(OpsStore);
  private readonly mr = inject(MultiRenameStore);
  private readonly gf = inject(GroupFilesStore);
  private readonly cl = inject(CleanFoldersStore);
  private readonly mm = inject(MultiMkdirStore);
  private readonly os = inject(OsStore);
  private readonly viewer = inject(ViewerStore);
  private readonly quick = inject(QuickViewStore);
  private readonly props = inject(PropertiesStore);
  private readonly find = inject(FindStore);
  private readonly search = inject(SearchStore);
  private readonly finder = inject(FolderFinderStore);
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
      await this.ws.flush();
      await this.jobs.cancelAllAndQuit();
    }
  }

  ngOnInit(): void {
    this.destroyRef.onDestroy(registerWorkspaceActions(this.actions, this.ws, this.dialogs));
    this.destroyRef.onDestroy(registerJobActions(this.actions, this.dialogs));
    this.destroyRef.onDestroy(registerOpsActions(this.actions, this.ops));
    this.destroyRef.onDestroy(registerMultiRenameActions(this.actions, this.mr, this.jobs));
    this.destroyRef.onDestroy(registerGroupFilesActions(this.actions, this.gf));
    this.destroyRef.onDestroy(registerCleanFoldersActions(this.actions, this.cl));
    this.destroyRef.onDestroy(registerMultiMkdirActions(this.actions, this.mm));
    this.destroyRef.onDestroy(registerOsActions(this.actions, this.os, this.dialogs));
    this.destroyRef.onDestroy(
      registerPreviewActions(this.actions, this.ws, this.viewer, this.quick, this.props),
    );
    this.destroyRef.onDestroy(
      registerSearchActions(this.actions, this.ws, this.find, this.search, this.finder),
    );
    this.destroyRef.onDestroy(registerMenuActions(this.actions, this.menus));
    this.destroyRef.onDestroy(this.keyboard.attach(document));
    this.menus.init();
    void this.jobs.init();
    void this.ws.init();
    void this.actions.init().then(() => this.os.init());
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
    const target = evt.target instanceof Element ? evt.target : null;
    const editable = !!target?.closest('input, textarea, [contenteditable="true"]');
    const selected = (document.getSelection()?.toString() ?? '') !== '';
    if (!editable && !selected) {
      evt.preventDefault();
    }
  }

  protected onPageHide(): void {
    void this.ws.flush();
  }

  protected onVisibility(): void {
    if (document.visibilityState === 'hidden') {
      void this.ws.flush();
    }
  }
}
