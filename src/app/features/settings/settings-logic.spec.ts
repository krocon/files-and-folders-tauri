import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../core/i18n/i18n';
import { SETTING_KEYS } from '../../core/settings/settings.models';
import { describeSettingsWarning } from './settings-warnings';
import { fold, hitCount, matches, searchSettings, SECTIONS } from './settings-logic';

describe('settings dialog logic', () => {
  afterEach(() => setLanguage('en'));

  it('shows every setting in exactly one section', () => {
    const shown = SECTIONS.flatMap((s) => s.keys);
    expect([...shown].sort()).toEqual([...SETTING_KEYS].sort());
  });

  it('folds case and diacritics', () => {
    expect(fold('Größe Ä')).toBe('grosse a');
    expect(matches('grosse', 'Dateigrößen')).toBe(true);
    expect(matches('date size', 'Date format, size')).toBe(true);
    expect(matches('date xyz', 'Date format')).toBe(false);
  });

  it('searches labels, help, keywords and values in the current language', () => {
    expect(searchSettings('')).toEqual([]);
    const hits = searchSettings('trash');
    expect(hits.map((h) => h.id)).toEqual(['behavior']);
    expect(hits[0].keys).toContain('behavior.deleteToTrash');
    expect(searchSettings('kB').flatMap((h) => h.keys)).toContain('view.sizeFormat');
    expect(searchSettings('export').map((h) => h.id)).toEqual(['data']);
    setLanguage('de');
    expect(searchSettings('papierkorb').flatMap((h) => h.keys)).toContain('behavior.confirmTrash');
    expect(hitCount(searchSettings('kürzel'))).toBeGreaterThan(0);
  });

  it('hides settings of other platforms', () => {
    expect(searchSettings('menu bar', new Set(['view.menuBar']))).toEqual([]);
  });

  it('translates warning codes', () => {
    expect(
      describeSettingsWarning({ code: 'broken', key: null, path: '/c/settings.json.bad' }),
    ).toContain('settings.json.bad');
    setLanguage('de');
    expect(describeSettingsWarning({ code: 'newer_version', key: null, path: null })).toContain(
      'neueren',
    );
  });
});
