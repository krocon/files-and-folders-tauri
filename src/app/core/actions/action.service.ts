import { computed, inject, Injectable, signal } from '@angular/core';
import { toFsError } from '../fs/fs-error';
import { ACTIONS, ActionId, isActionId } from './action-catalog';
import { KeymapApi } from './keymap-api';
import { DEFAULT_KEYMAPS, RawBindings, resolveKeymap } from './keymap';
import { detectPlatform, Platform } from './platform';
import { canonicalShortcut, formatShortcut } from './shortcut';

export interface ActionHandler {
  run(): void | Promise<void>;
  /** Freigaberegel (mr §3); absent = always enabled. */
  enabled?(): boolean;
}

export type ActionState = 'ready' | 'disabled' | 'unavailable';

/**
 * An action that is not in the catalog – an external tool from `tools.json`
 * (design 011 E4). Id `tool:<id>`; its shortcut uses the keymap notation and
 * never wins over a keymap binding.
 */
export interface ExtraAction {
  readonly id: string;
  readonly label: string;
  readonly shortcut: string | null;
  enabled(): boolean;
  run(): void | Promise<unknown>;
}

/**
 * Central place for actions: handlers registered by the features, the effective
 * keymap (defaults + override) and running an action by id. Root service.
 */
@Injectable({ providedIn: 'root' })
export class ActionService {
  private readonly api = inject(KeymapApi);
  private readonly handlers = new Map<ActionId, ActionHandler>();
  private readonly registered = signal(0);

  readonly platform = signal<Platform>(detectPlatform());
  readonly override = signal<RawBindings>({});
  /** Messages for the user (problems in keymaps, failed actions). */
  readonly messages = signal<readonly string[]>([]);

  readonly keymap = computed(() =>
    resolveKeymap(this.platform(), this.override(), DEFAULT_KEYMAPS[this.platform()]),
  );

  readonly extras = signal<readonly ExtraAction[]>([]);

  /** Canonical shortcut → extra action; taken or invalid shortcuts are left out (see `extraProblems`). */
  private readonly extraIndex = computed(() => {
    const platform = this.platform();
    const taken = this.keymap().lookup;
    const lookup = new Map<string, ExtraAction>();
    const labels = new Map<string, string>();
    const problems: string[] = [];
    for (const x of this.extras()) {
      if (!x.shortcut) {
        continue;
      }
      const canon = canonicalShortcut(x.shortcut, platform);
      if (!canon) {
        problems.push(`${x.label}: the shortcut "${x.shortcut}" is not valid.`);
      } else if (taken.has(canon) || lookup.has(canon)) {
        const other = taken.get(canon);
        const owner = other ? ACTIONS[other].label : lookup.get(canon)!.label;
        problems.push(`${x.label}: the shortcut ${x.shortcut} is taken by "${owner}".`);
      } else {
        lookup.set(canon, x);
        labels.set(x.id, formatShortcut(canon, platform));
      }
    }
    return { lookup, labels, problems };
  });

  /** Problems with the shortcuts of the extra actions. */
  readonly extraProblems = computed(() => this.extraIndex().problems);

  /** Replaces the extra actions (tools). */
  setExtras(list: readonly ExtraAction[]): void {
    this.extras.set(list);
  }

  extraFor(canonical: string): ExtraAction | null {
    return this.extraIndex().lookup.get(canonical) ?? null;
  }

  extraShortcutLabel(id: string): string {
    return this.extraIndex().labels.get(id) ?? '';
  }

  /** Runs an extra action; errors become a message. Returns true if it ran. */
  async runExtra(id: string): Promise<boolean> {
    const x = this.extras().find((e) => e.id === id);
    if (!x || !x.enabled()) {
      return false;
    }
    try {
      await x.run();
      return true;
    } catch (err) {
      this.report(`${x.label}: ${toFsError(err).message}`);
      return false;
    }
  }

  /** Loads the user's override and reports its problems. */
  async init(): Promise<void> {
    try {
      const loaded = await this.api.load();
      this.override.set(loaded.bindings ?? {});
      if (loaded.warning) {
        this.report(loaded.warning);
      }
    } catch (err) {
      this.report(`The keyboard shortcuts could not be loaded: ${toFsError(err).message}`);
    }
    for (const p of this.keymap().problems) {
      this.report(p);
    }
  }

  /** Registers handlers; returns a function that removes them again. */
  register(handlers: Partial<Record<ActionId, ActionHandler>>): () => void {
    const ids = Object.keys(handlers) as ActionId[];
    for (const id of ids) {
      this.handlers.set(id, handlers[id]!);
    }
    this.registered.update((n) => n + 1);
    return () => {
      for (const id of ids) {
        if (this.handlers.get(id) === handlers[id]) {
          this.handlers.delete(id);
        }
      }
      this.registered.update((n) => n + 1);
    };
  }

  state(id: ActionId): ActionState {
    this.registered();
    const h = this.handlers.get(id);
    if (!h) {
      return 'unavailable';
    }
    return h.enabled && !h.enabled() ? 'disabled' : 'ready';
  }

  /** Runs an action; unavailable/disabled ones only explain why. Returns true if it ran. */
  async run(id: ActionId): Promise<boolean> {
    const h = this.handlers.get(id);
    if (!h) {
      this.report(
        `${ACTIONS[id].label.replace(/…$/, '')} – coming in prompt ${ACTIONS[id].availableIn}.`,
      );
      return false;
    }
    if (h.enabled && !h.enabled()) {
      return false;
    }
    try {
      await h.run();
      return true;
    } catch (err) {
      this.report(`${ACTIONS[id].label}: ${toFsError(err).message}`);
      return false;
    }
  }

  /** Runs a catalog action or an extra action (tool) by id – what every menu item does. */
  runAny(id: string): Promise<boolean> {
    return isActionId(id) ? this.run(id) : this.runExtra(id);
  }

  private lastKey: { id: string; at: number } | null = null;

  /** The keyboard dispatcher started `id` (native menus ignore their echo, design 014 E6). */
  noteKeyRun(id: string, now = Date.now()): void {
    this.lastKey = { id, at: now };
  }

  /** True if the keyboard started `id` less than `windowMs` ago. */
  ranByKeyRecently(id: string, windowMs = 400, now = Date.now()): boolean {
    return this.lastKey !== null && this.lastKey.id === id && now - this.lastKey.at < windowMs;
  }

  private lastSuppressed: { id: string; at: number } | null = null;

  /**
   * The dispatcher held the shortcut of `id` back on purpose (text input, focus-scoped
   * key): a native accelerator for the same key must not run it either (review 014 #1).
   */
  noteKeySuppressed(id: string, now = Date.now()): void {
    this.lastSuppressed = { id, at: now };
  }

  /** True if the keyboard ran `id` or held it back less than `windowMs` ago. */
  handledByKeyRecently(id: string, windowMs = 400, now = Date.now()): boolean {
    const s = this.lastSuppressed;
    return (
      this.ranByKeyRecently(id, windowMs, now) ||
      (s !== null && s.id === id && now - s.at < windowMs)
    );
  }

  shortcuts(id: ActionId): readonly string[] {
    return this.keymap().bindings[id] ?? [];
  }

  /** First shortcut for display (`⌘⇧P`, `Ctrl+Shift+P`), `''` if none. */
  shortcutLabel(id: ActionId): string {
    const first = this.shortcuts(id)[0];
    return first ? formatShortcut(first, this.platform()) : '';
  }

  /** Sets (`list`) or resets (`null`) the override of one action and saves it. */
  async setOverride(id: ActionId, list: readonly string[] | null): Promise<void> {
    const next: Record<string, readonly string[]> = { ...this.override() };
    if (list === null) {
      delete next[id];
    } else {
      next[id] = list;
    }
    this.override.set(next);
    try {
      await this.api.save(next);
    } catch (err) {
      this.report(`The keyboard shortcuts could not be saved: ${toFsError(err).message}`);
    }
  }

  report(text: string): void {
    this.messages.update((m) => (m.includes(text) ? m : [...m, text]));
  }

  dismiss(index: number): void {
    this.messages.update((m) => m.filter((_, i) => i !== index));
  }
}
