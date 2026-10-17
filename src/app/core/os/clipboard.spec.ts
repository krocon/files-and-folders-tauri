import { describe, expect, it } from 'vitest';
import { dir, entry } from '../../../testing/fs-fixtures';
import { clipboardText } from './clipboard';

describe('clipboard formats (design 011 E5)', () => {
  const entries = [
    entry('Brief ä.txt', { path: '/home/u/Brief ä.txt' }),
    dir('Ordner "x"', { path: '/home/u/Ordner "x"' }),
    entry('tab\there', { path: '/home/u/tab\there' }),
  ];

  it('names and paths as lines, folders included, order kept', () => {
    expect(clipboardText(entries, 'names', 'lines')).toBe('Brief ä.txt\nOrdner "x"\ntab\there');
    expect(clipboardText(entries, 'paths', 'lines')).toBe(
      '/home/u/Brief ä.txt\n/home/u/Ordner "x"\n/home/u/tab\there',
    );
    expect(clipboardText(entries.slice(0, 1), 'names', 'lines')).toBe('Brief ä.txt');
  });

  it('JSON is an indented array of strings that parses back', () => {
    const json = clipboardText(entries, 'paths', 'json');
    expect(json).toBe(
      '[\n  "/home/u/Brief ä.txt",\n  "/home/u/Ordner \\"x\\"",\n  "/home/u/tab\\there"\n]',
    );
    expect(JSON.parse(json)).toEqual(entries.map((e) => e.path));
    expect(JSON.parse(clipboardText(entries, 'names', 'json'))).toEqual(entries.map((e) => e.name));
  });
});
