// @ts-expect-error -- node types are not part of the app's tsconfig; vitest runs in node
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLASSIC_ADJUSTMENTS, CLASSIC_THEMES, DARK, LIGHT } from './builtin-themes';
import { parseColor } from './color';
import { formatColor } from './contrast-fix';
import { convertLegacy, isLegacyFile, legacyColor, toLegacyFile } from './legacy-theme';
import { LEGACY_FALLBACKS, LEGACY_VAR_NAMES, LEGACY_VARS } from './legacy-theme-map';
import { checkContrast, CONTRAST_PAIRS, pairRatio } from './theme-logic';
import { TOKEN_NAMES } from './tokens';

declare const process: { env: Record<string, string | undefined> };

const NAMES = [
  'light',
  'paper',
  'bitbucket',
  'cypress',
  'blackboard',
  'coffee',
  'combat',
  'norton',
];
const REPORT = 'docs/legacy-themes-contrast.md';

interface LegacyFile {
  name: string;
  colors: Record<string, string>;
}

const docs = (n: string): LegacyFile =>
  JSON.parse(readFileSync(`docs/legacy-themes/${n}.json`, 'utf8')) as LegacyFile;

/** Independent resolver for the test: follows `var(--fnf-…)` inside the file. */
function resolve(colors: Record<string, string>, name: string, depth = 0): string | undefined {
  const v = colors[name]?.trim();
  const m = v ? /^var\((--[a-z0-9-]+)\)$/.exec(v) : null;
  return m && depth < 20 ? resolve(colors, m[1], depth + 1) : v;
}

describe('old designs (prompt 019)', () => {
  it('ship the files of docs/legacy-themes unchanged', () => {
    for (const n of NAMES) {
      expect(readFileSync(`src/app/core/theme/legacy/${n}.json`, 'utf8'), n).toBe(
        readFileSync(`docs/legacy-themes/${n}.json`, 'utf8'),
      );
    }
  });

  it('map every one of the 76 variables or leave it out with a reason', () => {
    const all = new Set(NAMES.flatMap((n) => Object.keys(docs(n).colors)));
    expect(all.size).toBe(76);
    expect([...LEGACY_VAR_NAMES].sort()).toEqual([...all].sort());
    expect(LEGACY_VARS.length).toBe(76);
    for (const lv of LEGACY_VARS) {
      for (const t of lv.tokens) {
        expect(TOKEN_NAMES.has(t), `${lv.name} → ${t}`).toBe(true);
      }
      if (!lv.tokens.length) {
        expect(lv.note, `${lv.name} needs a reason`).toBeTruthy();
      }
    }
    for (const [name, chain] of Object.entries(LEGACY_FALLBACKS)) {
      expect(LEGACY_VAR_NAMES.has(name)).toBe(true);
      chain.forEach((c) => expect(LEGACY_VAR_NAMES.has(c)).toBe(true));
    }
  });

  it('keep the original colours except the listed contrast corrections', () => {
    for (const n of NAMES) {
      const { colors } = docs(n);
      const theme = CLASSIC_THEMES.find((t) => t.id === `classic-${n}`)!;
      const adjusted = new Map(CLASSIC_ADJUSTMENTS.get(theme.id)!.map((a) => [a.token, a]));
      // what each token should be: the last variable that maps to it with a usable value
      const expected = new Map<string, string>();
      for (const lv of LEGACY_VARS) {
        const raw = resolve(colors, lv.name);
        const req = lv.requires ? resolve(colors, lv.requires) : 'ok';
        const c = legacyColor(raw);
        if (!c || !req || req === 'inherit' || lv.name === '--fnf-table-font-size') {
          continue;
        }
        lv.tokens.forEach((t) => expected.set(t, formatColor(c)));
      }
      expect(expected.size, n).toBeGreaterThan(40);
      for (const [token, value] of expected) {
        const a = adjusted.get(token);
        if (a) {
          expect(a.from, `${n} ${token} (adjusted)`).toBe(value);
        } else {
          expect(theme.tokens[token], `${n} ${token}`).toBe(value);
        }
      }
      expect(theme.tokens['--font-size-list']).toBe('13px');
    }
  });

  it('fill the gaps of the old files', () => {
    const norton = CLASSIC_THEMES.find((t) => t.id === 'classic-norton')!;
    // Norton: marked = the yellow of the active panel (Norton Commander), tooltip from the dialog
    expect(norton.tokens['--color-marked']).toBe('#fcfc54');
    expect(norton.tokens['--color-tooltip-text']).toBe('#f8fcf8');
    const coffee = convertLegacy(docs('coffee').colors, LIGHT, DARK);
    expect(coffee.filled).toEqual([
      '--fnf-tooltip-bg-color',
      '--fnf-tooltip-color',
      '--fnf-tooltip-background-input-color',
      '--fnf-tooltip-input-color',
    ]);
    // dialogs are `inherit` in coffee → header colours
    expect(coffee.tokens['--color-tooltip-bg']).toBe('#363636');
    // cypress: `#rgb(22, 35, 50)` (typo) → rgb(22, 35, 50) = the list background
    const cypress = CLASSIC_THEMES.find((t) => t.id === 'classic-cypress')!;
    expect(cypress.tokens['--color-scrollbar-track']).toBe('#162332');
    expect(cypress.dark).toBe(true);
    expect(CLASSIC_THEMES.filter((t) => t.dark).map((t) => t.id)).toEqual([
      'classic-cypress',
      'classic-blackboard',
      'classic-coffee',
      'classic-combat',
      'classic-norton',
    ]);
  });

  it('read colours from border shorthands', () => {
    expect(legacyColor('solid 1px #aaa')).toEqual(parseColor('#aaa'));
    expect(legacyColor('1px solid rgb(1, 2, 3)')).toEqual(parseColor('rgb(1,2,3)'));
    expect(legacyColor('inherit')).toBeNull();
    // the typo in cypress (`#rgb(…)`) still yields the intended colour
    expect(legacyColor('#rgb(22, 35, 50)')).toEqual(parseColor('rgb(22, 35, 50)'));
    expect(legacyColor('solid 1px')).toBeNull();
  });

  it('report unknown variables and keep them', () => {
    const c = convertLegacy(
      { ...docs('light').colors, '--fnf-new-thing-color': '#123456', '--color-x': '#000' },
      LIGHT,
      DARK,
    );
    expect(c.unknown).toEqual(['--fnf-new-thing-color']);
    expect(c.tokens['--fnf-new-thing-color']).toBe('#123456');
    expect(c.tokens['--color-x']).toBeUndefined();
    // left-out variables stay too (export in the old format)
    expect(c.tokens['--fnf-dialog-button-secondary-bg-color']).toBe(
      'var(--fnf-material-secondary-color)',
    );
  });

  it('pass the contrast check also for imports of the old files', () => {
    for (const n of NAMES) {
      const c = convertLegacy(docs(n).colors, LIGHT, DARK);
      expect(
        checkContrast(c.tokens)
          .filter((r) => !r.ok)
          .map((r) => r.pair.label),
        n,
      ).toEqual([]);
    }
  });

  it('export in the old format and read it back', () => {
    for (const theme of CLASSIC_THEMES) {
      const file = toLegacyFile(theme.name, theme.tokens);
      expect(isLegacyFile(file)).toBe(true);
      expect(Object.keys(file.colors).length).toBe(76);
      expect(file.colors['--fnf-table-focused-row-bg-color']).toBe(
        theme.tokens['--color-cursor-bg'],
      );
      expect(file.colors['--fnf-header-input-border']).toBe(
        `solid 1px ${theme.tokens['--color-header-input-border']}`,
      );
      const back = convertLegacy(file.colors, LIGHT, DARK);
      expect(back.dark).toBe(theme.dark);
      for (const lv of LEGACY_VARS.filter((l) => l.tokens.length && !l.requires)) {
        expect(back.tokens[lv.tokens[0]], `${theme.id} ${lv.name}`).toBe(
          theme.tokens[lv.tokens[0]],
        );
      }
    }
  });

  it('contrast report (docs/legacy-themes-contrast.md) is up to date', () => {
    const report = buildReport();
    if (process.env['UPDATE_LEGACY_REPORT']) {
      writeFileSync(REPORT, report);
    }
    console.log(report);
    expect(readFileSync(REPORT, 'utf8')).toBe(report);
  });
});

const REPORT_PAIRS = [
  'List',
  'Active panel list',
  'Cursor',
  'Marked',
  'Marked, active panel',
  'Marked under the cursor',
  'Column header',
  'Panel header',
  'Tabs',
  'Selected tab',
  'Selected tab, active panel',
  'Status line',
  'Function buttons',
  'Dialogs',
  'Primary buttons',
];

const ratio = (r: number | null) => (r === null ? '–' : (Math.floor(r * 100) / 100).toFixed(2));

function buildReport(): string {
  const lines = [
    '# Kontrastbericht: die acht Designs der alten Version (Prompt 019)',
    '',
    '> Erzeugt von `src/app/core/theme/legacy-theme.spec.ts` – nicht von Hand ändern. Neu schreiben:',
    '> `UPDATE_LEGACY_REPORT=1 npx vitest run src/app/core/theme/legacy-theme.spec.ts`.',
    '> Quelle: `docs/legacy-themes/*.json` (unverändert). WCAG 2.x, Text ≥ 4.5:1, Linien/Fokus ≥ 3:1.',
    '> „Original“ = die alten Farben nach der Abbildung auf unsere Tokens, „App“ = nach der minimalen',
    '> Korrektur (Mischung Richtung Schwarz/Weiß, Design 019 E4). Werte abgerundet.',
    '',
  ];
  for (const n of NAMES) {
    const c = convertLegacy(docs(n).colors, LIGHT, DARK);
    const failedBefore = CONTRAST_PAIRS.filter((p) => {
      const r = pairRatio(p, c.original);
      return r === null || r < p.min;
    }).length;
    lines.push(`## ${n}${c.dark ? ' (dunkel)' : ' (hell)'}`, '');
    lines.push(
      `${failedBefore} von ${CONTRAST_PAIRS.length} Paaren unter AA im Original, ${c.adjustments.length} Farben angepasst` +
        (c.filled.length ? `, aus Fallbacks: ${c.filled.map((f) => `\`${f}\``).join(', ')}` : '') +
        '.',
      '',
      '| Paar | Original | App |',
      '|---|---:|---:|',
    );
    for (const label of REPORT_PAIRS) {
      const pair = CONTRAST_PAIRS.find((p) => p.label === label)!;
      const before = pairRatio(pair, c.original);
      const after = pairRatio(pair, c.tokens);
      const flag = before !== null && before < pair.min ? ' ⚠' : '';
      lines.push(`| ${label} | ${ratio(before)}${flag} | ${ratio(after)} |`);
    }
    if (c.adjustments.length) {
      lines.push('', '| Token | Original | App | wegen |', '|---|---|---|---|');
      for (const a of c.adjustments) {
        lines.push(`| \`${a.token}\` | \`${a.from}\` | \`${a.to}\` | ${a.pairs.join('; ')} |`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
