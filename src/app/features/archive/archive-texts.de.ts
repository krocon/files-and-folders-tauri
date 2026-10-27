import type { Translation } from '../../core/i18n/i18n';
import type { ArchiveFormat } from '../../core/fs/fs.models';
import type { ARCHIVE_EN } from './archive-texts';

/** Deutsche Texte für Packen/Entpacken (design 016, 015). */
export const ARCHIVE_DE: Translation<typeof ARCHIVE_EN> = {
  packTitle: 'Packen',
  unpackTitle: 'Entpacken',
  extractTitle: 'Aus dem Archiv entpacken',
  entries: (n) => (n === 1 ? '1 Eintrag' : `${n} Einträge`),
  archives: (n) => (n === 1 ? '1 Archiv' : `${n} Archive`),
  name: 'Archivname',
  format: 'Format',
  formats: { zip: 'ZIP', tar: 'TAR', tarGz: 'TAR.GZ', sevenZ: '7Z', rar: 'RAR' },
  level: 'Kompression',
  levelHint: (n) =>
    n === 0
      ? '0 (nur speichern)'
      : n === 1
        ? '1 (am schnellsten)'
        : n === 9
          ? '9 (am kleinsten)'
          : `${n}`,
  to: 'In den Ordner',
  suggestions: 'Vorschläge',
  intoSubfolder: (name) => `In einen Unterordner „${name}“`,
  intoSubfolderMany: 'Jedes Archiv in einen Unterordner mit seinem Namen',
  ifExists: 'Wenn eine Datei existiert',
  linksHint: 'Links werden nicht gepackt (sie werden gemeldet).',
  unpackHint: 'Links und Einträge mit unsicheren Namen (.., absolute Pfade) werden nie entpackt.',
  pack: 'Packen',
  unpack: 'Entpacken',
  cancel: 'Abbrechen',
  emptyName: 'Bitte einen Namen eingeben.',
  emptyTarget: 'Bitte einen Zielordner eingeben.',
  targetIsFile: 'Das Ziel ist eine Datei – bitte einen Ordner wählen.',
  noArchive:
    'Kein Archiv gewählt – den Cursor auf eine .zip-, .7z-, .rar-, .tar- oder .tar.gz-Datei setzen.',
  readOnly: 'Im Archiv nicht möglich – die Einträge zuerst entpacken (F5).',
  intoArchive:
    'In ein 7z- oder RAR-Archiv kann nicht kopiert werden – nur ZIP, TAR und TAR.GZ lassen sich ändern.',
  readOnlyFormat: '7z- und RAR-Archive sind nur lesbar – ZIP, TAR und TAR.GZ lassen sich ändern.',
  noRenameInto: 'Ein neuer Name ist beim Kopieren in ein Archiv nicht möglich.',
  linkIntoArchive: 'In einem Archiv können keine Verknüpfungen angelegt werden.',
  deleteNoTrash: 'Einträge im Archiv werden endgültig entfernt – ein Archiv hat keinen Papierkorb.',
  unsafeHidden: (n) =>
    n === 1 ? '1 unsicherer Eintrag ausgeblendet' : `${n} unsichere Einträge ausgeblendet`,
  archiveBadge: (format: ArchiveFormat) =>
    `${{ zip: 'ZIP', tar: 'TAR', tarGz: 'TAR.GZ', sevenZ: '7Z', rar: 'RAR' }[format]} · schreibgeschützt`,
  encryptedBadge: 'verschlüsselt',
  password: 'Passwort',
  passwordOptional: 'Passwort (falls verschlüsselt)',
  packPassword: 'Passwort (optional)',
  passwordRepeat: 'Passwort wiederholen',
  passwordTitle: 'Verschlüsseltes Archiv',
  passwordIntro: (path) => `„${path}“ ist verschlüsselt. Bitte das Passwort eingeben:`,
  passwordWrongBefore: 'Das Passwort passte nicht – bitte noch einmal.',
  passwordKept: 'Bleibt bis zum Beenden der App im Speicher – wird nie gespeichert.',
  open: 'Öffnen',
  emptyPassword: 'Bitte das Passwort eingeben.',
  passwordsDiffer: 'Die beiden Passwörter sind verschieden.',
  passwordTooLongRar: (n) => `RAR-Passwörter haben höchstens ${n} Zeichen.`,
  passwordNeeded: (path) =>
    `„${path}“ ist verschlüsselt – noch einmal versuchen, um das Passwort einzugeben.`,
  zipAesHint:
    'ZIP mit Passwort nutzt AES-256: Der Windows-Explorer und das Archivprogramm von macOS können es nicht öffnen (7-Zip, WinZip, Keka schon).',
  sevenZHint: '7z mit Passwort verschlüsselt auch die Dateinamen.',
};
