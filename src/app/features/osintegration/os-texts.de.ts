import type { Translation } from '../../core/i18n/i18n';
import type { OS_EN } from './os-texts';

/** Deutsche Texte der OS-Integration (design 015). */
export const OS_DE: Translation<typeof OS_EN> = {
  drives: 'Laufwerke',
  readingDrives: 'Lese Laufwerke…',
  noDrives: '(keine gefunden)',
  notReachable: 'nicht erreichbar',
  nothingSelected: 'Nichts ausgewählt – Einträge markieren oder den Cursor auf einen setzen.',
  noFolder: 'Diese Seite zeigt keinen Ordner.',
  noEditTool: 'Kein Tool „edit“ konfiguriert (tools.json).',
  copied: (n, what, json) =>
    `${n} ${what === 'names' ? (n === 1 ? 'Name' : 'Namen') : n === 1 ? 'Pfad' : 'Pfade'} kopiert${json ? ' (JSON)' : ''}.`,
  toolStarted: (label, n) => (n === 1 ? `${label} gestartet.` : `${label} ${n}-mal gestartet.`),
  toolsHeading: 'Tools',
  toolsPalette: 'Mit Tool öffnen',
  configTitle: 'Tool-Konfiguration',
  configIntro:
    'Tools werden in einer JSON-Datei konfiguriert (Programm + Argumentliste, Platzhalter {file}, {files}, {name}, {stem}, {ext}, {dir}, {targetDir} je Argument; nichts läuft über eine Shell). Einträge im alten files-and-folders-Format (cmd, para, $file, $dir) werden beim Laden umgewandelt.',
  configFile: 'Datei',
  configNoFile: '(App-Konfigurationsordner nicht verfügbar)',
  openFile: 'tools.json öffnen',
  reload: 'Neu laden',
  close: 'Schließen',
  warnings: 'Probleme',
  perFile: (limit) => `ein Start je Eintrag, max. ${limit}`,
  allFiles: (limit) => `alle Einträge in einem Start, max. ${limit}`,
  noFiles: 'braucht keine Einträge',
  reloaded: (n) => `${n} ${n === 1 ? 'Tool' : 'Tools'} geladen.`,
  freeOf: (free, total) => `${free} frei von ${total}`,
};
