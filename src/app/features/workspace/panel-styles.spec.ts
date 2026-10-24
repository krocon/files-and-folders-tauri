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

  it('run header, tabs and status line under the splitter (no dark gap behind it)', () => {
    const panel = readFileSync('src/app/features/workspace/file-panel.css', 'utf8');
    expect(rule(panel, ':host(.side-left) .part:not(.list)')).toContain('grid-column: 1 / 3');
    const ws = readFileSync('src/app/features/workspace/workspace.css', 'utf8');
    const splitter = rule(ws, '.splitter');
    expect(splitter).toContain('z-index: 1');
    expect(splitter).not.toContain('opacity');
  });

  it('small buttons in the header are no higher than its text (Keep newest/…/Search again, 042)', () => {
    const css = readFileSync('src/app/features/workspace/file-panel.css', 'utf8');
    // `.btn` brings min-height 36px and min-width 80px from controls.css – too high for the header bar
    const small = rule(css, '.btn.small');
    expect(small).toContain('min-height: 0');
    expect(small).toContain('min-width: 0');
    expect(small).toContain('line-height: inherit');
  });

  it('the menus of the button bar take no place in its flex row (Actions/Tasks stay right)', () => {
    const css = readFileSync('src/app/features/workspace/button-bar/button-bar.css', 'utf8');
    expect(rule(css, 'app-actions-menu,\napp-context-menu')).toContain('display: contents');
  });

  it('selected text in fields uses the contrast-checked selection pair (Norton: unreadable before)', () => {
    const css = readFileSync('src/styles/controls.css', 'utf8');
    const start = css.indexOf('&::selection {');
    const sel = start < 0 ? '' : css.slice(start, css.indexOf('}', start));
    expect(sel).toContain('color: var(--color-selection-text)');
    expect(sel).toContain('background: var(--color-selection)');
  });
});
