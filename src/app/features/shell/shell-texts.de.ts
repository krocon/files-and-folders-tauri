import type { Translation } from '../../core/i18n/i18n';
import type { SHELL_EN } from './shell-texts';

/** Deutsche Texte der Shell-Zeile (design 021). */
export const SHELL_DE: Translation<typeof SHELL_EN> = {
  region: 'Shell',
  input: 'Shell-Befehl',
  placeholder: 'Shell-Befehl eingeben',
  placeholderArchive: 'Im Archiv nicht verfügbar',
  placeholderNoFolder: 'Diese Seite zeigt keinen Ordner',
  placeholderDisabled: 'Die Shell-Zeile ist in den Einstellungen ausgeschaltet',
  suggestions: 'Befehle aus dem Verlauf',
  output: 'Shell-Ausgabe',
  stop: 'Stopp',
  stopTitle: 'Befehl abbrechen (Esc)',
  copy: 'Kopieren',
  copyTitle: 'Ausgabe kopieren',
  clear: 'Leeren',
  clearTitle: 'Ausgabe leeren',
  collapse: 'Ausgabe ausblenden',
  expand: 'Ausgabe einblenden',
  resize: 'Höhe der Shell-Ausgabe',
  running: 'läuft…',
  interactiveHint:
    'Interaktive Programme (vim, ssh, top) brauchen ein Terminal: Terminal hier öffnen.',
  trimmed: '… ältere Zeilen wurden entfernt',
  dropped: (kb) => `… ${kb} KB Ausgabe ausgelassen`,
  exitCode: (code) => `Exit-Code ${code}`,
  signal: (sig) => `Beendet durch Signal ${sig}`,
  cancelled: 'Abgebrochen',
  stillRunning: 'Ein Befehl läuft noch – Esc bricht ihn ab.',
  finished: (code) =>
    code === 0 || code === null ? 'Befehl beendet.' : `Befehl beendet mit Exit-Code ${code}.`,
  copied: 'Ausgabe kopiert.',
  loginEnvUnavailable: (reason) =>
    `Der PATH der Login-Shell ließ sich nicht lesen (${reason}); verwendet wird der PATH der App plus Standardorte. Einstellungen → Shell.`,
  loginEnvReasons: {
    timeout: 'keine Antwort innerhalb von 10 s',
    noEof: 'die Shell endete, aber ein von ihr gestartetes Programm hält die Ausgabe offen',
    exitStatus: 'die Shell endete mit einem Fehler, bevor sie ihre Umgebung ausgab',
    incomplete: 'die Shell endete, bevor sie ihre Umgebung ausgab',
    noPath: 'ihre Umgebung enthält keinen PATH',
    spawn: 'die Shell ließ sich nicht starten',
    tooLarge: 'zu viel Ausgabe',
    notPosix: 'keine POSIX-Shell',
    unknown: 'unbekannter Grund',
  },
  loginModes: {
    login: 'Login-Shell',
    loginInteractive: 'Login-Shell mit .zshrc/.bashrc',
  },
  loginStatusOff: 'Login-PATH: aus (Einstellungen → Shell).',
  loginStatusNotPosix: 'Login-PATH: auf diesem System nicht verwendet.',
  loginStatusRunning: (shell) => `Login-PATH: ${shell} wird noch gefragt …`,
  loginStatusOk: (shell, mode, ms, entries) =>
    `Login-PATH: aus ${shell} (${mode}) gelesen in ${ms} ms, ${entries} Einträge.`,
  loginStatusFailed: (shell, mode, reason, ms) =>
    `Login-PATH: aus ${shell} (${mode}) nicht gelesen: ${reason}, nach ${ms} ms. Befehle nutzen den PATH der App plus Standardorte.`,
};
