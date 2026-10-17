import { describe, expect, it } from 'vitest';
import { blend, contrastRatio, parseColor, toHex } from './color';

describe('color', () => {
  it('parses hex, rgb()/rgba() and names', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0098DB')).toEqual({ r: 0, g: 152, b: 219, a: 1 });
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.5, 2);
    expect(parseColor('#f008')?.a).toBeCloseTo(0.53, 2);
    expect(parseColor('rgb(22, 35, 50)')).toEqual({ r: 22, g: 35, b: 50, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.75)')).toEqual({ r: 0, g: 0, b: 0, a: 0.75 });
    expect(parseColor('rgb(0 0 0 / 25%)')).toEqual({ r: 0, g: 0, b: 0, a: 0.25 });
    expect(parseColor('rgb(100% 0% 0%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor(' Orange ')).toEqual({ r: 255, g: 165, b: 0, a: 1 });
    expect(parseColor('transparent')?.a).toBe(0);
    for (const bad of ['', 'inherit', '#ggg', '#12345', 'rgb(1,2)', 'hsl(0 0% 0%)', 'var(--x)']) {
      expect(parseColor(bad)).toBeNull();
    }
  });

  it('computes WCAG contrast ratios', () => {
    const c = (s: string) => parseColor(s)!;
    expect(contrastRatio(c('#000'), c('#fff'))).toBeCloseTo(21, 5);
    expect(contrastRatio(c('#fff'), c('#fff'))).toBeCloseTo(1, 5);
    // known value: #767676 on white is the AA limit (4.54)
    expect(contrastRatio(c('#767676'), c('#fff'))).toBeCloseTo(4.54, 2);
    // cypress (019): text #657786 on rgb(22,35,50) is below AA
    expect(contrastRatio(c('#657786'), c('rgb(22, 35, 50)'))).toBeLessThan(4.5);
    // translucent background is painted on the base first
    expect(contrastRatio(c('#000'), c('transparent'), c('#fff'))).toBeCloseTo(21, 5);
  });

  it('blends and formats', () => {
    expect(blend(parseColor('rgb(0 0 0 / 50%)')!, parseColor('#fff')!)).toEqual({
      r: 128,
      g: 128,
      b: 128,
      a: 1,
    });
    expect(toHex(parseColor('rgb(1, 2, 255)')!)).toBe('#0102ff');
  });
});
