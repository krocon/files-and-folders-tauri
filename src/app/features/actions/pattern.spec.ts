import { compilePattern, defaultPattern } from './pattern';

const names = ['Foto 1.JPG', 'foto_2.png', 'thumb.jpg', 'Brief.pdf', 'archiv.tar.gz', 'README'];
const run = (text: string, mode: 'glob' | 'regex' = 'glob') =>
  names.filter(compilePattern(text, mode).matches ?? (() => false));

describe('compilePattern', () => {
  it('globs with wildcards, case-insensitive', () => {
    expect(run('*.jpg')).toEqual(['Foto 1.JPG', 'thumb.jpg']);
    expect(run('*.jpg *.png')).toEqual(['Foto 1.JPG', 'foto_2.png', 'thumb.jpg']);
    expect(run('*.???')).toEqual(['Foto 1.JPG', 'foto_2.png', 'thumb.jpg', 'Brief.pdf']);
  });

  it('matches terms without wildcard as substring, | as or, - excludes', () => {
    expect(run('foto')).toEqual(['Foto 1.JPG', 'foto_2.png']);
    expect(run('pdf|gz')).toEqual(['Brief.pdf', 'archiv.tar.gz']);
    expect(run('*.jpg -thumb')).toEqual(['Foto 1.JPG']);
    expect(run('-foto')).toEqual(['thumb.jpg', 'Brief.pdf', 'archiv.tar.gz', 'README']);
  });

  it('treats regex characters in globs literally', () => {
    expect(run('*.tar.gz')).toEqual(['archiv.tar.gz']);
    expect(run('(')).toEqual([]);
  });

  it('supports regular expressions and reports invalid ones', () => {
    expect(run('^f.*\\.(jpe?g|png)$', 'regex')).toEqual(['Foto 1.JPG', 'foto_2.png']);
    const bad = compilePattern('([', 'regex');
    expect(bad.matches).toBeNull();
    expect(bad.error).toBeTruthy();
    expect(compilePattern('  ', 'glob').matches).toBeNull();
  });

  it('suggests the extension of the cursor file', () => {
    expect(defaultPattern('Foto 1.JPG')).toBe('*.JPG');
    expect(defaultPattern('.bashrc')).toBe('*');
    expect(defaultPattern(undefined)).toBe('*');
  });
});
