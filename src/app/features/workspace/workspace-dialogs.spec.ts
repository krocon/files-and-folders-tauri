// @ts-expect-error -- node types are not part of the app's tsconfig; vitest runs in node
import { readFileSync } from 'node:fs';

/**
 * Every dialog kind has its own `@case` in the workspace with exactly one dialog
 * component (review 039: two dialogs added inside the case of another one never
 * showed, while their kind kept the keyboard).
 */
describe('workspace dialogs', () => {
  it('each DialogKind has its own @case with one dialog component', () => {
    const service: string = readFileSync('src/app/shared/dialog/dialog.service.ts', 'utf8');
    const start = service.indexOf('export type DialogKind');
    const union = service.slice(start, service.indexOf(';', start));
    const kinds = [...union.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    const html: string = readFileSync('src/app/features/workspace/workspace.html', 'utf8');
    const bodies = new Map(
      [...html.matchAll(/@case \('([a-z-]+)'\) \{([^}]*)\}/g)].map((m) => [m[1], m[2]]),
    );
    expect(kinds.length).toBeGreaterThan(30);
    const wrong = kinds.filter((k) => (bodies.get(k)?.match(/<app-[a-z-]+/g) ?? []).length !== 1);
    expect(wrong).toEqual([]);
  });
});
