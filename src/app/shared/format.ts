import { computed } from '@angular/core';
import { locale } from '../core/i18n/i18n';
import { DISPLAY } from '../core/settings/display';

const BINARY_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;
const DECIMAL_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'] as const;

/** Number formatters of the current locale (cached until the language changes). */
const numbers = computed(() => {
  const loc = locale();
  return {
    one: new Intl.NumberFormat(loc, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      useGrouping: false,
    }),
    whole: new Intl.NumberFormat(loc, { maximumFractionDigits: 0, useGrouping: false }),
    grouped: new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }),
  };
});

/** An integer with the locale's digit grouping (`1,234,567` / `1.234.567`). */
export function formatCount(n: number): string {
  return numbers().grouped.format(n);
}

/**
 * Human readable size in the chosen unit system (design 015): binary multiples
 * shown as KB/MB (1 KB = 1024 B, as before), decimal kB/MB (1 kB = 1000 B) or
 * plain bytes with digit grouping.
 */
export function formatSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  const mode = DISPLAY.sizeFormat();
  const fmt = numbers();
  if (mode === 'bytes') {
    return `${fmt.grouped.format(bytes)} B`;
  }
  const base = mode === 'decimal' ? 1000 : 1024;
  const units = mode === 'decimal' ? DECIMAL_UNITS : BINARY_UNITS;
  if (bytes < base) {
    return `${fmt.whole.format(bytes)} B`;
  }
  let value = bytes;
  let unit = 0;
  while (value >= base && unit < units.length - 1) {
    value /= base;
    unit++;
  }
  // 1023.6 MB would round to "1024 MB" – show "1.0 GB" instead
  if (Math.round(value) >= base && unit < units.length - 1) {
    value /= base;
    unit++;
  }
  return `${(value < 10 ? fmt.one : fmt.whole).format(value)} ${units[unit]}`;
}

const dateFormatter = computed(
  () =>
    new Intl.DateTimeFormat(locale(), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
);

const pad = (n: number) => String(n).padStart(2, '0');

/** `yyyy-mm-dd hh:mm` in local time (the old version's format). */
export function isoDateTime(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function formatModified(ms: number | null): string {
  if (ms === null) {
    return '';
  }
  return DISPLAY.dateFormat() === 'iso' ? isoDateTime(ms) : dateFormatter().format(new Date(ms));
}
