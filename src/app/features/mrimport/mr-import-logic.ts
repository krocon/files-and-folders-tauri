import { ActionId, isActionId } from '../../core/actions/action-catalog';
import {
  RawBindings,
  RESERVED_MACOS,
  resolveKeymap,
  TABLE_NAVIGATION_KEYS,
} from '../../core/actions/keymap';
import { Platform } from '../../core/actions/platform';
import { canonicalShortcut } from '../../core/actions/shortcut';
import {
  ButtonSetsOverride,
  FileType,
  MAX_BUTTON_SLOTS,
  MAX_FILE_TYPES,
} from '../../core/config/config.models';
import {
  MrApply,
  MrArea,
  MrScan,
  MrSkipped,
  MrSkipReason,
} from '../../core/mrimport/mr-import.models';
import { acceptsValue, DEFAULTS, SCHEMA, SettingKey } from '../../core/settings/settings.models';
import { DEFAULT_FORM, Preset, presetGlob } from '../search/find-form';
import { SearchTemplate } from '../search/search.store';

/**
 * Planning of the mr import against the current state (design 026 E1, E4–E10): pure
 * functions, no texts. Rust translated the old files; here is decided what changes,
 * what conflicts and what is already there.
 */

export type MrAreaId =
  'shortcuts' | 'buttons' | 'fileTypes' | 'search' | 'tools' | 'colors' | 'setup';
export const MR_AREAS: readonly MrAreaId[] = [
  'shortcuts',
  'buttons',
  'fileTypes',
  'search',
  'tools',
  'colors',
  'setup',
];
export type ImportMode = 'merge' | 'replace';

/** The keymap allows at most this many shortcuts per action (Rust `keymap::MAX_SHORTCUTS`). */
export const MAX_SHORTCUTS_PER_ACTION = 8;
/** Schema limit of `search.templates`. */
export const MAX_TEMPLATES = 50;

/** What the import is planned against. */
export interface ImportState {
  readonly platform: Platform;
  /** The user's keymap override. */
  readonly override: RawBindings;
  /** The sets of the user's `buttons.json`. */
  readonly buttons: ButtonSetsOverride;
  /** The user's `filetypes.json`, null = built in. */
  readonly fileTypes: readonly FileType[] | null;
  readonly builtInFileTypes: readonly FileType[];
  readonly templates: readonly SearchTemplate[];
  readonly builtInPresets: readonly Preset[];
  /** Ids of the tools in use (built in and own). */
  readonly toolIds: readonly string[];
  /** Names of all schemes (built in and own) and of the own ones. */
  readonly themeNames: readonly string[];
  readonly ownThemeNames: readonly string[];
  readonly settings: Readonly<Record<string, unknown>>;
}

/** A conflict: a shortcut moves to another action, or an own entry of that name is replaced. */
export type Conflict =
  | {
      readonly kind: 'shortcut';
      readonly shortcut: string;
      readonly from: ActionId;
      readonly to: ActionId;
    }
  | { readonly kind: 'name'; readonly name: string }
  /** Replace mode: the own shortcuts of this action are dropped. */
  | { readonly kind: 'action'; readonly id: ActionId }
  /** The shortcut of an imported tool is taken: the tool gets none (review 026 #10). */
  | {
      readonly kind: 'toolShortcut';
      readonly tool: string;
      readonly shortcut: string;
      readonly owner: ActionId;
    };

export interface AreaPlan {
  readonly area: MrAreaId;
  /** The file read (null = not found). */
  readonly file: string | null;
  readonly error: MrSkipReason | null;
  /** Entries that change something. */
  readonly count: number;
  /** Equal to mr's defaults or already here. */
  readonly unchanged: number;
  readonly conflicts: readonly Conflict[];
  readonly skipped: readonly MrSkipped[];
  /** Not transferred beyond the reported ones (only counted). */
  readonly skippedMore: number;
  /** What to write for this area (null = nothing). */
  readonly apply: MrApply | null;
  /** Colour files to import through the theme import (E9). */
  readonly colorPaths: readonly string[];
}

function plan(
  area: MrAreaId,
  source: MrArea<unknown> | null,
  over: Partial<AreaPlan> = {},
): AreaPlan {
  return {
    area,
    file: source?.file ?? null,
    error: source?.error ?? null,
    count: 0,
    unchanged: source?.unchanged ?? 0,
    conflicts: [],
    skipped: source?.skipped ?? [],
    skippedMore: source?.skippedMore ?? 0,
    apply: null,
    colorPaths: [],
    ...over,
  };
}

/** E4: imported shortcuts are added to the action; another owner loses them (import wins). */
export function planShortcuts(
  source: MrScan['shortcuts'],
  state: ImportState,
  mode: ImportMode,
): AreaPlan {
  if (!source || source.error) {
    return plan('shortcuts', source);
  }
  const { platform } = state;
  const base: RawBindings = mode === 'replace' ? {} : state.override;
  const resolved = resolveKeymap(platform, base);
  const blocked = new Set(
    [...TABLE_NAVIGATION_KEYS, ...(platform === 'macos' ? RESERVED_MACOS : [])].map(
      (s) => canonicalShortcut(s, platform) ?? s,
    ),
  );
  const next: Record<string, readonly string[]> = { ...base };
  const lookup = new Map(resolved.lookup);
  const listOf = (id: ActionId): readonly string[] => next[id] ?? resolved.bindings[id] ?? [];
  const skipped: MrSkipped[] = [...source.skipped];
  const conflicts: Conflict[] = [];
  if (mode === 'replace') {
    for (const id of Object.keys(state.override).filter(isActionId)) {
      conflicts.push({ kind: 'action', id });
    }
  }
  let count = 0;
  let unchanged = source.unchanged;
  for (const item of source.items) {
    const skip = (reason: MrSkipReason) => skipped.push({ item: item.source, reason });
    if (!isActionId(item.id)) {
      skip('unknown_action');
      continue;
    }
    const c = canonicalShortcut(item.shortcut, platform);
    if (c === null) {
      skip('invalid_shortcut');
      continue;
    }
    if (blocked.has(c)) {
      skip('reserved');
      continue;
    }
    const owner = lookup.get(c);
    if (owner === item.id) {
      unchanged++;
      continue;
    }
    const list = listOf(item.id);
    if (list.length >= MAX_SHORTCUTS_PER_ACTION) {
      skip('too_many');
      continue;
    }
    if (owner) {
      next[owner] = listOf(owner).filter((s) => s !== c);
      conflicts.push({ kind: 'shortcut', shortcut: c, from: owner, to: item.id });
    }
    next[item.id] = [...list, c];
    lookup.set(c, item.id);
    count++;
  }
  return plan('shortcuts', source, {
    count,
    unchanged,
    conflicts,
    skipped,
    apply: count > 0 ? { keymap: next } : null,
  });
}

function sameList(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return !!a && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** E5: an imported set replaces the set of the same name. */
export function planButtons(
  source: MrScan['buttons'],
  state: ImportState,
  mode: ImportMode,
): AreaPlan {
  if (!source || source.error) {
    return plan('buttons', source);
  }
  const sets: Record<string, readonly string[]> = mode === 'replace' ? {} : { ...state.buttons };
  const skipped: MrSkipped[] = [...source.skipped];
  const conflicts: Conflict[] = [];
  if (mode === 'replace') {
    for (const set of Object.keys(state.buttons).filter((x) => !(x in source.items))) {
      conflicts.push({ kind: 'name', name: set });
    }
  }
  let count = 0;
  let unchanged = source.unchanged;
  for (const [set, ids] of Object.entries(source.items)) {
    const known = ids.filter((id) => {
      const ok = isActionId(id);
      if (!ok) {
        skipped.push({ item: `${set}: ${id}`, reason: 'unknown_action' });
      }
      return ok;
    });
    const valid = known.slice(0, MAX_BUTTON_SLOTS);
    if (sameList(state.buttons[set], valid)) {
      unchanged++;
      continue;
    }
    if (state.buttons[set] !== undefined) {
      conflicts.push({ kind: 'name', name: set });
    }
    sets[set] = valid;
    count++;
  }
  return plan('buttons', source, {
    count,
    unchanged,
    conflicts,
    skipped,
    apply: count > 0 ? { buttons: sets } : null,
  });
}

function extensionKey(extensions: readonly string[]): string {
  return [
    ...new Set(
      extensions.map((e) =>
        e
          .trim()
          .toLowerCase()
          .replace(/^\*?\.?/, '.'),
      ),
    ),
  ]
    .sort()
    .join(' ');
}

/** E6: merge by name (case-insensitive) into the list in use, or the mr list as it is. */
export function planFileTypes(
  source: MrScan['fileTypes'],
  state: ImportState,
  mode: ImportMode,
): AreaPlan {
  if (!source || source.error || source.items.length === 0) {
    return plan('fileTypes', source);
  }
  const own = state.fileTypes;
  if (mode === 'replace') {
    const same =
      (own ?? state.builtInFileTypes).length === source.items.length &&
      source.items.every(
        (c, i) =>
          c.label === (own ?? state.builtInFileTypes)[i].label &&
          extensionKey(c.extensions) ===
            extensionKey((own ?? state.builtInFileTypes)[i].extensions),
      );
    return plan('fileTypes', source, {
      count: same ? 0 : source.items.length,
      unchanged: source.unchanged + (same ? source.items.length : 0),
      conflicts: same ? [] : (own ?? []).map((c) => ({ kind: 'name', name: c.label }) as const),
      apply: same ? null : { fileTypes: source.items.slice(0, MAX_FILE_TYPES) },
    });
  }
  const list: FileType[] = [...(own ?? state.builtInFileTypes)];
  const skipped: MrSkipped[] = [...source.skipped];
  const conflicts: Conflict[] = [];
  let count = 0;
  let unchanged = source.unchanged;
  for (const c of source.items) {
    const i = list.findIndex((x) => x.label.toLowerCase() === c.label.toLowerCase());
    if (i >= 0) {
      if (extensionKey(list[i].extensions) === extensionKey(c.extensions)) {
        unchanged++;
        continue;
      }
      if (own !== null) {
        conflicts.push({ kind: 'name', name: list[i].label });
      }
      // keep icon and colour of the category it replaces (mr had none)
      list[i] = { ...c, icon: c.icon ?? list[i].icon, color: c.color ?? list[i].color };
    } else if (list.length >= MAX_FILE_TYPES) {
      skipped.push({ item: c.label, reason: 'too_many' });
      continue;
    } else {
      list.push(c);
    }
    count++;
  }
  return plan('fileTypes', source, {
    count,
    unchanged,
    conflicts,
    skipped,
    apply: count > 0 ? { fileTypes: list } : null,
  });
}

/** E7: patterns as own search templates; built-in ones (same extensions) are left out. */
export function planSearch(
  source: MrScan['search'],
  state: ImportState,
  mode: ImportMode,
): AreaPlan {
  if (!source || source.error) {
    return plan('search', source);
  }
  const builtIn = new Set(state.builtInPresets.map((p) => extensionKey(p.extensions)));
  const templates: SearchTemplate[] = mode === 'replace' ? [] : [...state.templates];
  const skipped: MrSkipped[] = [...source.skipped];
  const conflicts: Conflict[] = [];
  if (mode === 'replace') {
    for (const t of state.templates.filter((x) => !source.items.some((p) => p.label === x.label))) {
      conflicts.push({ kind: 'name', name: t.label });
    }
  }
  let count = 0;
  let unchanged = source.unchanged;
  for (const p of source.items) {
    if (builtIn.has(extensionKey(p.extensions))) {
      unchanged++;
      continue;
    }
    const form = {
      ...DEFAULT_FORM,
      name: presetGlob(p),
      nameMode: 'glob' as const,
      wholeName: true,
    };
    const i = templates.findIndex((t) => t.label === p.label);
    let before: SearchTemplate | undefined;
    if (i >= 0) {
      if (templates[i].form.name === form.name) {
        unchanged++;
        continue;
      }
      conflicts.push({ kind: 'name', name: p.label });
      before = templates[i];
      templates[i] = { label: p.label, form };
    } else if (templates.length >= MAX_TEMPLATES) {
      skipped.push({ item: p.label, reason: 'too_many' });
      continue;
    } else {
      templates.push({ label: p.label, form });
    }
    // review 026 #3: what does not fit into the setting is left out, the rest stays
    if (!acceptsValue(SCHEMA['search.templates'], templates)) {
      if (i >= 0) {
        templates[i] = before ?? templates[i];
        conflicts.pop();
      } else {
        templates.pop();
      }
      skipped.push({ item: p.label, reason: 'too_big' });
      continue;
    }
    count++;
  }
  return plan('search', source, {
    count,
    unchanged,
    conflicts,
    skipped,
    apply: count > 0 ? { settings: { 'search.templates': templates } } : null,
  });
}

/**
 * E8: only the tools chosen one by one (review 026 #1); an own tool of the same id is
 * replaced. Rust reads them again from `root` and writes nothing if the file no longer
 * matches `digest` (#2). A taken or invalid tool shortcut is shown (#10).
 */
export function planTools(
  source: MrScan['tools'],
  state: ImportState,
  mode: ImportMode,
  root: string,
  chosen: ReadonlySet<string>,
): AreaPlan {
  if (!source || source.error || source.items.length === 0) {
    return plan('tools', source);
  }
  const picked = source.items.filter((t) => chosen.has(t.id));
  const lookup = resolveKeymap(state.platform, state.override).lookup;
  const conflicts: Conflict[] = [];
  const skipped: MrSkipped[] = [...source.skipped];
  for (const t of picked) {
    if (state.toolIds.includes(t.id)) {
      conflicts.push({ kind: 'name', name: t.label });
    }
    if (t.shortcut) {
      const c = canonicalShortcut(t.shortcut, state.platform);
      const owner = c === null ? undefined : lookup.get(c);
      if (c === null) {
        skipped.push({ item: `${t.label}: ${t.shortcut}`, reason: 'invalid_shortcut' });
      } else if (owner) {
        conflicts.push({ kind: 'toolShortcut', tool: t.label, shortcut: c, owner });
      }
    }
  }
  return plan('tools', source, {
    count: picked.length,
    conflicts,
    skipped,
    apply:
      picked.length > 0
        ? {
            tools: {
              from: root,
              digest: source.digest ?? '',
              ids: picked.map((t) => t.id),
              replace: mode === 'replace',
            },
          }
        : null,
  });
}

/** E9: every own colour file becomes a scheme (a built-in name gets a suffix). */
export function planColors(source: MrScan['colors'], state: ImportState): AreaPlan {
  if (!source || source.error || source.items.length === 0) {
    return plan('colors', source);
  }
  // an own scheme of that name = imported before (a second import adds no copies)
  const own = new Set(state.ownThemeNames.map((n) => n.toLowerCase()));
  const names = new Set(state.themeNames.map((n) => n.toLowerCase()));
  const files = source.items.filter((f) => !own.has(f.name.toLowerCase()));
  return plan('colors', source, {
    count: files.length,
    unchanged: source.unchanged + source.items.length - files.length,
    conflicts: files
      .filter((f) => names.has(f.name.toLowerCase()))
      .map((f) => ({ kind: 'name', name: f.name })),
    apply: files.length > 0 ? { backupThemes: true } : null,
    colorPaths: files.map((f) => f.path),
  });
}

/** E10: switches with an equivalent; a value the user changed counts as a conflict. */
export function planSetup(source: MrScan['setup'], state: ImportState): AreaPlan {
  if (!source || source.error) {
    return plan('setup', source);
  }
  const changes: Record<string, unknown> = {};
  const conflicts: Conflict[] = [];
  let unchanged = source.unchanged;
  for (const [key, value] of Object.entries(source.items)) {
    if (!Object.prototype.hasOwnProperty.call(SCHEMA, key)) {
      continue;
    }
    const current = state.settings[key];
    if (current === value) {
      unchanged++;
      continue;
    }
    if (current !== DEFAULTS[key as SettingKey]) {
      conflicts.push({ kind: 'name', name: key });
    }
    changes[key] = value;
  }
  const count = Object.keys(changes).length;
  return plan('setup', source, {
    count,
    unchanged,
    conflicts,
    apply: count > 0 ? { settings: changes } : null,
  });
}

/** All areas in the order of {@link MR_AREAS}. */
export function planAll(
  scan: MrScan,
  state: ImportState,
  mode: ImportMode,
  chosenTools: ReadonlySet<string> = new Set(),
): readonly AreaPlan[] {
  return [
    planShortcuts(scan.shortcuts, state, mode),
    planButtons(scan.buttons, state, mode),
    planFileTypes(scan.fileTypes, state, mode),
    planSearch(scan.search, state, mode),
    planTools(scan.tools, state, mode, scan.root, chosenTools),
    planColors(scan.colors, state),
    planSetup(scan.setup, state),
  ];
}

/** Areas checked after a scan: everything with something to import, except tools (E8). */
export function defaultSelection(plans: readonly AreaPlan[]): ReadonlySet<MrAreaId> {
  return new Set(plans.filter((p) => p.count > 0 && p.area !== 'tools').map((p) => p.area));
}

/** One request for the chosen areas; settings of search and setup are merged. */
export function combine(plans: readonly AreaPlan[], chosen: ReadonlySet<MrAreaId>): MrApply {
  let out: MrApply = {};
  for (const p of plans) {
    if (!chosen.has(p.area) || !p.apply) {
      continue;
    }
    const settings =
      out.settings || p.apply.settings ? { ...out.settings, ...p.apply.settings } : undefined;
    out = { ...out, ...p.apply, ...(settings ? { settings } : {}) };
  }
  return out;
}
