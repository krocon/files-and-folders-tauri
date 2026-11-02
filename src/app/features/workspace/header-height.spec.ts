import { describe, expect, it } from 'vitest';
// @ts-expect-error – node module in a spec (vitest runs in node)
import { readFileSync } from 'node:fs';

/** The rule block of `selector` (first occurrence at the start of a line). */
function block(css: string, selector: string): string {
  const start = css.search(new RegExp(`^${selector.replace('.', '\\.')} \\{`, 'm'));
  return start < 0 ? '' : css.slice(start, css.indexOf('\n}', start));
}

describe('panel header keeps its height (049)', () => {
  const css = readFileSync('src/app/features/workspace/file-panel.css', 'utf8') as string;

  it('the header line has a fixed height from the layout token', () => {
    expect(block(css, '.header')).toContain('height: var(--panel-header-height)');
    expect(readFileSync('src/styles.css', 'utf8')).toContain('--panel-header-height:');
  });

  it('the path field and its error fit into one header line', () => {
    expect(block(css, '.path-input')).toContain('height: var(--panel-header-line)');
    expect(block(css, '.path-input')).toContain('box-sizing: border-box');
    expect(block(css, '.path-error')).toContain('line-height: var(--panel-header-line)');
  });
});
