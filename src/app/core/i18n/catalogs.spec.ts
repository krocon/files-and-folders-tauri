import { afterEach, describe, expect, it } from 'vitest';
import { CATALOGS, PHRASEBOOKS, setLanguage } from './i18n';
import { ACTION_IDS, ACTION_LABELS_EN } from '../actions/action-catalog';
import { ACTION_LABELS_DE } from '../actions/action-catalog.de';
import '../actions/action-texts';
import '../fs/fs-error-texts';
import { CONTRAST_PAIRS } from '../theme/theme-logic';
import { GROUP_LABEL_SOURCES, TOKENS } from '../theme/tokens';
import { THEME_LABELS_DE } from '../theme/theme-labels.de';
import '../../features/about/about-texts';
import '../../features/actions/actions-texts';
import '../../features/archive/archive-texts';
import '../../features/attributes/attributes-texts';
import '../../features/cleanfolders/clean-texts';
import '../../features/config/config-texts';
import '../../features/dnd/dnd-logic';
import '../../features/duplicates/duplicates-texts';
import '../../features/groupfiles/groupfiles-texts';
import '../../features/jobs/job-format';
import '../../features/menus/menu-texts';
import '../../features/multimkdir/multimkdir-texts';
import '../../features/multirename/multirename-texts';
import '../../features/mrimport/mr-import-texts';
import '../../features/ops/ops-texts';
import '../../features/osintegration/os-texts';
import '../../features/preview/preview-texts';
import '../../features/search/search-texts';
import '../../features/settings/settings-texts';
import '../../features/shell/shell-texts';
import '../../features/themes/theme-texts';
import '../../features/workspace/texts';

/** Same in both languages on purpose (names, symbols, technical terms). */
const SAME = new Set([
  'OK',
  'Esc',
  'Name',
  'Tabs',
  'Tab',
  'Filter',
  'Regex',
  'Glob',
  'Text',
  'Info',
  'Home',
  'Tasks',
  'Tools',
  'Links',
  'Nr.',
  'In',
  'Audio',
  'Videos',
  'Comics',
  'System',
  'Archiv',
  'Syntax',
  'Normal',
  'Bytes',
  'English',
  'Deutsch',
  'Shell',
  'cmd.exe',
  'PowerShell',
  'Files and Folders',
  'Tauri 2 · Angular · Rust',
  'Marc Kronberg',
  '100 %',
  '–',
  '∞',
  'Hex',
  'Pause',
  'in',
  'Cursor',
  'Tooltip',
  'Buttons',
  'Tool-Konfiguration',
  'min.',
  'max.',
  'Version',
  'Tasks…',
  'Build',
  'Tauri',
  'GuiExpert Table',
  'github.com/krocon/files-and-folders-tauri',
  'macOS',
  'Windows',
  'Linux',
  'Format',
  'ZIP',
  'TAR',
  'TAR.GZ',
  'RAR',
]);

const SAMPLE_ARGS: unknown[] = [2, 'x', 3, 4];

function walk(path: string, en: unknown, de: unknown, problems: string[], same: string[]): void {
  if (typeof en === 'string') {
    if (typeof de !== 'string' || (de.trim() === '' && en.trim() !== '')) {
      problems.push(`${path}: missing or empty`);
    } else if (de === en && !SAME.has(en) && /[a-z]{3}/i.test(en)) {
      same.push(`${path}: "${en}"`);
    }
  } else if (typeof en === 'function') {
    if (typeof de !== 'function') {
      problems.push(`${path}: not a function`);
      return;
    }
    if (de.length !== (en as (...a: unknown[]) => unknown).length) {
      problems.push(`${path}: ${de.length} instead of ${en.length} parameters`);
    }
    let a: unknown;
    let b: unknown;
    try {
      a = (en as (...x: unknown[]) => unknown)(...SAMPLE_ARGS);
      b = (de as (...x: unknown[]) => unknown)(...SAMPLE_ARGS);
    } catch {
      return; // the sample arguments do not fit this function's types
    }
    if (typeof a === 'string' && (typeof b !== 'string' || b === '')) {
      problems.push(`${path}(): no text`);
    }
  } else if (en && typeof en === 'object') {
    if (!de || typeof de !== 'object') {
      problems.push(`${path}: missing object`);
      return;
    }
    const ek = Object.keys(en).sort();
    const dk = Object.keys(de).sort();
    for (const k of ek) {
      walk(
        `${path}.${k}`,
        (en as Record<string, unknown>)[k],
        (de as Record<string, unknown>)[k],
        problems,
        same,
      );
    }
    for (const k of dk.filter((k) => !ek.includes(k))) {
      problems.push(`${path}.${k}: only in German`);
    }
  }
}

describe('translation catalogs (design 015)', () => {
  afterEach(() => setLanguage('en'));

  it('registers all catalogs', () => {
    expect(CATALOGS.size).toBeGreaterThanOrEqual(19);
  });

  it('German has every key of English, with the same signatures, and translates the texts', () => {
    const problems: string[] = [];
    const same: string[] = [];
    for (const [name, { en, tr }] of CATALOGS) {
      if (name.startsWith('test.')) continue;
      walk(name, en, tr['de'], problems, same);
    }
    expect(problems).toEqual([]);
    expect(same).toEqual([]);
  });

  it('every action has a German label', () => {
    for (const id of ACTION_IDS) {
      expect(ACTION_LABELS_DE[id], id).toBeTruthy();
    }
    const untranslated = ACTION_IDS.filter(
      (id) => ACTION_LABELS_DE[id] === ACTION_LABELS_EN[id] && !SAME.has(ACTION_LABELS_EN[id]),
    );
    expect(untranslated).toEqual([]);
  });

  it('every colour token, group and contrast pair has a German label', () => {
    const labels = [
      ...TOKENS.map((t) => t.label),
      ...CONTRAST_PAIRS.map((p) => p.label),
      ...GROUP_LABEL_SOURCES,
    ];
    expect(labels.filter((l) => !(l in THEME_LABELS_DE))).toEqual([]);
    expect(PHRASEBOOKS.has('themeLabels')).toBe(true);
    setLanguage('de');
    expect(TOKENS[0].label).toBe(THEME_LABELS_DE['Window background']);
  });
});
