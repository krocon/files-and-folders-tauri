/**
 * Catalog of the theme tokens (design 013 E2/§3): the one place for the editor,
 * the contrast check and the completeness tests. Values live in
 * `src/styles.scss` and the built-in schemes `themes/*.json`.
 */
import { phrasebook } from '../i18n/i18n';
import { THEME_LABELS_DE } from './theme-labels.de';

export type TokenGroup =
  'general' | 'list' | 'activePanel' | 'header' | 'footer' | 'dialog' | 'scrollbar' | 'tooltip';

/** `color` gets a colour picker; the others only a text field. */
export type TokenKind = 'color' | 'length' | 'font' | 'shadow';

export interface TokenDef {
  readonly name: string;
  readonly group: TokenGroup;
  readonly label: string;
  readonly kind: TokenKind;
}

/** Token, group and contrast labels by their English text (design 015). */
export const themeLabel = phrasebook('themeLabels', { de: THEME_LABELS_DE });

const GROUP_LABELS_EN: Readonly<Record<TokenGroup, string>> = {
  general: 'General',
  list: 'File list',
  activePanel: 'Active panel',
  header: 'Panel header and tabs',
  footer: 'Status line and button bar',
  dialog: 'Dialogs',
  scrollbar: 'Scrollbar',
  tooltip: 'Tooltip',
};

/** Group labels in the current language. */
export const GROUP_LABELS: Readonly<Record<TokenGroup, string>> = new Proxy(GROUP_LABELS_EN, {
  get: (target, prop) => themeLabel(Reflect.get(target, prop) as string),
});

/** English group labels (completeness test). */
export const GROUP_LABEL_SOURCES: readonly string[] = Object.values(GROUP_LABELS_EN);

const t = (
  name: string,
  group: TokenGroup,
  label: string,
  kind: TokenKind = 'color',
): TokenDef => ({
  name,
  group,
  get label() {
    return themeLabel(label);
  },
  kind,
});

export const TOKENS: readonly TokenDef[] = [
  t('--color-bg', 'general', 'Window background'),
  t('--color-surface', 'general', 'Surface'),
  t('--color-surface-raised', 'general', 'Raised surface'),
  t('--color-text', 'general', 'Text'),
  t('--color-muted', 'general', 'Muted text'),
  t('--color-border', 'general', 'Border'),
  t('--color-accent', 'general', 'Accent'),
  t('--color-accent-text', 'general', 'Text on accent'),
  t('--color-focus', 'general', 'Focus ring'),
  t('--color-selection', 'general', 'Selection (menus, lists)'),
  t('--color-selection-text', 'general', 'Text on selection'),
  t('--color-danger', 'general', 'Danger'),
  t('--color-on-danger', 'general', 'Text on danger'),
  t('--color-danger-bg', 'general', 'Error panel background'),
  t('--color-danger-text', 'general', 'Error panel text'),
  t('--color-favorite', 'general', 'Favourite star'),
  t('--color-search-hit', 'general', 'Search hit background'),
  t('--color-splitter-active', 'general', 'Splitter (dragging)'),
  t('--color-backdrop', 'general', 'Dialog backdrop'),
  t('--shadow-popup', 'general', 'Popup shadow', 'shadow'),

  t('--color-list-bg', 'list', 'Background'),
  t('--color-list-text', 'list', 'Text'),
  t('--color-list-border', 'list', 'Lines'),
  t('--color-list-header-bg', 'list', 'Column header background'),
  t('--color-list-header-text', 'list', 'Column header text'),
  t('--color-row-hover', 'list', 'Row under the mouse'),
  t('--color-cursor-bg', 'list', 'Cursor background'),
  t('--color-cursor-text', 'list', 'Cursor text'),
  t('--color-cursor-inactive-bg', 'list', 'Cursor background, inactive panel'),
  t('--color-cursor-inactive-text', 'list', 'Cursor text, inactive panel'),
  t('--color-marked', 'list', 'Marked text'),
  t('--color-marked-bg', 'list', 'Marked background'),
  t('--color-cursor-marked-text', 'list', 'Marked text under the cursor'),
  t('--color-hidden-text', 'list', 'Hidden entries'),
  t('--color-symlink-text', 'list', 'Symbolic links'),
  t('--color-error-text', 'list', 'Unreadable entries'),
  t('--font-list', 'list', 'Font', 'font'),
  t('--font-size-list', 'list', 'Font size', 'length'),

  t('--color-active-list-bg', 'activePanel', 'List background'),
  t('--color-active-list-text', 'activePanel', 'List text'),
  t('--color-active-list-header-bg', 'activePanel', 'Column header background'),
  t('--color-active-marked', 'activePanel', 'Marked text'),
  t('--color-active-marked-bg', 'activePanel', 'Marked background'),
  t('--color-active-panel-accent', 'activePanel', 'Accent line'),
  t('--color-active-header-bg', 'activePanel', 'Header background'),
  t('--color-active-panel-tab-bg', 'activePanel', 'Selected tab background'),
  t('--color-active-panel-tab-text', 'activePanel', 'Selected tab text'),

  t('--color-header-bg', 'header', 'Background'),
  t('--color-header-text', 'header', 'Text'),
  t('--color-header-border', 'header', 'Border'),
  t('--color-header-input-bg', 'header', 'Input background'),
  t('--color-header-input-text', 'header', 'Input text'),
  t('--color-header-input-border', 'header', 'Input border'),
  t('--color-tab-text', 'header', 'Tab text'),
  t('--color-tab-selected-bg', 'header', 'Selected tab background'),
  t('--color-tab-selected-text', 'header', 'Selected tab text'),

  t('--color-footer-bg', 'footer', 'Background'),
  t('--color-footer-text', 'footer', 'Text'),
  t('--color-footer-border', 'footer', 'Border'),
  t('--color-footer-button-bg', 'footer', 'Button background'),
  t('--color-footer-button-text', 'footer', 'Button text'),
  t('--color-footer-button-border', 'footer', 'Button border'),
  t('--color-shortcut-bg', 'footer', 'Shortcut badge background'),
  t('--color-shortcut-text', 'footer', 'Shortcut badge text'),
  t('--color-footer-error-text', 'footer', 'Warning text'),

  t('--color-dialog-bg', 'dialog', 'Background'),
  t('--color-dialog-text', 'dialog', 'Text'),
  t('--color-dialog-border', 'dialog', 'Border'),
  t('--color-input-bg', 'dialog', 'Input background'),
  t('--color-input-text', 'dialog', 'Input text'),
  t('--color-input-border', 'dialog', 'Input border'),
  t('--color-button-bg', 'dialog', 'Button background'),
  t('--color-button-text', 'dialog', 'Button text'),
  t('--color-button-border', 'dialog', 'Button border'),
  t('--color-button-primary-bg', 'dialog', 'Primary button background'),
  t('--color-button-primary-text', 'dialog', 'Primary button text'),

  t('--color-scrollbar-track', 'scrollbar', 'Track'),
  t('--color-scrollbar-thumb', 'scrollbar', 'Thumb'),
  t('--color-scrollbar-thumb-border', 'scrollbar', 'Thumb border'),
  t('--color-scrollbar-thumb-active', 'scrollbar', 'Thumb (hover, dragging)'),

  t('--color-tooltip-bg', 'tooltip', 'Background'),
  t('--color-tooltip-text', 'tooltip', 'Text'),
  t('--color-tooltip-input-bg', 'tooltip', 'Input background'),
  t('--color-tooltip-input-text', 'tooltip', 'Input text'),
];

export const TOKEN_NAMES: ReadonlySet<string> = new Set(TOKENS.map((d) => d.name));

export function tokenDef(name: string): TokenDef | undefined {
  return TOKENS.find((d) => d.name === name);
}
