import { translatable } from '../../core/i18n/i18n';
import type { FlagName, Special, TimeName, What, Who } from './attributes-logic';
import { AT_DE } from './attributes-texts.de';

const entries = (n: number) => (n === 1 ? '1 entry' : `${n} entries`);

/** Texts of the change-attributes dialog (design 024). */
export const AT_EN = {
  title: (n: number, first: string) =>
    n === 1 ? `Change attributes – ${first}` : `Change attributes – ${entries(n)}`,
  permissions: 'Permissions',
  who: { owner: 'Owner', group: 'Group', others: 'Others' } satisfies Record<Who, string>,
  what: { read: 'Read', write: 'Write', exec: 'Execute' } satisfies Record<What, string>,
  bitLabel: (who: string, what: string) => `${who}: ${what}`,
  special: {
    setuid: 'Set user ID',
    setgid: 'Set group ID',
    sticky: 'Sticky bit',
  } satisfies Record<Special, string>,
  specialWarning:
    'Set user/group ID lets a program run with the rights of its owner or group – only set it if you know why.',
  octal: 'Octal',
  octalHint: '3 digits (rwx) or 4 (with set-ID/sticky); empty while values differ',
  octalInvalid: 'Enter 3 or 4 digits from 0 to 7',
  attributes: 'Attributes',
  flags: {
    readonly: 'Read-only',
    hidden: 'Hidden',
    system: 'System',
    archive: 'Archive',
  } satisfies Record<FlagName, string>,
  times: 'Times',
  time: {
    modified: 'Modified',
    accessed: 'Accessed',
    created: 'Created',
  } satisfies Record<TimeName, string>,
  change: (what: string) => `Change ${what.toLowerCase()} time`,
  now: 'Now',
  at: 'Date and time',
  timeInvalid: 'Enter a valid date and time',
  recursive: 'Also change the contents of selected folders',
  applyTo: 'Apply to',
  applyToOptions: {
    all: 'Files and folders',
    files: 'Only files',
    dirs: 'Only folders',
  },
  mixedHint: 'A dash means: the selected entries differ – this stays as it is.',
  loading: 'Reading the current values…',
  summary: (n: number, changes: number, recursive: boolean) =>
    `${entries(n)}${recursive ? ' with folder contents' : ''} · ${
      changes === 1 ? '1 change' : `${changes} changes`
    }`,
  links: (n: number) => (n === 1 ? '1 link stays unchanged' : `${n} links stay unchanged`),
  nothing: 'Nothing changed yet',
  cancel: 'Cancel',
  run: 'Change',
  failed: (msg: string) => `Changing attributes failed: ${msg}`,
  withErrors: (n: number) => `Attributes changed – ${entries(n)} could not be changed (see Tasks)`,
  done: (n: number, skipped: number) =>
    `Attributes of ${entries(n)} changed${
      skipped === 0
        ? ''
        : skipped === 1
          ? ' (1 link or other drive skipped)'
          : ` (${skipped} links or other drives skipped)`
    }`,
};

export const AT_TEXTS = translatable('attributes', AT_EN, { de: AT_DE });
