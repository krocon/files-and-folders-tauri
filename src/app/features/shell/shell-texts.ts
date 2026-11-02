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
  stillRunning: 'A command is still running – Esc cancels it.',
  finished: (code: number | null) =>
    code === 0 || code === null ? 'Command finished.' : `Command finished with exit code ${code}.`,
  copied: 'Output copied.',
  /** Design 061 E6b: once per run, with the reason (a text of `loginEnvReasons`). */
  loginEnvUnavailable: (reason: string) =>
    `The PATH of the login shell could not be read (${reason}); using the app’s PATH plus standard locations. Settings → Shell.`,
  /** Reasons by `LoginEnvReason`; the 10 s are `LOGIN_TIMEOUT` in `shell/env.rs`. */
  loginEnvReasons: {
    timeout: 'no answer within 10 s',
    noEof: 'the shell ended, but a program it started keeps the output open',
    exitStatus: 'the shell ended with an error before it printed its environment',
    incomplete: 'the shell ended before it printed its environment',
    noPath: 'its environment has no PATH',
    spawn: 'the shell could not be started',
    tooLarge: 'too much output',
    notPosix: 'no POSIX shell',
    unknown: 'unknown reason',
  } as Readonly<Record<string, string>>,
  loginModes: {
    login: 'login shell',
    loginInteractive: 'login shell with .zshrc/.bashrc',
  } as Readonly<Record<string, string>>,
  loginStatusOff: 'Login PATH: off (Settings → Shell).',
  loginStatusNotPosix: 'Login PATH: not used on this system.',
  loginStatusRunning: (shell: string) => `Login PATH: ${shell} is still being asked …`,
  loginStatusOk: (shell: string, mode: string, ms: number, entries: number) =>
    `Login PATH: read from ${shell} (${mode}) in ${ms} ms, ${entries} entries.`,
  loginStatusFailed: (shell: string, mode: string, reason: string, ms: number) =>
    `Login PATH: not read from ${shell} (${mode}): ${reason}, after ${ms} ms. Commands use the app’s PATH plus standard locations.`,
};

export const SHELL_TEXTS = translatable('shell', SHELL_EN, { de: SHELL_DE });
