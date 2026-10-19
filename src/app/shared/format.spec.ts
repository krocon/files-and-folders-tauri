import { afterEach } from 'vitest';
import { DISPLAY } from '../core/settings/display';
import { setLanguage } from '../core/i18n/i18n';
import { formatModified, formatSize, isoDateTime } from './format';

describe('formatSize', () => {
  it('uses binary units', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(286 * 1024 * 1024)).toBe('286 MB');
    expect(formatSize(null)).toBe('');
  });

  it('never shows 1024 of a unit – rounding moves to the next unit', () => {
    expect(formatSize(1023.6 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatSize(1023.6 * 1024)).toBe('1.0 MB');
    expect(formatSize(1023.4 * 1024)).toBe('1023 KB');
  });
});

describe('formats follow the settings and the locale', () => {
  afterEach(() => {
    DISPLAY.sizeFormat.set('binary');
    DISPLAY.dateFormat.set('iso');
    setLanguage('en');
  });

  it('decimal, bytes and the German decimal comma', () => {
    DISPLAY.sizeFormat.set('decimal');
    expect(formatSize(1500)).toBe('1.5 kB');
    expect(formatSize(999)).toBe('999 B');
    DISPLAY.sizeFormat.set('bytes');
    expect(formatSize(1234567)).toBe('1,234,567 B');
    setLanguage('de');
    expect(formatSize(1234567)).toBe('1.234.567 B');
    DISPLAY.sizeFormat.set('binary');
    expect(formatSize(1536)).toBe('1,5 KB');
  });

  it('iso date with local time', () => {
    const ms = new Date(2024, 0, 5, 7, 3).getTime();
    expect(isoDateTime(ms)).toBe('2024-01-05 07:03');
    DISPLAY.dateFormat.set('iso');
    expect(formatModified(ms)).toBe('2024-01-05 07:03');
    DISPLAY.dateFormat.set('locale');
    expect(formatModified(ms)).not.toBe('2024-01-05 07:03');
    DISPLAY.dateFormat.set('iso');
    expect(formatModified(null)).toBe('');
  });
});
