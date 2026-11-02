// @ts-expect-error – node:fs in a spec (Vitest runs in Node), see builtin-themes.spec.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RESERVED_DIALOG_LETTERS } from './dialog-key';

/** All component templates (inline `.ts` or `.html`) below `src/app`. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) {
      return files(path);
    }
    return /\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

const APP = 'src/app';
const sources = files(APP).map((path) => ({ path, text: readFileSync(path, 'utf-8') as string }));
/** Dialog templates: inline with `<app-modal`, or an `.html` whose component uses the modal. */
const dialogs = sources.filter(
  (f) =>
    f.text.includes('<app-modal') ||
    (f.path.endsWith('.html') &&
      sources.some((t) => t.path === f.path.replace(/\.html$/, '.ts') && t.text.includes('Modal'))),
);

function buttonTags(text: string): string[] {
  // attribute values may contain `>` (comparisons): match quoted values as a whole
  return text.match(/<button\b(?:[^>"']|"[^"]*"|'[^']*')*>/g) ?? [];
}

describe('dialog keys (057): every dialog', () => {
  it('finds the dialogs', () => {
    expect(dialogs.length).toBeGreaterThanOrEqual(40);
  });

  it('gives every primary button a key role (regression for new dialogs)', () => {
    const missing = dialogs.flatMap((f) =>
      buttonTags(f.text)
        .filter((tag) => /class="[^"]*\bprimary\b|\[class\.primary\]/.test(tag))
        .filter((tag) => !tag.includes('appDialogKey'))
        .map((tag) => `${f.path}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`),
    );
    expect(missing).toEqual([]);
  });

  it('never uses a reserved letter and no letter twice in one dialog', () => {
    const problems: string[] = [];
    for (const f of dialogs) {
      const specs = new Set(
        [...f.text.matchAll(/\b(secondary|destructive):([A-Za-z])\b/g)].map((m) => m[0]),
      );
      const seen = new Map<string, string>();
      for (const spec of specs) {
        const [kind, letter] = spec.split(':');
        if (RESERVED_DIALOG_LETTERS.has(letter.toUpperCase())) {
          problems.push(`${f.path}: reserved ${spec}`);
        }
        const key = `${kind === 'destructive' ? 'Shift+' : ''}${letter.toUpperCase()}`;
        if (seen.has(key)) {
          problems.push(`${f.path}: ${spec} and ${seen.get(key)}`);
        }
        seen.set(key, spec);
      }
    }
    expect(problems).toEqual([]);
  });
});
