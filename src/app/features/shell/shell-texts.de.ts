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
  finished: (code) =>
    code === 0 || code === null ? 'Befehl beendet.' : `Befehl beendet mit Exit-Code ${code}.`,
  copied: 'Ausgabe kopiert.',
  loginEnvUnavailable:
    'Der PATH der Login-Shell ließ sich nicht lesen; Programme werden im PATH der App gesucht.',
};
