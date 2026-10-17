const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** Human readable size using binary multiples (1 KB = 1024 B). */
export function formatSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  // 1023.6 MB would round to "1024 MB" – show "1.0 GB" instead
  if (Math.round(value) >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${UNITS[unit]}`;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatModified(ms: number | null): string {
  return ms === null ? '' : dateFormatter.format(new Date(ms));
}
