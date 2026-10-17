import { formatSize } from './format';

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
