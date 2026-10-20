export type PatternMode = 'glob' | 'regex';

export interface CompiledPattern {
  readonly matches: ((name: string) => boolean) | null;
  /** Set when the pattern is invalid (regex syntax). */
  readonly error: string | null;
}

/**
 * Pattern for "mark by pattern" (Num+ / Num−), case-insensitive.
 * - `glob`: terms separated by spaces; `*` and `?` as wildcards; a term without
 *   wildcard matches as substring (mr); `a|b` = either; `-term` excludes.
 *   Example: `*.jpg *.png -thumb`.
 * - `regex`: a JavaScript regular expression against the name.
 */
export function compilePattern(text: string, mode: PatternMode): CompiledPattern {
  const source = text.trim();
  if (!source) {
    return { matches: null, error: null };
  }
  if (mode === 'regex') {
    try {
      const re = new RegExp(source, 'i');
      return { matches: (name) => re.test(name), error: null };
    } catch (err) {
      return { matches: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const include: RegExp[] = [];
  const exclude: RegExp[] = [];
  for (const term of source.split(/\s+/)) {
    const negative = term.startsWith('-') && term.length > 1;
    const body = negative ? term.slice(1) : term;
    const alternatives = body.split('|').filter(Boolean).map(termToRegex);
    if (alternatives.length === 0) {
      continue;
    }
    const re = new RegExp(alternatives.map((r) => `(?:${r})`).join('|'), 'i');
    (negative ? exclude : include).push(re);
  }
  return {
    matches: (name) =>
      (include.length === 0 || include.some((r) => r.test(name))) &&
      !exclude.some((r) => r.test(name)),
    error: null,
  };
}

function termToRegex(term: string): string {
  const escaped = term.replace(/[.+^${}()[\]\\]/g, '\\$&');
  if (!/[*?]/.test(term)) {
    return escaped; // substring
  }
  return `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`;
}

/** Default pattern: `*.<ext>` of the file under the cursor (mr), otherwise `*`. */
export function defaultPattern(name: string | undefined): string {
  const m = name ? /\.([^.]+)$/.exec(name) : null;
  return m && m.index > 0 ? `*.${m[1]}` : '*';
}
