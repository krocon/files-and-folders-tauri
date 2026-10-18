/**
 * Native menu spec (Rust `app_menu.rs`, design 014 E7) – keep in sync by hand.
 * Shortcuts are in keymap notation; Rust turns the safe ones into accelerators.
 */
export type NativeMenuNode =
  | {
      readonly kind: 'item';
      readonly id: string;
      readonly label: string;
      readonly accelerator: string | null;
      readonly enabled: boolean;
    }
  | { readonly kind: 'submenu'; readonly label: string; readonly items: readonly NativeMenuNode[] }
  | { readonly kind: 'separator' }
  | { readonly kind: 'predefined'; readonly name: PredefinedItem };

export type PredefinedItem =
  | 'about'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'showAll'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'minimize'
  | 'maximize'
  | 'fullscreen'
  | 'closeWindow';

export interface NativeMenuSpec {
  /** Top-level entries are submenus. */
  readonly menus: readonly NativeMenuNode[];
}

export interface NativeMenuEvent {
  readonly id: string;
}

/** Enabled flag of one native item (`set_menu_enabled`, review 014 #7). */
export interface MenuItemEnabled {
  readonly id: string;
  readonly enabled: boolean;
}
