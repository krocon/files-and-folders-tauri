import type { Translation } from '../../core/i18n/i18n';
import type { UPDATE_EN } from './update-texts';

/** Deutsche Texte der Update-Prüfung (075). */
export const UPDATE_DE: Translation<typeof UPDATE_EN> = {
  title: 'Nach Updates suchen',
  checking: 'Frage GitHub nach der neuesten Version…',
  upToDate: (v) => `Du hast die neueste Version (${v}).`,
  available: (v) => `Version ${v} ist verfügbar.`,
  yours: (v) => `Du hast Version ${v}.`,
  published: (date) => `Veröffentlicht am ${date}.`,
  notes: 'Versionshinweise',
  notesCut: '(gekürzt – vollständig auf der Release-Seite)',
  skipped: 'Du hast diese Version übersprungen.',
  failed: 'Die Prüfung ist fehlgeschlagen.',
  privacy: 'Eine Anfrage an GitHub, ohne persönliche Daten.',
  openPage: 'Release-Seite öffnen',
  skip: 'Diese Version überspringen',
  unskip: 'Wieder erinnern',
  retry: 'Erneut versuchen',
  close: 'Schließen',
  hint: (v) => `Files and Folders ${v} ist verfügbar.`,
  details: 'Mehr dazu…',
  dismiss: 'Ausblenden',
  aboutCheck: 'Nach Updates suchen',
};
