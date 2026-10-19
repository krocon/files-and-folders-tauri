import { signal } from '@angular/core';

/**
 * Display preferences read by plain formatting functions and table renderers
 * (no injection there). Set by the `SettingsStore` (design 015 E3).
 */
export type SizeFormat = 'binary' | 'decimal' | 'bytes';
export type DateFormat = 'locale' | 'iso';

export const DISPLAY = {
  sizeFormat: signal<SizeFormat>('binary'),
  dateFormat: signal<DateFormat>('iso'),
  folderBrackets: signal(false),
  hideExtension: signal(false),
  /** Hidden files in new tabs. */
  showHidden: signal(false),
};
