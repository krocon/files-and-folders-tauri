import { translatable } from '../../core/i18n/i18n';
import { DIALOG_KEY_DE } from './dialog-key-texts.de';

/** Texts of the dialog keys (057); German in `dialog-key-texts.de.ts`. */
export const DIALOG_KEY_EN = {
  /** Tooltip of a dialog button with a key, e.g. "Shortcut: ⌘⇧D". */
  shortcut: (keys: string) => `Shortcut: ${keys}`,
  /** Section "In dialogs" of the ⌨ shortcuts dialog. */
  inDialogs: 'In dialogs',
  enterKey: 'Main button (the coloured one on the right) – also from a text field or checkbox',
  escKey: 'Cancel or close; an open list or menu inside closes first',
  modKey: 'Other buttons: hold the key to see the letters on the buttons',
  modShiftKey: 'Irreversible buttons such as "Delete permanently" – never with Enter',
};

export const DIALOG_KEY_TEXTS = translatable('dialogKeys', DIALOG_KEY_EN, { de: DIALOG_KEY_DE });
