import type { Translation } from '../../core/i18n/i18n';
import type { ABOUT_EN } from './about-texts';

/** Deutsche Texte des About-Dialogs (017, 015). */
export const ABOUT_DE: Translation<typeof ABOUT_EN> = {
  title: 'Über Files and Folders',
  version: 'Version',
  build: 'Build',
  buildDebug: 'Entwicklungs-Build',
  buildRelease: 'Release',
  platform: 'Plattform',
  tauri: 'Tauri',
  crateMismatch: (v) => `Backend-Crate ${v} – Versionen weichen ab`,
  author: 'Autor',
  authorValue: 'Marc Kronberg',
  source: 'Quellcode',
  sourceValue: 'github.com/krocon/files-and-folders-tauri',
  credits: 'Dateiliste',
  creditsValue: 'GuiExpert Table',
  loading: 'Lade…',
  noBackend: 'Versionsangaben gibt es nur in der Desktop-App.',
  copy: 'Kopieren',
  copied: 'In die Zwischenablage kopiert.',
  close: 'Schließen',
  os: { macos: 'macOS', windows: 'Windows', linux: 'Linux' },
};
