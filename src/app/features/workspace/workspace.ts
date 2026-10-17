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
import { CommandPalette } from '../actions/command-palette';
import { MarkPatternDialog } from '../actions/mark-pattern-dialog';
import { ShortcutDialog } from '../actions/shortcut-dialog';
import { registerWorkspaceActions } from '../actions/workspace-actions';
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
  ],
  templateUrl: './workspace.html',
  styleUrl: './workspace.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--fnf-split]': 'ws.splitter()',
    '[class.resizing]': 'dragging()',
    '(document:visibilitychange)': 'onVisibility()',
    '(window:pagehide)': 'onPageHide()',
  },
})
export class Workspace implements OnInit {
  protected readonly ws = inject(WorkspaceStore);
  protected readonly actions = inject(ActionService);
  protected readonly dialogs = inject(DialogService);
  protected readonly jobs = inject(JobsStore);
  private readonly confirm = inject(ConfirmService);
  private readonly keyboard = inject(KeyboardDispatcher);
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
    this.destroyRef.onDestroy(
      registerJobActions(this.actions, this.ws, this.jobs, this.dialogs, this.confirm),
    );
    this.destroyRef.onDestroy(this.keyboard.attach(document));
    void this.jobs.init();
    void this.ws.init();
    void this.actions.init();
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

  protected onPageHide(): void {
    void this.ws.flush();
  }

  protected onVisibility(): void {
    if (document.visibilityState === 'hidden') {
      void this.ws.flush();
    }
  }
}
