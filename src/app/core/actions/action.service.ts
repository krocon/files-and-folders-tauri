import { computed, inject, Injectable, signal } from '@angular/core';
import { toFsError } from '../fs/fs-error';
import { ACTIONS, ActionId } from './action-catalog';
import { KeymapApi } from './keymap-api';
import { DEFAULT_KEYMAPS, RawBindings, resolveKeymap } from './keymap';
import { detectPlatform, Platform } from './platform';
import { formatShortcut } from './shortcut';

export interface ActionHandler {
  run(): void | Promise<void>;
  /** Freigaberegel (mr §3); absent = always enabled. */
  enabled?(): boolean;
}

export type ActionState = 'ready' | 'disabled' | 'unavailable';

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
