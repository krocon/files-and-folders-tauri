import { SettingsWarning } from '../../core/settings/settings.models';
import { SETTINGS_TEXTS } from './settings-texts';

/** User text of a warning code from Rust (translated by code, design 015 E2). */
export function describeSettingsWarning(w: SettingsWarning): string {
  const t = SETTINGS_TEXTS.warnings;
  switch (w.code) {
    case 'broken':
      return t.broken(w.path);
    case 'unreadable':
      return t.unreadable(w.path);
    case 'newer_version':
      return t.newer_version();
    case 'invalid_value':
      return t.invalid_value(w.key);
    case 'unknown_dropped':
      return t.unknown_dropped(w.key);
    case 'not_saved':
      return t.not_saved();
    default:
      return t.other(w.code);
  }
}
