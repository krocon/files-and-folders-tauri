import { ActionId, isActionId } from './action-catalog';
import macos from './keymaps/macos.json';
import windows from './keymaps/windows.json';
import linux from './keymaps/linux.json';
import { Platform } from './platform';
import { canonicalShortcut } from './shortcut';

/** Action id → shortcuts (canonical strings). */
export type Bindings = Readonly<Partial<Record<ActionId, readonly string[]>>>;
/** As stored in the files: any string keys. */
export type RawBindings = Readonly<Record<string, readonly string[]>>;

export const DEFAULT_KEYMAPS: Readonly<Record<Platform, RawBindings>> = { macos, windows, linux };

/**
 * Keys owned by the GuiExpert Table while the list has the focus (design 002, D6) –
 * never bound to actions.
 */
export const TABLE_NAVIGATION_KEYS: readonly string[] = [
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Mod+Home',
  'Mod+End',
  'Mod+ArrowUp',
  'Mod+ArrowDown',
];

/** Taken by the application menu on macOS (Tauri default menu) – never bound there. */
export const RESERVED_MACOS: readonly string[] = [
  'Mod+Q',
  'Mod+W',
  'Mod+H',
  'Mod+M',
  'Mod+,',
  'Mod+Alt+H',
];

export interface ResolvedKeymap {
  readonly bindings: Bindings;
  /** Canonical shortcut → action. */
  readonly lookup: ReadonlyMap<string, ActionId>;
  /** Problems found while merging (shown as notices). */
  readonly problems: readonly string[];
}

/**
 * Defaults + user override (D4/D5): an override entry replaces the list of that
 * action (`[]` = no shortcut). Unknown ids, invalid or reserved shortcuts and
 * double bindings are reported and skipped; on a conflict the override wins and
 * the other action loses that shortcut.
 */
export function resolveKeymap(
  platform: Platform,
  override: RawBindings = {},
  defaults: RawBindings = DEFAULT_KEYMAPS[platform],
): ResolvedKeymap {
  const problems: string[] = [];
  const blocked = new Set(
    [...TABLE_NAVIGATION_KEYS, ...(platform === 'macos' ? RESERVED_MACOS : [])].map(
      (s) => canonicalShortcut(s, platform) ?? s,
    ),
  );
  const normalise = (source: string, id: string, list: readonly string[]): string[] => {
    const out: string[] = [];
    for (const raw of list) {
      const c = canonicalShortcut(raw, platform);
      if (c === null) {
        problems.push(`${source}: "${raw}" for ${id} is not a valid shortcut.`);
      } else if (blocked.has(c)) {
        problems.push(`${source}: "${raw}" for ${id} is reserved and was ignored.`);
      } else if (!out.includes(c)) {
        out.push(c);
      }
    }
    return out;
  };

  const merged = new Map<ActionId, string[]>();
  for (const [id, list] of Object.entries(defaults)) {
    if (isActionId(id)) {
      merged.set(id, normalise('Default keymap', id, list));
    } else {
      problems.push(`Default keymap: unknown action ${id}.`);
    }
  }
  const overridden = new Set<ActionId>();
  for (const [id, list] of Object.entries(override)) {
    if (!isActionId(id)) {
      problems.push(`Shortcut file: unknown action ${id} was ignored.`);
      continue;
    }
    merged.set(id, normalise('Shortcut file', id, Array.isArray(list) ? list : []));
    overridden.add(id);
  }

  // conflicts: overridden actions first, they win
  const lookup = new Map<string, ActionId>();
  const order = [...merged.keys()].sort(
    (a, b) => Number(overridden.has(b)) - Number(overridden.has(a)),
  );
  for (const id of order) {
    const kept: string[] = [];
    for (const s of merged.get(id) ?? []) {
      const owner = lookup.get(s);
      if (owner && owner !== id) {
        problems.push(`Shortcut ${s} is used by ${owner} and ${id}; ${owner} keeps it.`);
      } else {
        lookup.set(s, id);
        kept.push(s);
      }
    }
    merged.set(id, kept);
  }
  // prefix conflicts with chords: "Ctrl+K" alone and "Ctrl+K F6"
  for (const s of [...lookup.keys()]) {
    const first = s.split(' ')[0];
    if (s.includes(' ') && lookup.has(first)) {
      problems.push(`Shortcut ${first} blocks the chord ${s}.`);
    }
  }
  return { bindings: Object.fromEntries(merged) as Bindings, lookup, problems };
}
