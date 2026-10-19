import { ACTION_TEXTS } from './action-texts';
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

/**
 * Taken by native items of the macOS application menu (Quit, Close, Hide, Minimize,
 * Hide others) – never bound there. `Mod+,` is not reserved: it is the default of
 * `OPEN_SETUP_DLG`, which is the Settings item of that menu (design 014 E9).
 */
export const RESERVED_MACOS: readonly string[] = ['Mod+Q', 'Mod+W', 'Mod+H', 'Mod+M', 'Mod+Alt+H'];

export interface ResolvedKeymap {
  readonly bindings: Bindings;
  /** Canonical shortcut → action. */
  readonly lookup: ReadonlyMap<string, ActionId>;
  /** Problems found while merging (shown as notices). */
  readonly problems: readonly string[];
  /** The conflicts among them (one shortcut for two actions, chord prefixes). */
  readonly conflicts: readonly string[];
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
  const conflicts: string[] = [];
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
        problems.push(ACTION_TEXTS.invalidShortcut(source, raw, id));
      } else if (blocked.has(c)) {
        problems.push(ACTION_TEXTS.reservedShortcut(source, raw, id));
      } else if (!out.includes(c)) {
        out.push(c);
      }
    }
    return out;
  };

  const merged = new Map<ActionId, string[]>();
  for (const [id, list] of Object.entries(defaults)) {
    if (isActionId(id)) {
      merged.set(id, normalise(ACTION_TEXTS.defaultKeymap, id, list));
    } else {
      problems.push(ACTION_TEXTS.unknownDefault(id));
    }
  }
  const overridden = new Set<ActionId>();
  for (const [id, list] of Object.entries(override)) {
    if (!isActionId(id)) {
      problems.push(ACTION_TEXTS.unknownOverride(id));
      continue;
    }
    merged.set(id, normalise(ACTION_TEXTS.shortcutFile, id, Array.isArray(list) ? list : []));
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
        conflicts.push(ACTION_TEXTS.conflict(s, owner, id));
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
      conflicts.push(ACTION_TEXTS.chordBlocked(first, s));
    }
  }
  problems.push(...conflicts);
  return { bindings: Object.fromEntries(merged) as Bindings, lookup, problems, conflicts };
}
