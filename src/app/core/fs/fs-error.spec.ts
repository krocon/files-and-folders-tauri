import { describeFsError, toFsError } from './fs-error';
import { formatSize } from '../../shared/format';

describe('toFsError', () => {
  it('passes through backend errors', () => {
    expect(toFsError({ code: 'not_found', message: 'gone', path: 'C:\\Daten' })).toEqual({
      code: 'not_found',
      message: 'gone',
      path: 'C:\\Daten',
    });
  });

  it('maps unknown codes and plain errors to "unknown"', () => {
    expect(toFsError({ code: 'weird', message: 'x' }).code).toBe('unknown');
    expect(toFsError(new Error('boom'))).toEqual({ code: 'unknown', message: 'boom', path: null });
    expect(toFsError('text').message).toBe('text');
  });

  it('describes every error code', () => {
    expect(describeFsError(toFsError({ code: 'permission_denied', message: '' }))).toContain(
      'Access denied',
    );
    expect(describeFsError(toFsError('x'))).toBeTruthy();
  });
});

describe('formatSize', () => {
  it('formats bytes with binary units', () => {
    expect(formatSize(null)).toBe('');
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(50 * 1024 * 1024)).toBe('50 MB');
  });
});
