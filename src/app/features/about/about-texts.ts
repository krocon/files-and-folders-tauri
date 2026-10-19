import { translatable } from '../../core/i18n/i18n';
import { ABOUT_DE } from './about-texts.de';

/** Texts of the About dialog (017); German in `about-texts.de.ts` (015). */
export const ABOUT_EN = {
  title: 'About Files and Folders',
  version: 'Version',
  build: 'Build',
  buildDebug: 'development build',
  buildRelease: 'release',
  platform: 'Platform',
  tauri: 'Tauri',
  crateMismatch: (v: string) => `backend crate ${v} – versions differ`,
  author: 'Author',
  authorValue: 'Marc Kronberg',
  source: 'Source',
  sourceValue: 'github.com/krocon/files-and-folders-tauri',
  credits: 'File list',
  creditsValue: 'GuiExpert Table',
  loading: 'Loading…',
  noBackend: 'Version information is only available in the desktop app.',
  copy: 'Copy',
  copied: 'Copied to the clipboard.',
  close: 'Close',
  os: { macos: 'macOS', windows: 'Windows', linux: 'Linux' } as Record<string, string>,
};

export const ABOUT_TEXTS = translatable('about', ABOUT_EN, { de: ABOUT_DE });
