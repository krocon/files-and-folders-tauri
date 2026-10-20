import { FileType } from '../config/config.models';
import {
  cleanFileTypes,
  fileTypeGlob,
  fileTypeProblems,
  indexFileTypes,
  normalizeExtension,
  parseExtensions,
  sameFileTypes,
} from './file-types-logic';
// @ts-expect-error node:fs in a spec (see builtin-themes.spec.ts)
import { readFileSync } from 'node:fs';

const ft = (label: string, extensions: string[], icon: string | null = null): FileType => ({
  label,
  extensions,
  icon,
  color: null,
});

describe('file type logic (design 022)', () => {
  it('normalises extensions like Rust', () => {
    expect(normalizeExtension(' *.JPG ')).toBe('.jpg');
    expect(normalizeExtension('tar.gz')).toBe('.tar.gz');
    expect(normalizeExtension('ä')).toBe('.ä');
    for (const bad of ['', '.', '*', 'a b', 'a/b', 'a\\b', 'a?', 'c:', 'x'.repeat(33)]) {
      expect(normalizeExtension(bad), bad).toBeNull();
    }
    expect(normalizeExtension('x'.repeat(32))).not.toBeNull();
  });

  it('parses typed extensions: separators, duplicates, invalid parts', () => {
    expect(parseExtensions('.cbz, CBR;*.cbz\n  epub  a/b')).toEqual({
      extensions: ['.cbz', '.cbr', '.epub'],
      invalid: ['a/b'],
    });
    expect(parseExtensions('   ')).toEqual({ extensions: [], invalid: [] });
  });

  it('finds problems per category', () => {
    const list = [ft('Bilder', []), ft(' bilder ', []), ft('', []), ft('n'.repeat(65), [])];
    // both of a pair are marked (Rust would keep the first)
    expect(fileTypeProblems(list, 0)).toEqual(['labelTaken']);
    expect(fileTypeProblems(list, 1)).toEqual(['labelTaken']);
    expect(fileTypeProblems(list, 2)).toEqual(['labelMissing']);
    expect(fileTypeProblems(list, 3)).toEqual(['labelTooLong']);
    const many = Array.from({ length: 201 }, (_, i) => `.e${i}`);
    expect(fileTypeProblems([ft('x', many)], 0)).toEqual(['tooManyExtensions']);
  });

  it('keeps only known icons and colours', () => {
    const out = cleanFileTypes([
      { label: 'a', extensions: ['.a'], icon: 'fa-book', color: 'document' },
      { label: 'b', extensions: [], icon: 'fa-unknown', color: 'red' as never },
    ]);
    expect(out[0]).toEqual({ label: 'a', extensions: ['.a'], icon: 'fa-book', color: 'document' });
    expect(out[1].icon).toBeNull();
    expect(out[1].color).toBeNull();
    expect(
      sameFileTypes(
        out,
        out.map((t) => ({ ...t })),
      ),
    ).toBe(true);
    expect(sameFileTypes(out, out.slice(1))).toBe(false);
  });

  it('indexes extensions: the first category wins', () => {
    const a = ft('a', ['.sh', '.PY']);
    const b = ft('b', ['.sh', '.rb']);
    const idx = indexFileTypes([a, b]);
    expect(idx.byExtension.get('sh')).toBe(a);
    expect(idx.byExtension.get('py')).toBe(a);
    expect(idx.byExtension.get('rb')).toBe(b);
    expect(fileTypeGlob(b)).toBe('*.sh *.rb');
  });

  it('every icon of the list exists in Font Awesome 4.5.0', async () => {
    const { FILE_TYPE_ICONS } = await import('./file-types-logic');
    const css: string = readFileSync('src/assets/font-awesome-4.5.0/css/font-awesome.css', 'utf8');
    const missing = FILE_TYPE_ICONS.filter((i) => !css.includes(`.${i}:before`));
    expect(missing).toEqual([]);
  });
});
