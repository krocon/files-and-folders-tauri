import bitbucketJson from './legacy/bitbucket.json';
import blackboardJson from './legacy/blackboard.json';
import coffeeJson from './legacy/coffee.json';
import combatJson from './legacy/combat.json';
import cypressJson from './legacy/cypress.json';
import legacyLightJson from './legacy/light.json';
import nortonJson from './legacy/norton.json';
import paperJson from './legacy/paper.json';
import { ContrastAdjustment } from './contrast-fix';
import { convertLegacy } from './legacy-theme';
import darkJson from './themes/dark.json';
import lightJson from './themes/light.json';
import { Theme } from './theme.models';

/**
 * The schemes shipped with the app. `light`/`dark` (design 013) are the base
 * schemes – same values as `src/styles.css` (test) – that fill the gaps of
 * every other scheme. The eight designs of the old version (design 019) are
 * converted from `legacy/*.json` (= `docs/legacy-themes/`, unchanged, test).
 */
export const LIGHT: Theme = { ...lightJson, builtIn: true };
export const DARK: Theme = { ...darkJson, builtIn: true };

interface LegacyFile {
  readonly name: string;
  readonly colors: Readonly<Record<string, string>>;
}

/** The old designs in the order of the old version; id `classic-<name>`. */
export const CLASSIC_FILES: readonly LegacyFile[] = [
  legacyLightJson,
  paperJson,
  bitbucketJson,
  cypressJson,
  blackboardJson,
  coffeeJson,
  combatJson,
  nortonJson,
];

export const CLASSIC_PREFIX = 'classic-';

/** Contrast corrections per old design (`classic-…` → list), for the report and the editor. */
export const CLASSIC_ADJUSTMENTS = new Map<string, readonly ContrastAdjustment[]>();

export const CLASSIC_THEMES: readonly Theme[] = CLASSIC_FILES.map((file) => {
  const converted = convertLegacy(file.colors, LIGHT, DARK, file.name);
  const id = `${CLASSIC_PREFIX}${file.name}`;
  CLASSIC_ADJUSTMENTS.set(id, converted.adjustments);
  return {
    id,
    name: file.name.charAt(0).toUpperCase() + file.name.slice(1),
    dark: converted.dark,
    tokens: converted.tokens,
    builtIn: true,
  };
});

export const BUILT_IN_THEMES: readonly Theme[] = [...CLASSIC_THEMES, LIGHT, DARK];
