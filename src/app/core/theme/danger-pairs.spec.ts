import { describe, expect, it } from 'vitest';
// @ts-expect-error – node module in a spec (vitest runs in node)
import { readdirSync, readFileSync, statSync } from 'node:fs';

function files(dir: string): string[] {
  return (readdirSync(dir) as string[]).flatMap((name: string) => {
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) {
      return files(p);
    }
    return /\.(css|ts)$/.test(p) && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

/** Blocks `{ … }` that set `color: var(--color-danger-text)` (CSS files and inline styles). */
function dangerBlocks(text: string): string[] {
  const out: string[] = [];
  let i = text.indexOf('color: var(--color-danger-text)');
  while (i >= 0) {
    const start = text.lastIndexOf('{', i);
    const end = text.indexOf('}', i);
    out.push(text.slice(start, end));
    i = text.indexOf('color: var(--color-danger-text)', i + 1);
  }
  return out;
}

describe('danger text has its background (E2E 018: invisible "Cancel copying" in Classic light)', () => {
  it('every rule with --color-danger-text also sets --color-danger-bg (the checked contrast pair)', () => {
    const bad = files('src')
      .flatMap((f) => dangerBlocks(readFileSync(f, 'utf8')).map((b) => ({ f, b })))
      .filter(({ b }) => !b.includes('var(--color-danger-bg)'))
      .map(({ f, b }) => `${f}: ${b.replace(/\s+/g, ' ').slice(0, 60)}`);
    expect(bad).toEqual([]);
  });
});
