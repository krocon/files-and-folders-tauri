import { describe, expect, it } from 'vitest';
import { hexDump } from './hex';
import { modeOctal, modeString } from './permissions';
import { findMatches, segmentsOf, splitLines, stepMatch } from './text-search';
import { viewerStepFor } from './viewer-keys';

describe('text viewer helpers (design 010 E8)', () => {
  it('splits lines on every line ending', () => {
    expect(splitLines('a\r\nb\nc\rd')).toEqual(['a', 'b', 'c', 'd']);
    expect(splitLines('')).toEqual(['']);
  });

  it('finds matches case-insensitively, also Unicode and special characters', () => {
    const lines = ['Größe GRÖSSE größe', 'a.b (x)', 'nichts'];
    expect(findMatches(lines, 'größe')).toEqual([
      { line: 0, start: 0, end: 5 },
      { line: 0, start: 13, end: 18 },
    ]);
    expect(findMatches(lines, '(x)')).toEqual([{ line: 1, start: 4, end: 7 }]);
    expect(findMatches(lines, '.')).toEqual([{ line: 1, start: 1, end: 2 }]);
    expect(findMatches(lines, '')).toEqual([]);
    expect(findMatches(['aaaa'], 'a', 3)).toHaveLength(3);
    expect(findMatches(['🎉 x 🎉'], '🎉')).toHaveLength(2);
  });

  it('steps through matches with wrap-around', () => {
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(-1, 3, -1)).toBe(2);
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });

  it('splits a line into plain and marked segments', () => {
    const ms = findMatches(['ab ab'], 'ab');
    expect(segmentsOf('ab ab', ms, ms[1])).toEqual([
      { text: 'ab', mark: 'hit' },
      { text: ' ', mark: 'none' },
      { text: 'ab', mark: 'current' },
    ]);
    expect(segmentsOf('', [], null)).toEqual([{ text: '', mark: 'none' }]);
  });

  it('formats a hex dump', () => {
    const bytes = [...'Hello, World!\n'].map((c) => c.charCodeAt(0)).concat([0, 255, 0x41]);
    const lines = hexDump(bytes).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      '00000000  48 65 6c 6c 6f 2c 20 57  6f 72 6c 64 21 0a 00 ff |Hello, World!...|',
    );
    expect(lines[1].startsWith('00000010  41 ')).toBe(true);
    expect(lines[1].endsWith('|A|')).toBe(true);
    expect(hexDump([])).toBe('');
  });

  it('formats unix modes', () => {
    expect(modeString(0o755)).toBe('rwxr-xr-x');
    expect(modeString(0o640)).toBe('rw-r-----');
    expect(modeString(0o4755)).toBe('rwsr-xr-x');
    expect(modeString(0o2644)).toBe('rw-r-Sr--');
    expect(modeString(0o1777)).toBe('rwxrwxrwt');
    expect(modeString(0o1666)).toBe('rw-rw-rwT');
    expect(modeOctal(0o755)).toBe('755');
    expect(modeOctal(0o4755)).toBe('4755');
    expect(modeOctal(0o7)).toBe('007');
  });
});

describe('viewer keys (review 5)', () => {
  const at = (tagName: string, inToolbar = false) => ({ tagName, inToolbar });

  it('steps with Space/←/→/Backspace on the content', () => {
    expect(viewerStepFor('Space', at('DIV'))).toBe(1);
    expect(viewerStepFor('ArrowRight', at('DIV'))).toBe(1);
    expect(viewerStepFor('ArrowLeft', at('DIV'))).toBe(-1);
    expect(viewerStepFor('Backspace', at('DIV'))).toBe(-1);
    expect(viewerStepFor('W', at('DIV'))).toBeNull();
  });

  it('leaves Space to a focused button and ←/→ to the toolbar', () => {
    expect(viewerStepFor('Space', at('BUTTON', true))).toBeNull();
    expect(viewerStepFor('Space', at('BUTTON'))).toBeNull();
    expect(viewerStepFor('ArrowRight', at('BUTTON', true))).toBeNull();
    expect(viewerStepFor('ArrowLeft', at('SPAN', true))).toBeNull();
    expect(viewerStepFor('ArrowRight', at('BUTTON'))).toBe(1); // a button outside the toolbar
  });
});
