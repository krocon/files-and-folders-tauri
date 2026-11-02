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
import crimsonJson from './themes/crimson.json';
import darkJson from './themes/dark.json';
import lightJson from './themes/light.json';
import oneDarkJson from './themes/one-dark.json';
import oneDarkVividJson from './themes/one-dark-vivid.json';
import trueDarkJson from './themes/true-dark.json';
import trueBlackJson from './themes/true-black.json';
import trueLightJson from './themes/true-light.json';
import matrixJson from './themes/matrix.json';
import amberJson from './themes/amber.json';
import solarizedLightJson from './themes/solarized-light.json';
import mysticoC64Json from './themes/mystico-c64.json';
import rainglowBoldJson from './themes/rainglow-bold.json';
import rainglowEarthsongJson from './themes/rainglow-earthsong.json';
import rainglowLegacyJson from './themes/rainglow-legacy.json';
import rainglowHerokuJson from './themes/rainglow-heroku.json';
import rainglowPiggyJson from './themes/rainglow-piggy.json';
import { Theme } from './theme.models';

/**
 * The schemes shipped with the app. `light`/`dark` (design 013) are the base
 * schemes – same values as `src/styles.css` (test) – that fill the gaps of
 * every other scheme. The eight designs of the old version (design 019) are
 * converted from `legacy/*.json` (= `docs/legacy-themes/`, unchanged, test).
 */
export const LIGHT: Theme = { ...lightJson, builtIn: true };
export const DARK: Theme = { ...darkJson, builtIn: true };
/** Dark scheme with a crimson accent (after the Nest.js course slides); base = `dark`. */
export const CRIMSON: Theme = { ...crimsonJson, builtIn: true };

/**
 * Further dark/light schemes after editor themes (062 ff.) – only their colour values in our
 * tokens, every contrast pair checked by hand (no automatic correction). Origin and licence:
 * `docs/themes.md`.
 */
export const EXTRA_THEMES: readonly Theme[] = [
  oneDarkJson,
  oneDarkVividJson,
  trueDarkJson,
  trueBlackJson,
  trueLightJson,
  matrixJson,
  amberJson,
  solarizedLightJson,
  mysticoC64Json,
  rainglowBoldJson,
  rainglowEarthsongJson,
  rainglowLegacyJson,
  rainglowHerokuJson,
  rainglowPiggyJson,
].map((t) => ({
  ...t,
  builtIn: true,
}));

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

export const BUILT_IN_THEMES: readonly Theme[] = [
  ...CLASSIC_THEMES,
  LIGHT,
  DARK,
  CRIMSON,
  ...EXTRA_THEMES,
];
