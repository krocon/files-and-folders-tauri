import { ACT_TEXTS } from '../../actions/actions-texts';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActionService } from '../../../core/actions/action.service';
import { ACTIONS, ActionId, shortLabel } from '../../../core/actions/action-catalog';
import { KeyboardDispatcher } from '../../../core/actions/keyboard-dispatcher';
import { badgeFor } from '../../../core/actions/shortcut';
import { isFinished } from '../../../core/jobs/jobs.models';
import { JobsStore } from '../../../core/jobs/jobs.store';
import { ThemeService } from '../../../core/theme/theme.service';
import { ActionsMenu } from '../../actions/actions-menu';
import { THEME_TEXTS } from '../../themes/theme-texts';
import { resolveMenu, STARTER_POPUP } from '../../menus/menu-model';
import { MENU_TEXTS } from '../../menus/menu-texts';
import { ContextMenu, MenuCloseReason, MenuItem } from '../context-menu';
import { TEXTS } from '../texts';
import { modifierSet } from './button-config';
import { ButtonConfigStore } from '../../config/button-config.store';

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
    <div class="functions" role="toolbar" [attr.aria-label]="t.functions">
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
    <div class="tools" role="toolbar" [attr.aria-label]="t.tools">
      <button
        type="button"
        class="fbtn start-toggle"
        aria-haspopup="menu"
        [attr.aria-expanded]="startMenu() !== null"
        [attr.aria-keyshortcuts]="startShortcut() || null"
        [attr.title]="startTitle()"
        (click)="toggleStartMenu($event)"
      >
        @if (startShortcut(); as k) {
          <kbd class="badge">{{ k }}</kbd>
        }
        <span>{{ t.start }}</span> <i class="fa fa-caret-up" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="fbtn actions-toggle"
        aria-haspopup="menu"
        [attr.aria-expanded]="menuOpen()"
        (click)="menuOpen.set(!menuOpen())"
      >
        <span>{{ t.actions }}</span> <i class="fa fa-caret-up" aria-hidden="true"></i>
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
          <i [class]="t.icon" [class.fa-spin]="t.status?.spinning" aria-hidden="true"></i>
          @if (t.showLabel) {
            <span aria-hidden="true"
              ><span class="label-word" [class.pulse]="t.status?.spinning">{{ t.word }}</span
              >{{ t.status ? ' ' + t.status.text : '' }}</span
            >
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
    @if (startMenu(); as pos) {
      <app-context-menu
        [items]="startItems()"
        [x]="pos.x"
        [y]="pos.y"
        [label]="menuTexts.starterMenu"
        [anchor]="pos.anchor"
        (chosen)="onStartChosen($event)"
        (closed)="onStartMenuClosed($event)"
      />
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
  styleUrl: './button-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ButtonBar {
  protected readonly t = ACT_TEXTS;
  private readonly actions = inject(ActionService);
  private readonly keys = inject(KeyboardDispatcher);
  private readonly jobs = inject(JobsStore);
  private readonly theme = inject(ThemeService);
  private readonly config = inject(ButtonConfigStore);
  protected readonly menuOpen = signal(false);

  constructor() {
    // mr OPEN_MENU: the Actions menu by keyboard (018 J7)
    inject(DestroyRef).onDestroy(
      this.actions.register({ OPEN_ACTIONS_MENU: { run: () => this.menuOpen.set(true) } }),
    );
  }
  /** Start ▴ (design 032): the starter menu above its button – position or closed. */
  protected readonly startMenu = signal<{ x: number; y: number; anchor: Element } | null>(null);
  protected readonly menuTexts = MENU_TEXTS;
  /** Live entries (states, shortcuts, the tree may change while it is open). */
  protected readonly startItems = computed(() =>
    resolveMenu(STARTER_POPUP, this.actions, this.actions.platform()),
  );
  /** Badge of the menu's own shortcut (Alt+S, keymap). */
  protected readonly startShortcut = computed(() => {
    this.actions.keymap();
    return this.actions.shortcutLabel('OPEN_STARTER_MENU');
  });
  protected readonly startTitle = computed(() => {
    const k = this.startShortcut();
    return k ? `${MENU_TEXTS.starterMenu} (${k})` : MENU_TEXTS.starterMenu;
  });

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
    { id: 'OPEN_TASK_DLG', icon: 'fa fa-cog', showLabel: true },
    { id: 'OPEN_THEMES_DLG', icon: 'fa fa-paint-brush', showLabel: false },
    { id: 'OPEN_SHORTCUT_DLG', icon: 'fa fa-keyboard-o', showLabel: false },
  ];

  protected readonly buttons = computed(() => {
    const held = this.keys.held();
    const platform = this.actions.platform();
    this.actions.keymap();
    return this.config.sets()[modifierSet(held, platform)].map((id) => {
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
    // the gear turns and the word pulses while a task really works – not while all wait for an
    // answer or are paused
    const spinning = this.jobs.active().some((j) => j.state === 'running');
    const progress = this.jobs.overallProgress();
    return {
      text: `${finished} / ${visible.length}`,
      percent: progress === null ? 0 : Math.round(progress * 100),
      waiting,
      spinning,
    };
  });

  protected readonly tools = computed(() =>
    this.toolDefs.map((t) => {
      const state = this.actions.state(t.id);
      const status = t.id === 'OPEN_TASK_DLG' ? this.taskStatus() : null;
      const label = shortLabel(t.id);
      return {
        ...t,
        word: label,
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

  protected toggleStartMenu(evt: MouseEvent): void {
    if (this.startMenu()) {
      this.startMenu.set(null);
      return;
    }
    const anchor = evt.currentTarget as HTMLElement;
    const rect = anchor.getBoundingClientRect();
    this.startMenu.set({ x: rect.left, y: rect.top, anchor });
  }

  protected onStartChosen(id: string): void {
    this.startMenu.set(null);
    // like every menu: the action runs after the menu is gone (a dialog gets the focus)
    setTimeout(() => void this.actions.runAny(id));
  }

  protected onStartMenuClosed(reason: MenuCloseReason): void {
    this.startMenu.set(null);
    if (reason !== 'outside') {
      setTimeout(() => document.querySelector<HTMLElement>('.start-toggle')?.focus());
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
