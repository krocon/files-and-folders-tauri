import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActionService } from '../../../core/actions/action.service';
import { ACTIONS, ActionId, shortLabel } from '../../../core/actions/action-catalog';
import { KeyboardDispatcher } from '../../../core/actions/keyboard-dispatcher';
import { badgeFor } from '../../../core/actions/shortcut';
import { isFinished } from '../../../core/jobs/jobs.models';
import { JobsStore } from '../../../core/jobs/jobs.store';
import { ThemeService } from '../../../core/theme/theme.service';
import { ActionsMenu } from '../../actions/actions-menu';
import { THEME_TEXTS } from '../../themes/theme-texts';
import { ContextMenu, MenuCloseReason, MenuItem } from '../context-menu';
import { TEXTS } from '../texts';
import { BUTTON_SETS, modifierSet } from './button-config';

interface ToolButton {
  readonly id: ActionId;
  readonly label: string;
  readonly icon: string;
  readonly showLabel: boolean;
}

/**
 * Button bar (row 6): function buttons of the set for the held modifiers
 * (Total Commander principle) with the shortcut badge without those modifiers;
 * Actions ▴ menu; Tasks, theme and shortcut buttons. Buttons whose action is
 * missing or not allowed right now are dimmed (`aria-disabled`, still focusable).
 */
@Component({
  selector: 'app-button-bar',
  imports: [ActionsMenu, ContextMenu],
  template: `
    <div class="functions" role="toolbar" aria-label="Functions">
      @for (b of buttons(); track $index) {
        <button
          type="button"
          class="fbtn"
          [attr.aria-disabled]="b.ready ? null : 'true'"
          [attr.title]="b.title"
          (click)="run(b.id, b.ready)"
        >
          @if (b.badge) {
            <kbd class="badge">{{ b.badge }}</kbd>
          }
          <span>{{ b.label }}</span>
        </button>
      }
    </div>
    <div class="tools" role="toolbar" aria-label="Tools">
      <button
        type="button"
        class="fbtn actions-toggle"
        aria-haspopup="menu"
        [attr.aria-expanded]="menuOpen()"
        (click)="menuOpen.set(!menuOpen())"
      >
        <span>Actions</span> <span aria-hidden="true">▴</span>
      </button>
      @for (t of tools(); track t.id) {
        <button
          type="button"
          class="fbtn"
          [attr.aria-disabled]="t.ready ? null : 'true'"
          [attr.aria-label]="t.label"
          [attr.title]="t.title"
          [attr.aria-haspopup]="t.id === 'OPEN_THEMES_DLG' ? 'menu' : null"
          [attr.aria-expanded]="t.id === 'OPEN_THEMES_DLG' ? themeMenu() !== null : null"
          [class.theme-toggle]="t.id === 'OPEN_THEMES_DLG'"
          (click)="t.id === 'OPEN_THEMES_DLG' ? openThemeMenu($event) : run(t.id, t.ready)"
          [class.attention]="t.status?.waiting"
        >
          <span aria-hidden="true">{{ t.icon }}</span>
          @if (t.showLabel) {
            <span aria-hidden="true">{{ t.label }}</span>
          }
          @if (t.status; as st) {
            <span class="task-bar" aria-hidden="true"
              ><span [style.width.%]="st.percent"></span
            ></span>
          }
        </button>
      }
    </div>
    @if (menuOpen()) {
      <app-actions-menu (closed)="onMenuClosed($event)" />
    }
    @if (themeMenu(); as pos) {
      <app-context-menu
        [items]="themeItems()"
        [x]="pos.x"
        [y]="pos.y"
        [label]="themeTexts.menuLabel"
        [anchor]="pos.anchor"
        (chosen)="onThemeChosen($event)"
        (closed)="onThemeMenuClosed($event)"
      />
    }
  `,
  styleUrl: './button-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ButtonBar {
  private readonly actions = inject(ActionService);
  private readonly keys = inject(KeyboardDispatcher);
  private readonly jobs = inject(JobsStore);
  private readonly theme = inject(ThemeService);
  protected readonly menuOpen = signal(false);
  /** 🎨 menu (mr: L&F <name>, own schemes first): position or closed. */
  protected readonly themeMenu = signal<{ x: number; y: number; anchor: Element } | null>(null);
  protected readonly themeTexts = THEME_TEXTS;

  protected readonly themeItems = computed<MenuItem[]>(() => {
    const system = this.theme.selection().mode === 'system';
    const active = this.theme.active().id;
    return [
      { id: 'system', label: THEME_TEXTS.menuFollow, checked: system },
      ...this.theme.themes().map((t) => ({
        id: `theme:${t.id}`,
        label: t.name,
        checked: !system && t.id === active,
      })),
      { id: 'edit', label: THEME_TEXTS.menuEdit },
    ];
  });

  private readonly toolDefs: readonly Omit<ToolButton, 'label'>[] = [
    { id: 'OPEN_TASK_DLG', icon: '⚙', showLabel: true },
    { id: 'OPEN_THEMES_DLG', icon: '🎨', showLabel: false },
    { id: 'OPEN_SHORTCUT_DLG', icon: '⌨', showLabel: false },
  ];

  protected readonly buttons = computed(() => {
    const held = this.keys.held();
    const platform = this.actions.platform();
    this.actions.keymap();
    return BUTTON_SETS[modifierSet(held, platform)].map((id) => {
      const state = this.actions.state(id);
      const shortcut = this.actions.shortcutLabel(id);
      return {
        id,
        label: shortLabel(id),
        badge: badgeFor(this.actions.shortcuts(id), held, platform),
        ready: state === 'ready',
        title: this.title(id, state, shortcut),
      };
    });
  });

  /** "finished / total" of the visible tasks while any runs (mr), plus overall progress. */
  private readonly taskStatus = computed(() => {
    if (this.jobs.active().length === 0) {
      return null;
    }
    const visible = this.jobs.visible();
    const finished = visible.filter((j) => isFinished(j.state)).length;
    const waiting = visible.some((j) => j.state === 'waitingForDecision');
    const progress = this.jobs.overallProgress();
    return {
      text: `${finished} / ${visible.length}`,
      percent: progress === null ? 0 : Math.round(progress * 100),
      waiting,
    };
  });

  protected readonly tools = computed(() =>
    this.toolDefs.map((t) => {
      const state = this.actions.state(t.id);
      const status = t.id === 'OPEN_TASK_DLG' ? this.taskStatus() : null;
      const label = shortLabel(t.id);
      return {
        ...t,
        label: status ? `${label} ${status.text}` : label,
        status,
        ready: state === 'ready',
        title: this.title(t.id, state, this.actions.shortcutLabel(t.id)),
      };
    }),
  );

  protected run(id: ActionId, ready: boolean): void {
    if (ready) {
      void this.actions.run(id);
    }
  }

  protected openThemeMenu(evt: MouseEvent): void {
    if (this.themeMenu()) {
      this.themeMenu.set(null);
      return;
    }
    const anchor = evt.currentTarget as HTMLElement;
    const rect = anchor.getBoundingClientRect();
    this.themeMenu.set({ x: rect.left, y: rect.top, anchor });
  }

  protected onThemeChosen(id: string): void {
    this.themeMenu.set(null);
    if (id === 'system') {
      void this.theme.followSystem();
    } else if (id === 'edit') {
      void this.actions.run('OPEN_THEMES_DLG');
      return;
    } else if (id.startsWith('theme:')) {
      void this.theme.select(id.slice('theme:'.length));
    }
    this.focusThemeToggle();
  }

  protected onThemeMenuClosed(reason: MenuCloseReason): void {
    this.themeMenu.set(null);
    if (reason !== 'outside') {
      this.focusThemeToggle();
    }
  }

  private focusThemeToggle(): void {
    setTimeout(() => document.querySelector<HTMLElement>('.theme-toggle')?.focus());
  }

  protected onMenuClosed(reason: 'key' | 'outside' | 'chosen'): void {
    this.menuOpen.set(false);
    if (reason === 'key') {
      setTimeout(() => document.querySelector<HTMLElement>('.actions-toggle')?.focus());
    }
  }

  private title(id: ActionId, state: string, shortcut: string): string {
    const label = shortLabel(id);
    if (state === 'unavailable') {
      return `${label} – ${TEXTS.comingIn(ACTIONS[id].availableIn)}`;
    }
    return shortcut ? `${label} (${shortcut})` : label;
  }
}
