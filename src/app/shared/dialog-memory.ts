import { acceptsValue, SCHEMA } from '../core/settings/settings.models';
import { SettingsStore } from '../core/settings/settings.store';

/** = `maxItems` of `dialogs.recent` in settings-schema.json. */
const MAX_REMEMBERED =
  SCHEMA['dialogs.recent'].type === 'json' ? SCHEMA['dialogs.recent'].maxItems : 12;

/** Tool dialogs that open with the values of their last run (design 027 E5, 046 E6). */
export type RememberedDialog =
  'groupFiles' | 'clean' | 'multiMkdir' | 'checksum' | 'sync' | 'seriesGroup' | 'selectIf';

interface Entry {
  readonly dialog: RememberedDialog;
  readonly value: unknown;
}

function entries(settings: SettingsStore): readonly Entry[] {
  const list = settings.get('dialogs.recent');
  return Array.isArray(list)
    ? list.filter(
        (e): e is Entry =>
          typeof e === 'object' && e !== null && typeof (e as Entry).dialog === 'string',
      )
    : [];
}

/** The value kept for `dialog`, `undefined` if none – unchecked: each dialog restores its own fields. */
export function recallDialog(settings: SettingsStore, dialog: RememberedDialog): unknown {
  return entries(settings).find((e) => e.dialog === dialog)?.value;
}

/** Keeps `value` for `dialog` in the setting `dialogs.recent` (too big → not kept). */
export function rememberDialog(
  settings: SettingsStore,
  dialog: RememberedDialog,
  value: unknown,
): void {
  // newest first; the oldest go when the list is full (`maxItems` in the schema)
  const next = [{ dialog, value }, ...entries(settings).filter((e) => e.dialog !== dialog)].slice(
    0,
    MAX_REMEMBERED,
  );
  if (acceptsValue(SCHEMA['dialogs.recent'], next)) {
    settings.set('dialogs.recent', next);
  }
}
