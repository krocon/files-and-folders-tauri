import type { Translation } from '../../core/i18n/i18n';
import type { DIALOG_KEY_EN } from './dialog-key-texts';

/** Deutsche Texte der Dialog-Tasten (057). */
export const DIALOG_KEY_DE: Translation<typeof DIALOG_KEY_EN> = {
  shortcut: (keys) => `Tastenkürzel: ${keys}`,
  inDialogs: 'In Dialogen',
  enterKey: 'Hauptknopf (der farbige rechts) – auch aus einem Textfeld oder einer Checkbox',
  escKey: 'Abbrechen bzw. Schließen; eine offene Liste oder ein Menü im Dialog schließt zuerst',
  modKey: 'Weitere Knöpfe: Taste gedrückt halten zeigt die Buchstaben an den Knöpfen',
  modShiftKey: 'Unwiderrufliche Knöpfe wie „Endgültig löschen“ – nie mit Enter',
};
