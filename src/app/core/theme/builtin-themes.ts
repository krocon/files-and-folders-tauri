import darkJson from './themes/dark.json';
import lightJson from './themes/light.json';
import { Theme } from './theme.models';

/**
 * The schemes shipped with the app (design 013 E1). Same values as
 * `src/styles.scss` (test). Prompt 019 adds the eight old designs here.
 */
export const LIGHT: Theme = { ...lightJson, builtIn: true };
export const DARK: Theme = { ...darkJson, builtIn: true };

export const BUILT_IN_THEMES: readonly Theme[] = [LIGHT, DARK];
