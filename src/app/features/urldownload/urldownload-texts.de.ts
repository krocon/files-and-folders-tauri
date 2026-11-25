import type { Translation } from '../../core/i18n/i18n';
import type { URL_DOWNLOAD_EN } from './urldownload-texts';

/** Deutsche Texte von „Von URLs laden“ (078). */
export const URL_DOWNLOAD_DE: Translation<typeof URL_DOWNLOAD_EN> = {
  title: 'Von URLs laden',
  searching: 'Suche yt-dlp, ffmpeg und eine JavaScript-Laufzeit…',
  target: 'Ziel',
  left: 'Links',
  right: 'Rechts',
  activePanel: 'aktives Panel',
  targetEntry: (side, path) => `${side} · ${path}`,
  targetBlocked: (side, reason) => `${side} · ${reason}`,
  blocked: {
    noFolder: 'kein Ordner',
    result: 'ein Ergebnis-Tab – kein Ordner',
    archive: 'in einem Archiv – nicht möglich',
    server: 'auf einem Server – nicht möglich',
  },
  noTarget: 'Keine der beiden Seiten zeigt einen lokalen Ordner.',
  urls: 'URLs (eine je Zeile)',
  paste: 'Aus Zwischenablage einfügen',
  pasted: (n) =>
    n === 0
      ? 'Die Zwischenablage enthält keine neue http(s)-Adresse.'
      : n === 1
        ? '1 Adresse aus der Zwischenablage eingefügt.'
        : `${n} Adressen aus der Zwischenablage eingefügt.`,
  pasteFailed: 'Die Zwischenablage ließ sich nicht lesen – bitte direkt ins Feld einfügen.',
  startHint: (key) => `Enter beginnt hier eine neue Zeile; ${key} startet den Download.`,
  count: (n) => (n === 1 ? '1 URL' : `${n} URLs`),
  invalid: (n) => `${n} ungültig`,
  duplicates: (n) => `${n} doppelt`,
  tooMany: (max) => `mehr als ${max} – der Rest bleibt weg`,
  line: (n, reason) => `Zeile ${n}: ${reason}`,
  moreLines: (n) => `und ${n} weitere`,
  urlReason: {
    invalid: 'keine Adresse',
    scheme: 'nur http und https',
    noHost: 'kein Hostname',
    credentials: 'Benutzername oder Passwort in der Adresse',
    tooLong: 'zu lang',
  },
  preset: 'Vorlage',
  presets: {
    best: 'Bestes Video',
    video1080mp4: 'Video bis 1080p (mp4)',
    audioMp3: 'Nur Audio (mp3)',
    audioBest: 'Nur Audio (Original, m4a/opus)',
  },
  presetCustom: '(eigene Auswahl)',
  ownPreset: (label) => `${label} (url-download.json)`,
  ownPresetNote: 'Diese Vorlage bestimmt Format und Qualität selbst.',
  presetGone: 'Die Vorlage steht nicht mehr in url-download.json.',
  presetProblems: (n, file) =>
    n === 1
      ? `1 Vorlage in ${file} wurde abgelehnt:`
      : `${n} Vorlagen in ${file} wurden abgelehnt:`,
  presetReason: (id, reason, option) => `${id || '?'}: ${reason}${option ? ` (${option})` : ''}`,
  presetReasons: {
    id: 'ungültige Id',
    label: 'keine Bezeichnung',
    duplicate: 'Id doppelt vergeben',
    tooManyArgs: 'zu viele Argumente',
    notAllowed: 'Option nicht erlaubt',
    missingValue: 'Wert fehlt',
    badValue: 'Wert nicht erlaubt',
    unexpectedValue: 'nimmt keinen Wert',
  },
  presetFileBroken: 'url-download.json ließ sich nicht lesen; die Datei wurde beiseitegelegt.',
  content: 'Inhalt',
  video: 'Video',
  audioOnly: 'nur Audio',
  maxHeight: 'Höchstens',
  anyHeight: 'beliebig',
  height: (h) => `${h}p`,
  container: 'Container',
  containerAuto: 'wie geliefert',
  containerPrefer: (name) => `${name} (bevorzugt)`,
  audio: 'Audio',
  audioBest: 'Original',
  template: 'Dateiname',
  templateFields: 'Felder für den Namen',
  templateHelp:
    'Felder: %(title)s, %(id)s, %(uploader)s, %(upload_date>%Y-%m-%d)s, %(playlist_index)02d, %(ext)s. Einen langen Titel kürzt %(title).100B.',
  example: (name) => `z. B. „${name}“`,
  templateReason: {
    empty: 'Die Vorlage ist leer.',
    tooLong: 'Die Vorlage ist zu lang.',
    separator: 'Kein „/“ oder „\\“ – Dateien landen immer im Zielordner.',
    escape:
      'Kein „..“, „~“, „$“, „:“ und kein „-“ am Anfang – die Datei muss im Zielordner bleiben.',
    character: 'Ein Zeichen, das in Dateinamen nicht geht.',
    field: 'Ein „%“, das kein Feld wie %(title)s ist.',
    extension: 'Die Vorlage muss auf .%(ext)s enden (mit einem Namen davor).',
  },
  playlist: 'Playlist',
  playlistNo: 'nur das Video der URL',
  playlistYes: 'ganze Playlist',
  playlistSubfolder: 'Unterordner je Playlist',
  extras: 'Extras',
  subtitles: 'Untertitel',
  subLangs: 'Untertitel-Sprachen',
  subLangsBad: 'Sprachen wie „en“ oder „de,en“.',
  embedThumbnail: 'Thumbnail einbetten',
  embedMetadata: 'Metadaten einbetten',
  overwrite: 'Vorhandene überschreiben',
  login: 'Anmeldung',
  cookies: 'Cookies aus Browser',
  cookiesNone: 'keine',
  cookiesHint:
    'yt-dlp liest die Cookies dieses Browsers, um zu laden, was deine Anmeldung braucht. Das System fragt dafür eventuell nach dem Zugriff auf den Schlüsselbund.',
  needsFfmpeg: 'braucht ffmpeg',
  noFfmpeg: 'ffmpeg wurde nicht gefunden: „nur Audio“, mp4/mkv und das Einbetten sind aus.',
  noJsRuntime: 'Keine JavaScript-Laufzeit (deno oder node) gefunden – YouTube braucht eine.',
  jsTooOld: (name, version) =>
    `${name} ${version} ist zu alt für yt-dlp – YouTube braucht eine neuere Version.`,
  outdated: (version) =>
    `yt-dlp ${version} ist älter als 90 Tage – Seiten ändern sich; bitte über den Paketmanager aktualisieren.`,
  toolState: {
    ok: 'gefunden',
    missing: 'nicht gefunden',
    tooOld: 'zu alt',
    failed: 'startet nicht',
  },
  tool: (name, version, state) =>
    version ? `${name} ${version} – ${state}` : `${name} – ${state}`,
  jsRuntime: 'JavaScript-Laufzeit',
  rescan: 'Erneut suchen',
  copyCommand: 'Befehl kopieren',
  commandCopied: (shell) => `Der Befehl für ${shell} liegt in der Zwischenablage.`,
  commandNotForShell:
    'cmd.exe kann diesen Befehl nicht sicher aufnehmen (es ersetzt „%…%“ auch in Anführungszeichen). Unter Einstellungen → Shell PowerShell wählen und erneut kopieren – es wurde nichts kopiert.',
  yourShell: 'deine Shell (sh, zsh, bash)',
  targetByMcp: (client) =>
    `„${client}“ hat diesen Ordner über MCP geöffnet – bitte das Ziel prüfen, bevor du lädst.`,
  missingTitle: 'yt-dlp wurde nicht gefunden',
  missingIntro:
    'Dieser Dialog nutzt das Programm yt-dlp, das nicht zu Files and Folders gehört. Installiere es und wähle „Erneut suchen“:',
  missingFailed: (path) => `yt-dlp wurde gefunden, startet aber nicht: ${path}`,
  missingConfigured: 'Der in den Einstellungen für yt-dlp gesetzte Pfad führt zu keinem Programm.',
  installMac: 'macOS (Homebrew)',
  installWindows: 'Windows (winget)',
  installLinux: 'Linux / jedes System (pipx)',
  projectPage: 'Projektseite',
  missingSetting:
    'Woanders installiert? Den vollen Pfad unter Einstellungen → Tools → „yt-dlp (Von URLs laden)“ eintragen.',
  rights: 'Für das Recht, die Inhalte zu laden, bist du selbst verantwortlich.',
  cancel: 'Abbrechen',
  start: 'Laden',
  started: (n) => (n === 1 ? 'Download von 1 URL gestartet.' : `Download von ${n} URLs gestartet.`),
  done: (files, present) =>
    `Download fertig: ${files === 1 ? '1 Datei' : `${files} Dateien`}${
      present > 0 ? ` (${present} schon vorhanden)` : ''
    }.`,
  doneWithErrors: (failed) =>
    failed === 1
      ? 'Download fertig – 1 URL ist fehlgeschlagen (siehe Tasks).'
      : `Download fertig – ${failed} URLs sind fehlgeschlagen (siehe Tasks).`,
  failed: (reason) => `Download fehlgeschlagen: ${reason}`,
  cancelled:
    'Download abgebrochen – begonnene Dateien bleiben als .part liegen und werden beim nächsten Mal fortgesetzt.',
};
