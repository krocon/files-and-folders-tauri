import {
  DEFAULT_FORM,
  errorField,
  formToCriteria,
  presetGlob,
  PRESETS_BUILT_IN,
} from './find-form';

const NOW = new Date(2026, 9, 17, 12, 0, 0).getTime();

function ok(patch: Partial<typeof DEFAULT_FORM>, roots = ['/r']) {
  const r = formToCriteria({ ...DEFAULT_FORM, ...patch }, roots, NOW);
  if ('error' in r) {
    throw new Error(r.error.message);
  }
  return r.criteria;
}

describe('find form → criteria (design 009 E3/E5)', () => {
  it('defaults: everything below the folder, .git and node_modules excluded', () => {
    const c = ok({});
    expect(c).toMatchObject({
      roots: ['/r'],
      name: '',
      nameMode: 'glob',
      wholeName: true,
      kinds: { files: true, dirs: true, links: true },
      minSize: null,
      maxSize: null,
      modifiedFromMs: null,
      modifiedToMs: null,
      excludes: ['.git', 'node_modules'],
      content: null,
      maxHits: 10_000,
      maxDepth: null,
    });
  });

  it('sizes with units, decimal comma', () => {
    const c = ok({ minSize: '1,5', minUnit: 'KB', maxSize: '2', maxUnit: 'GB' });
    expect(c.minSize).toBe(1536);
    expect(c.maxSize).toBe(2 * 1024 ** 3);
  });

  it('last N days and a date range (local days, inclusive)', () => {
    expect(ok({ dateMode: 'days', days: '7' }).modifiedFromMs).toBe(NOW - 7 * 86_400_000);
    const c = ok({ dateMode: 'range', from: '2026-10-01', to: '2026-10-02' });
    expect(c.modifiedFromMs).toBe(new Date(2026, 9, 1).getTime());
    expect(c.modifiedToMs).toBe(new Date(2026, 9, 3).getTime() - 1);
    expect(ok({ dateMode: 'any', days: '7' }).modifiedFromMs).toBeNull();
  });

  it('content with size limit, depth, hits capped', () => {
    const c = ok({
      content: 'Wörld',
      contentCase: true,
      maxFileSizeMb: '2',
      maxDepth: '3',
      maxHits: '999999',
    });
    expect(c.content).toEqual({ text: 'Wörld', caseSensitive: true, maxFileSize: 2 * 1024 ** 2 });
    expect(c.maxDepth).toBe(3);
    expect(c.maxHits).toBe(100_000);
  });

  it('reports the invalid field', () => {
    const err = (patch: Partial<typeof DEFAULT_FORM>) => {
      const r = formToCriteria({ ...DEFAULT_FORM, ...patch }, ['/r'], NOW);
      return 'error' in r ? r.error.field : null;
    };
    expect(err({ minSize: 'abc' })).toBe('minSize');
    expect(err({ maxSize: '-1' })).toBe('maxSize');
    expect(err({ dateMode: 'days', days: 'x' })).toBe('days');
    expect(err({ maxDepth: '0' })).toBe('maxDepth');
    expect(err({ files: false, dirs: false, links: false })).toBe('kinds');
    expect(err({ dateMode: 'range', from: 'yesterday' })).toBe('from');
    expect(errorField({ code: 'invalid_pattern', message: '', path: null })).toBe('name');
    expect(errorField({ code: 'not_found', message: '', path: null })).toBeNull();
  });

  it('templates become globs (mr format)', () => {
    expect(presetGlob({ label: 'x', extensions: ['.mp3', 'flac', '*.ogg', ' '] })).toBe(
      '*.mp3;*.flac;*.ogg',
    );
    const comics = PRESETS_BUILT_IN.find((p) => p.label.startsWith('Comics'))!;
    expect(presetGlob(comics)).toBe('*.cbr;*.cbz');
  });
});
