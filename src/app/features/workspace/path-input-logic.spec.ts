import { endsWithSeparator } from './path-input-logic';

describe('path input (design 079 E2)', () => {
  it('a typed path that ends with a separator means a folder', () => {
    expect(endsWithSeparator('/a/b.mp4/')).toBe(true);
    expect(endsWithSeparator('/a/b.mp4/  ')).toBe(true);
    expect(endsWithSeparator('C:\\videos\\clip.mp4\\')).toBe(true);
    expect(endsWithSeparator('~/x/')).toBe(true);
    expect(endsWithSeparator('/a/b.mp4')).toBe(false);
    expect(endsWithSeparator('C:\\videos\\clip.mp4')).toBe(false);
    expect(endsWithSeparator('/a/Ünï cödé 🎬.mp4')).toBe(false);
    expect(endsWithSeparator('')).toBe(false);
  });
});
