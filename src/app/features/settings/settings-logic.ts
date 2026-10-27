import { SCHEMA, SettingKey } from '../../core/settings/settings.models';
import { SETTINGS_TEXTS } from './settings-texts';

/** Sections of the settings dialog (design 015 E6). */
export type SectionId =
  | 'general'
  | 'view'
  | 'behavior'
  | 'shell'
  | 'palette'
  | 'keyboard'
  | 'tools'
  | 'colors'
  | 'customize'
  | 'data';

export interface Section {
  readonly id: SectionId;
  /** The settings shown as controls (others have own content). */
  readonly keys: readonly SettingKey[];
}

export const SECTIONS: readonly Section[] = [
  { id: 'general', keys: ['general.language', 'general.startFolder'] },
  {
    id: 'view',
    keys: [
      'view.sizeFormat',
      'view.dateFormat',
      'view.density',
      'view.folderBrackets',
      'view.hideExtension',
      'view.showHidden',
      'view.menuBar',
    ],
  },
  {
    id: 'behavior',
    keys: [
      'behavior.deleteToTrash',
      'behavior.confirmTrash',
      'behavior.doubleClick',
      'behavior.spaceCalcSize',
      'behavior.rememberFolders',
      'watch.pollNetwork',
      'diskUsage.sizeMode',
      'diskUsage.crossFilesystems',
      'diskUsage.chart',
      'search.recent',
      'search.templates',
      'dialogs.recent',
    ],
  },
  { id: 'shell', keys: ['shell.enabled', 'shell.loginPath', 'shell.windowsShell'] },
  {
    id: 'palette',
    keys: [
      'palette.index',
      'palette.roots',
      'palette.excludes',
      'palette.maxMemoryMb',
      'palette.includeHidden',
      'palette.systemSearch',
      'palette.maxHits',
    ],
  },
  { id: 'keyboard', keys: [] },
  { id: 'tools', keys: [] },
  { id: 'colors', keys: [] },
  { id: 'customize', keys: [] },
  { id: 'data', keys: [] },
];

/** A note under the control: when the setting applies, if not at once. */
export const NOTES: Partial<Record<SettingKey, 'restart' | 'newTabs'>> = {
  'general.startFolder': 'restart',
  'view.showHidden': 'newTabs',
};

/** Lower case without diacritics (`Größe` → `grosse`, `ä` → `a`). */
export function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss');
}

/** The searchable text of a setting in the current language: label, help, keywords, values. */
export function settingText(key: SettingKey): string {
  const t = SETTINGS_TEXTS;
  const item = t.items[key];
  const spec = SCHEMA[key];
  const values = spec.type === 'enum' ? spec.values.map((v) => t.values[v] ?? v) : [];
  return [item.label, item.help, item.keywords, ...values].join(' ');
}

/** The searchable text of a section with own content (keyboard, tools, …). */
export function sectionText(id: SectionId): string {
  const t = SETTINGS_TEXTS;
  switch (id) {
    case 'keyboard':
      return [t.cat.keyboard, t.keyboardIntro, t.editShortcuts, t.resetShortcuts].join(' ');
    case 'tools':
      return [t.cat.tools, t.toolsIntro, t.editTools].join(' ');
    case 'colors':
      return [t.cat.colors, t.colorsIntro, t.editColors].join(' ');
    case 'customize':
      return [t.cat.customize, t.customizeIntro, t.editButtons, t.editFileTypes].join(' ');
    case 'data':
      return [t.cat.data, t.dataIntro, t.export, t.import, t.resetAll].join(' ');
    case 'shell':
      return [t.cat.shell, t.shellIntro, t.clearShellHistory].join(' ');
    default:
      return t.cat[id];
  }
}

/** Every word of the query occurs in the text (diacritics and case ignored). */
export function matches(query: string, text: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hay = fold(text);
  return words.every((w) => hay.includes(w));
}

export interface SearchHitSection {
  readonly id: SectionId;
  readonly keys: readonly SettingKey[];
  /** The section's own content matched (keyboard, tools, colours, data). */
  readonly content: boolean;
}

/** Matching settings grouped by section; empty query = nothing. */
export function searchSettings(
  query: string,
  hidden: ReadonlySet<SettingKey> = new Set(),
): SearchHitSection[] {
  if (!query.trim()) {
    return [];
  }
  const out: SearchHitSection[] = [];
  for (const s of SECTIONS) {
    const keys = s.keys.filter((k) => !hidden.has(k) && matches(query, settingText(k)));
    const content = s.keys.length === 0 && matches(query, sectionText(s.id));
    if (keys.length > 0 || content) {
      out.push({ id: s.id, keys, content });
    }
  }
  return out;
}

/** Number of hits (settings + sections with own content). */
export function hitCount(hits: readonly SearchHitSection[]): number {
  return hits.reduce((n, h) => n + h.keys.length + (h.content ? 1 : 0), 0);
}
