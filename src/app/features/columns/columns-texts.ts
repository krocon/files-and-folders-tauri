import { translatable } from '../../core/i18n/i18n';
import { COLUMNS_DE } from './columns-texts.de';

/** Texts of the column choice and the view modes (design 041). */
export const COLUMNS_EN = {
  title: 'Columns',
  help: 'Space shows or hides a column, Alt+↑ / Alt+↓ moves it. The choice applies to both panels and all tabs; the widths belong to each tab.',
  listLabel: 'Columns of the file list',
  always: 'always shown',
  moveUp: 'Move up',
  moveDown: 'Move down',
  defaults: 'Defaults',
  cancel: 'Cancel',
  ok: 'OK',
  /** Announced after a change (live region). */
  shown: (name: string) => `${name}: shown`,
  hidden: (name: string) => `${name}: hidden`,
  moved: (name: string, position: number, count: number) =>
    `${name}: position ${position} of ${count}`,
  /** Full names of the columns (the header of the list uses short ones). */
  names: {
    name: 'Name',
    ext: 'Extension',
    size: 'Size',
    modifiedMs: 'Modified',
    createdMs: 'Created',
    accessedMs: 'Last access',
    attrs: 'Permissions / attributes',
    type: 'Type',
  },
};

export const COLUMNS_TEXTS = translatable('columns', COLUMNS_EN, { de: COLUMNS_DE });
