import { translatable } from '../../core/i18n/i18n';
import { SHELL_DE } from './shell-texts.de';

/** Texts of the shell bar (design 021). */
export const SHELL_EN = {
  region: 'Shell',
  input: 'Shell command',
  placeholder: 'Enter shell command',
  placeholderArchive: 'Not available inside an archive',
  placeholderNoFolder: 'This panel shows no folder',
  placeholderDisabled: 'The shell bar is switched off in the settings',
  suggestions: 'Commands from the history',
  output: 'Shell output',
  stop: 'Stop',
  stopTitle: 'Stop the command (Esc)',
  copy: 'Copy',
  copyTitle: 'Copy the output',
  clear: 'Clear',
  clearTitle: 'Clear the output',
  collapse: 'Hide output',
  expand: 'Show output',
  resize: 'Height of the shell output',
  running: 'running…',
  interactiveHint: 'Interactive programs (vim, ssh, top) need a terminal: Open terminal here.',
  trimmed: '… older lines were removed',
  dropped: (kb: number) => `… ${kb} KB of output left out`,
  exitCode: (code: number) => `Exit code ${code}`,
  signal: (sig: number) => `Ended by signal ${sig}`,
  cancelled: 'Cancelled',
  finished: (code: number | null) =>
    code === 0 || code === null ? 'Command finished.' : `Command finished with exit code ${code}.`,
  copied: 'Output copied.',
  loginEnvUnavailable:
    'The PATH of the login shell could not be read; programs are searched in the app’s PATH.',
};

export const SHELL_TEXTS = translatable('shell', SHELL_EN, { de: SHELL_DE });
