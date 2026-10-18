// @ts-expect-error -- node types are not part of the app's tsconfig; vitest runs in node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The rule body of `selector { … }` (first match, top level). */
function rule(scss: string, selector: string): string {
  const start = scss.indexOf(`\n${selector} {`);
  return start < 0 ? '' : scss.slice(start, scss.indexOf('\n}', start));
}

describe('panel styles', () => {
  it('do not paint the tab row with the list background (review 013 #3)', () => {
    const scss = readFileSync('src/app/features/workspace/file-panel.css', 'utf8');
    // `.part[_ngcontent]` beats the tab bar's `:host` – a background there hides --color-header-bg
    expect(rule(scss, '.part')).not.toContain('background');
    expect(rule(scss, '.list')).toContain('background: var(--color-list-bg)');
  });
});
