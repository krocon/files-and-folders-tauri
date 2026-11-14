import { translatable } from '../../core/i18n/i18n';
import { UPDATE_DE } from './update-texts.de';

/** Texts of the update check (075); German in `update-texts.de.ts`. */
export const UPDATE_EN = {
  title: 'Check for updates',
  checking: 'Asking GitHub for the latest version…',
  upToDate: (v: string) => `You have the latest version (${v}).`,
  available: (v: string) => `Version ${v} is available.`,
  yours: (v: string) => `You have version ${v}.`,
  published: (date: string) => `Published on ${date}.`,
  notes: 'Release notes',
  notesCut: '(shortened – the full notes are on the release page)',
  skipped: 'You chose to skip this version.',
  failed: 'The check failed.',
  privacy: 'One request to GitHub, no personal data.',
  openPage: 'Open release page',
  skip: 'Skip this version',
  unskip: 'Remind me again',
  retry: 'Try again',
  close: 'Close',
  hint: (v: string) => `Files and Folders ${v} is available.`,
  details: 'Details…',
  dismiss: 'Dismiss',
  aboutCheck: 'Check for updates',
};

export const UPDATE_TEXTS = translatable('update', UPDATE_EN, { de: UPDATE_DE });
