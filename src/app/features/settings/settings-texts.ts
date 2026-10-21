import { translatable, Translation } from '../../core/i18n/i18n';

/** Texts of the settings dialog (design 015 E6). */
export const SETTINGS_EN = {
  title: 'Settings',
  search: 'Search settings',
  searchPlaceholder: 'Search settings…',
  categories: 'Categories',
  results: (n: number) => (n === 1 ? '1 setting found' : `${n} settings found`),
  noResults: 'No setting matches.',
  resetSection: 'Reset section',
  resetSectionOf: (name: string) => `Reset section ${name}`,
  close: 'Close',
  changed: 'changed',
  restart: 'Applies at the next start.',
  newTabs: 'Applies to new tabs.',
  cat: {
    general: 'General',
    view: 'View',
    behavior: 'Behaviour',
    shell: 'Shell',
    keyboard: 'Keyboard',
    tools: 'Tools',
    colors: 'Colours',
    customize: 'Buttons & file types',
    data: 'Data',
  },
  items: {
    'general.language': {
      label: 'Language',
      help: 'Language of the user interface; dates and numbers follow it.',
      keywords: 'locale deutsch english',
    },
    'general.startFolder': {
      label: 'At start',
      help: 'What both panels show when the app starts.',
      keywords: 'start folder session tabs home',
    },
    'view.sizeFormat': {
      label: 'File sizes',
      help: 'Binary (1 KB = 1024 bytes), decimal (1 kB = 1000 bytes) or exact bytes.',
      keywords: 'size bytes kb mb units',
    },
    'view.dateFormat': {
      label: 'Date format',
      help: 'As in your language, or year-month-day with time (as in the old version).',
      keywords: 'date time iso format',
    },
    'view.density': {
      label: 'Row height',
      help: 'Condensed 24 px, normal 30 px, spacious 34 px (as in the old version).',
      keywords: 'density compact condensed row height',
    },
    'view.folderBrackets': {
      label: 'Folders in brackets',
      help: 'Shows folders as [Name] (old version).',
      keywords: 'folder brackets name',
    },
    'view.hideExtension': {
      label: 'Names without extension',
      help: 'The extension stays visible in the Ext column.',
      keywords: 'extension suffix name',
    },
    'view.showHidden': {
      label: 'Show hidden files',
      help: 'Default for new tabs; the toggle (Ctrl+H / ⌘⇧.) changes the current tab.',
      keywords: 'hidden dot files',
    },
    'view.menuBar': {
      label: 'Menu bar',
      help: 'Windows and Linux; without it the menu bar shows up while you use it (Alt+M).',
      keywords: 'menu bar',
    },
    'behavior.deleteToTrash': {
      label: 'Delete moves to the trash',
      help: 'Off: Delete (F8) deletes permanently – always with a question.',
      keywords: 'delete trash recycle bin permanently',
    },
    'behavior.confirmTrash': {
      label: 'Ask before moving to the trash',
      help: 'Deleting permanently always asks.',
      keywords: 'confirm question delete trash',
    },
    'behavior.doubleClick': {
      label: 'Double-click on a file',
      help: 'Folders always open.',
      keywords: 'double click mouse open view',
    },
    'behavior.spaceCalcSize': {
      label: 'Space calculates folder sizes',
      help: 'Marking a folder with Space also calculates its size.',
      keywords: 'space mark folder size',
    },
    'behavior.rememberFolders': {
      label: 'Remember cursor and marks per folder',
      help: 'Each tab remembers cursor, marks and scroll position of its last 50 folders, also across restarts (folder-memory.json). Switching it off forgets what was kept.',
      keywords: 'remember cursor marks selection folder restart memory history',
    },
    'diskUsage.sizeMode': {
      label: 'Disk usage: sizes',
      help: 'On disk counts the blocks a file takes (sparse and cloud files take little); the size is what the file reports. Applies to new scans.',
      keywords: 'disk usage space allocated logical size blocks',
    },
    'diskUsage.crossFilesystems': {
      label: 'Disk usage: scan other drives below',
      help: 'Off: drives mounted inside the scanned folder are shown but not scanned.',
      keywords: 'disk usage mount drive volume network file system',
    },
    'diskUsage.chart': {
      label: 'Disk usage: chart',
      help: 'Rings show the folder levels, tiles show big files deep inside best.',
      keywords: 'disk usage chart sunburst treemap rings tiles',
    },
    'watch.pollNetwork': {
      label: 'Watch network drives by polling',
      help: 'Network drives send no change events; polling refreshes them every few seconds (more load).',
      keywords: 'watch refresh network nfs smb polling',
    },
    'shell.enabled': {
      label: 'Shell bar',
      help: 'The command line above the buttons (Shift+F11). It runs only what you type and confirm with Enter.',
      keywords: 'shell command line terminal console cmd prompt',
    },
    'shell.loginPath': {
      label: 'Programs from the login shell',
      help: 'Reads PATH and language once from your login shell, so programs from Homebrew, nvm or cargo are found.',
      keywords: 'path homebrew brew environment login profile',
    },
    'shell.windowsShell': {
      label: 'Shell on Windows',
      help: 'cmd.exe like Total Commander, or PowerShell (pwsh if installed).',
      keywords: 'windows cmd powershell pwsh',
    },
    'search.recent': {
      label: 'Recent searches',
      help: 'The last 10 searches are kept across restarts.',
      keywords: 'search find history recent',
    },
    'search.templates': {
      label: 'Own search templates',
      help: 'Templates saved in the find dialog (up to 50); delete single ones there.',
      keywords: 'search find template preset own',
    },
    'dialogs.recent': {
      label: 'Last inputs of the tool dialogs',
      help: 'Group files, Clean folders and Create several folders open with the values of their last run.',
      keywords: 'remember last inputs dialog group clean folders mkdir template',
    },
  },
  values: {
    system: 'System',
    en: 'English',
    de: 'Deutsch',
    session: 'Restore the tabs',
    home: 'Home folder',
    binary: 'Binary (KB)',
    decimal: 'Decimal (kB)',
    bytes: 'Bytes',
    locale: 'Language format',
    iso: 'yyyy-mm-dd hh:mm',
    condensed: 'Condensed',
    normal: 'Normal',
    spacious: 'Spacious',
    open: 'Open with the default app',
    view: 'View (F3)',
    cmd: 'cmd.exe',
    powershell: 'PowerShell',
    allocated: 'On disk',
    logical: 'Size',
    sunburst: 'Rings',
    treemap: 'Tiles',
  } as Readonly<Record<string, string>>,
  on: 'On',
  clearRecent: 'Clear',
  shellIntro: 'The shell history is kept in shell-history.json in the app folder (100 commands).',
  clearShellHistory: 'Clear shell history',
  shellHistoryCleared: 'The shell history was cleared.',
  recentCount: (n: number) => (n === 1 ? '1 search remembered' : `${n} searches remembered`),
  templateCount: (n: number) => (n === 1 ? '1 own template' : `${n} own templates`),
  dialogCount: (n: number) => (n === 1 ? '1 dialog remembered' : `${n} dialogs remembered`),
  // keyboard
  keyboardIntro: 'Shortcuts per action; your changes are kept in keymap.json.',
  editShortcuts: 'Edit shortcuts…',
  resetShortcuts: 'Reset all shortcuts',
  overridden: (n: number) => (n === 1 ? '1 action changed' : `${n} actions changed`),
  conflicts: (n: number) =>
    n === 0 ? 'No conflicts.' : n === 1 ? '1 conflict:' : `${n} conflicts:`,
  // tools
  toolsIntro: 'External tools are configured in tools.json (no shell, argument lists).',
  editTools: 'Tool configuration…',
  toolCount: (n: number) => (n === 1 ? '1 tool' : `${n} tools`),
  // colours
  colorsIntro: 'Colour schemes: built-in, your own, or following the system.',
  editColors: 'Colour schemes…',
  currentScheme: (name: string, system: boolean) =>
    system ? `${name} (follows the system)` : name,
  // buttons & file types (design 022)
  customizeIntro:
    'The buttons of the bottom bar (buttons.json) and the file types for icons and marking (filetypes.json).',
  editButtons: 'Button configuration…',
  editFileTypes: 'File types…',
  buttonSetsChanged: (n: number) =>
    n === 0
      ? 'Buttons: built in.'
      : n === 1
        ? 'Buttons: 1 set changed.'
        : `Buttons: ${n} sets changed.`,
  fileTypesInfo: (n: number, own: boolean) =>
    `File types: ${n} ${n === 1 ? 'category' : 'categories'}${own ? ' (your own)' : ' (built in)'}.`,
  // data
  dataIntro:
    'All settings in one file: settings, shortcuts, colour schemes, rename presets, tools, buttons, file types.',
  exportTo: 'Export into folder',
  export: 'Export',
  exported: (path: string) => `Exported to ${path}`,
  importFrom: 'Import file',
  import: 'Import',
  importParts: 'Import',
  parts: {
    settings: 'Settings',
    keymap: 'Shortcuts',
    themes: 'Colour schemes',
    renamePresets: 'Rename presets',
    tools: 'Tools',
    buttons: 'Buttons',
    fileTypes: 'File types',
    starter: 'Starter menu',
    connections: 'Server connections (without passwords)',
  },
  toolsWarning:
    'Tools and starter entries start programs – import them only from a file you trust.',
  imported: (parts: string) => `Imported: ${parts}.`,
  importedNothing: 'Nothing was imported.',
  skipped: (part: string) => `${part}: missing or invalid in the file – skipped.`,
  failed: (part: string, path: string) => `${part}: could not be written (${path}).`,
  resetAll: 'Reset all settings',
  resetAllConfirm: 'Reset all settings to the defaults? Shortcuts, colour schemes and tools stay.',
  resetAllTitle: 'Reset settings',
  resetAllButton: 'Reset',
  fileHint: 'The active panel’s folder and the file under the cursor are suggested.',
  // warnings (codes from Rust)
  warnings: {
    broken: (path: string | null) =>
      path
        ? `The settings file was damaged; the defaults are used. The old file was kept as ${path}.`
        : 'The settings file was damaged; the defaults are used and changes are not saved in this session.',
    unreadable: (path: string | null) =>
      `The settings file could not be read (${path ?? 'settings.json'}); changes are not saved in this session.`,
    newer_version: () =>
      'The settings file comes from a newer version; it is used but not overwritten.',
    invalid_value: (key: string | null) =>
      `Setting ${key ?? ''} had an invalid value – default used.`,
    unknown_dropped: (key: string | null) =>
      `Unknown setting ${key ?? ''} was dropped (too large).`,
    not_saved: () => 'The settings are not saved in this session.',
    other: (code: string) => `Settings: ${code}`,
  },
  saveFailed: (msg: string) => `The settings could not be saved: ${msg}`,
};

const SETTINGS_DE: Translation<typeof SETTINGS_EN> = {
  title: 'Einstellungen',
  search: 'Einstellungen durchsuchen',
  searchPlaceholder: 'Einstellungen durchsuchen…',
  categories: 'Bereiche',
  results: (n) => (n === 1 ? '1 Einstellung gefunden' : `${n} Einstellungen gefunden`),
  noResults: 'Keine Einstellung passt.',
  resetSection: 'Bereich zurücksetzen',
  resetSectionOf: (name) => `Bereich ${name} zurücksetzen`,
  close: 'Schließen',
  changed: 'geändert',
  restart: 'Wirkt beim nächsten Start.',
  newTabs: 'Gilt für neue Tabs.',
  cat: {
    general: 'Allgemein',
    view: 'Ansicht',
    behavior: 'Verhalten',
    shell: 'Shell',
    keyboard: 'Tastatur',
    tools: 'Tools',
    colors: 'Farben',
    customize: 'Buttons & Dateitypen',
    data: 'Daten',
  },
  items: {
    'general.language': {
      label: 'Sprache',
      help: 'Sprache der Oberfläche; Datum und Zahlen folgen ihr.',
      keywords: 'locale deutsch english sprache',
    },
    'general.startFolder': {
      label: 'Beim Start',
      help: 'Was beide Seiten beim Start der App zeigen.',
      keywords: 'start ordner sitzung tabs home',
    },
    'view.sizeFormat': {
      label: 'Dateigrößen',
      help: 'Binär (1 KB = 1024 Bytes), dezimal (1 kB = 1000 Bytes) oder genaue Bytes.',
      keywords: 'größe bytes kb mb einheiten',
    },
    'view.dateFormat': {
      label: 'Datumsformat',
      help: 'Wie in Ihrer Sprache oder Jahr-Monat-Tag mit Uhrzeit (wie in der alten Version).',
      keywords: 'datum uhrzeit iso format',
    },
    'view.density': {
      label: 'Zeilenhöhe',
      help: 'Kompakt 24 px, normal 30 px, großzügig 34 px (wie in der alten Version).',
      keywords: 'dichte kompakt zeile höhe',
    },
    'view.folderBrackets': {
      label: 'Ordner in Klammern',
      help: 'Zeigt Ordner als [Name] (alte Version).',
      keywords: 'ordner klammern name',
    },
    'view.hideExtension': {
      label: 'Namen ohne Endung',
      help: 'Die Endung bleibt in der Spalte „Endung“ sichtbar.',
      keywords: 'endung erweiterung suffix name',
    },
    'view.showHidden': {
      label: 'Versteckte Dateien zeigen',
      help: 'Vorgabe für neue Tabs; der Schalter (Strg+H / ⌘⇧.) ändert den aktuellen Tab.',
      keywords: 'versteckt punkt dateien',
    },
    'view.menuBar': {
      label: 'Menüleiste',
      help: 'Windows und Linux; ohne sie erscheint die Menüleiste, während Sie sie benutzen (Alt+M).',
      keywords: 'menü leiste',
    },
    'behavior.deleteToTrash': {
      label: 'Löschen verschiebt in den Papierkorb',
      help: 'Aus: Löschen (F8) löscht endgültig – immer mit Rückfrage.',
      keywords: 'löschen papierkorb endgültig',
    },
    'behavior.confirmTrash': {
      label: 'Vor dem Papierkorb fragen',
      help: 'Endgültiges Löschen fragt immer.',
      keywords: 'bestätigen frage löschen papierkorb',
    },
    'behavior.doubleClick': {
      label: 'Doppelklick auf eine Datei',
      help: 'Ordner werden immer geöffnet.',
      keywords: 'doppelklick maus öffnen ansehen',
    },
    'behavior.spaceCalcSize': {
      label: 'Leertaste berechnet Ordnergrößen',
      help: 'Markieren eines Ordners mit der Leertaste berechnet auch seine Größe.',
      keywords: 'leertaste markieren ordner größe',
    },
    'behavior.rememberFolders': {
      label: 'Cursor und Markierung je Ordner merken',
      help: 'Jeder Tab merkt sich Cursor, Markierung und Scrollposition seiner letzten 50 Ordner, auch über einen Neustart (folder-memory.json). Ausschalten vergisst das Gemerkte.',
      keywords: 'merken cursor markierung auswahl ordner neustart gedächtnis verlauf',
    },
    'diskUsage.sizeMode': {
      label: 'Speicherbelegung: Größen',
      help: 'Belegt zählt die Blöcke auf dem Datenträger (Sparse- und Cloud-Dateien belegen wenig); die Größe ist die, die die Datei meldet. Gilt für neue Scans.',
      keywords: 'speicherbelegung platz belegt logisch größe blöcke',
    },
    'diskUsage.crossFilesystems': {
      label: 'Speicherbelegung: andere Laufwerke darunter scannen',
      help: 'Aus: Laufwerke, die im gescannten Ordner eingehängt sind, werden gezeigt, aber nicht gescannt.',
      keywords: 'speicherbelegung laufwerk einhängepunkt netzwerk dateisystem',
    },
    'diskUsage.chart': {
      label: 'Speicherbelegung: Diagramm',
      help: 'Ringe zeigen die Ordnerebenen, Kacheln zeigen große Dateien tief im Baum am besten.',
      keywords: 'speicherbelegung diagramm ringe kacheln sunburst treemap',
    },
    'watch.pollNetwork': {
      label: 'Netzlaufwerke per Polling überwachen',
      help: 'Netzlaufwerke melden keine Änderungen; Polling aktualisiert sie alle paar Sekunden (mehr Last).',
      keywords: 'überwachen aktualisieren netzwerk nfs smb polling',
    },
    'shell.enabled': {
      label: 'Shell-Zeile',
      help: 'Die Befehlszeile über den Buttons (Shift+F11). Sie führt nur aus, was eingetippt und mit Enter bestätigt wird.',
      keywords: 'shell befehlszeile kommandozeile terminal konsole cmd',
    },
    'shell.loginPath': {
      label: 'Programme aus der Login-Shell',
      help: 'Liest PATH und Sprache einmal aus der Login-Shell, damit Programme aus Homebrew, nvm oder cargo gefunden werden.',
      keywords: 'path homebrew brew umgebung login profil',
    },
    'shell.windowsShell': {
      label: 'Shell unter Windows',
      help: 'cmd.exe wie im Total Commander oder PowerShell (pwsh, falls installiert).',
      keywords: 'windows cmd powershell pwsh eingabeaufforderung',
    },
    'search.recent': {
      label: 'Letzte Suchen',
      help: 'Die letzten 10 Suchen bleiben über Neustarts erhalten.',
      keywords: 'suche finden verlauf zuletzt',
    },
    'search.templates': {
      label: 'Eigene Suchvorlagen',
      help: 'Im Suchdialog gespeicherte Vorlagen (bis 50); einzelne dort löschen.',
      keywords: 'suche finden vorlage muster eigene',
    },
    'dialogs.recent': {
      label: 'Letzte Eingaben der Werkzeug-Dialoge',
      help: 'Dateien gruppieren, Ordner aufräumen und Mehrere Ordner anlegen öffnen mit den Werten ihres letzten Laufs.',
      keywords: 'merken letzte eingaben dialog gruppieren aufräumen ordner anlegen vorlage',
    },
  },
  values: {
    system: 'System',
    en: 'English',
    de: 'Deutsch',
    session: 'Tabs wiederherstellen',
    home: 'Home-Ordner',
    binary: 'Binär (KB)',
    decimal: 'Dezimal (kB)',
    bytes: 'Bytes',
    locale: 'Format der Sprache',
    iso: 'jjjj-mm-tt hh:mm',
    condensed: 'Kompakt',
    normal: 'Normal',
    spacious: 'Großzügig',
    open: 'Mit der Standard-App öffnen',
    view: 'Ansehen (F3)',
    cmd: 'cmd.exe',
    powershell: 'PowerShell',
    allocated: 'Belegt',
    logical: 'Größe',
    sunburst: 'Ringe',
    treemap: 'Kacheln',
  },
  on: 'An',
  clearRecent: 'Leeren',
  shellIntro: 'Der Shell-Verlauf liegt in shell-history.json im App-Ordner (100 Befehle).',
  clearShellHistory: 'Shell-Verlauf leeren',
  shellHistoryCleared: 'Der Shell-Verlauf wurde geleert.',
  recentCount: (n) => (n === 1 ? '1 Suche gemerkt' : `${n} Suchen gemerkt`),
  templateCount: (n) => (n === 1 ? '1 eigene Vorlage' : `${n} eigene Vorlagen`),
  dialogCount: (n) => (n === 1 ? '1 Dialog gemerkt' : `${n} Dialoge gemerkt`),
  keyboardIntro: 'Kürzel je Aktion; Ihre Änderungen stehen in keymap.json.',
  editShortcuts: 'Kürzel bearbeiten…',
  resetShortcuts: 'Alle Kürzel zurücksetzen',
  overridden: (n) => (n === 1 ? '1 Aktion geändert' : `${n} Aktionen geändert`),
  conflicts: (n) => (n === 0 ? 'Keine Konflikte.' : n === 1 ? '1 Konflikt:' : `${n} Konflikte:`),
  toolsIntro: 'Externe Tools stehen in tools.json (keine Shell, Argumentlisten).',
  editTools: 'Tool-Konfiguration…',
  toolCount: (n) => (n === 1 ? '1 Tool' : `${n} Tools`),
  colorsIntro: 'Farbschemata: eingebaut, eigene oder dem System folgend.',
  editColors: 'Farbschemata…',
  currentScheme: (name, system) => (system ? `${name} (folgt dem System)` : name),
  customizeIntro:
    'Die Buttons der unteren Leiste (buttons.json) und die Dateitypen für Symbole und Markieren (filetypes.json).',
  editButtons: 'Button-Konfiguration…',
  editFileTypes: 'Dateitypen…',
  buttonSetsChanged: (n) =>
    n === 0
      ? 'Buttons: eingebaut.'
      : n === 1
        ? 'Buttons: 1 Satz geändert.'
        : `Buttons: ${n} Sätze geändert.`,
  fileTypesInfo: (n, own) =>
    `Dateitypen: ${n} ${n === 1 ? 'Kategorie' : 'Kategorien'}${own ? ' (eigene)' : ' (eingebaut)'}.`,
  dataIntro:
    'Alle Einstellungen in einer Datei: Einstellungen, Kürzel, Farbschemata, Rename-Vorlagen, Tools, Buttons, Dateitypen.',
  exportTo: 'Export in den Ordner',
  export: 'Exportieren',
  exported: (path) => `Exportiert nach ${path}`,
  importFrom: 'Datei importieren',
  import: 'Importieren',
  importParts: 'Importieren',
  parts: {
    settings: 'Einstellungen',
    keymap: 'Kürzel',
    themes: 'Farbschemata',
    renamePresets: 'Rename-Vorlagen',
    tools: 'Tools',
    buttons: 'Buttons',
    fileTypes: 'Dateitypen',
    starter: 'Startermenü',
    connections: 'Server-Verbindungen (ohne Passwörter)',
  },
  toolsWarning:
    'Tools und Startermenü starten Programme – nur aus einer Datei importieren, der Sie vertrauen.',
  imported: (parts) => `Importiert: ${parts}.`,
  importedNothing: 'Es wurde nichts importiert.',
  skipped: (part) => `${part}: fehlt in der Datei oder ist ungültig – übersprungen.`,
  failed: (part, path) => `${part}: konnte nicht geschrieben werden (${path}).`,
  resetAll: 'Alle Einstellungen zurücksetzen',
  resetAllConfirm:
    'Alle Einstellungen auf die Vorgaben zurücksetzen? Kürzel, Farbschemata und Tools bleiben.',
  resetAllTitle: 'Einstellungen zurücksetzen',
  resetAllButton: 'Zurücksetzen',
  fileHint: 'Vorgeschlagen werden der Ordner der aktiven Seite und die Datei unter dem Cursor.',
  warnings: {
    broken: (path) =>
      path
        ? `Die Einstellungsdatei war beschädigt; es gelten die Vorgaben. Die alte Datei liegt jetzt unter ${path}.`
        : 'Die Einstellungsdatei war beschädigt; es gelten die Vorgaben, und Änderungen werden in dieser Sitzung nicht gespeichert.',
    unreadable: (path) =>
      `Die Einstellungsdatei konnte nicht gelesen werden (${path ?? 'settings.json'}); Änderungen werden in dieser Sitzung nicht gespeichert.`,
    newer_version: () =>
      'Die Einstellungsdatei stammt von einer neueren Version; sie wird benutzt, aber nicht überschrieben.',
    invalid_value: (key) =>
      `Einstellung ${key ?? ''} hatte einen ungültigen Wert – Vorgabe benutzt.`,
    unknown_dropped: (key) => `Unbekannte Einstellung ${key ?? ''} wurde verworfen (zu groß).`,
    not_saved: () => 'Die Einstellungen werden in dieser Sitzung nicht gespeichert.',
    other: (code) => `Einstellungen: ${code}`,
  },
  saveFailed: (msg) => `Die Einstellungen konnten nicht gespeichert werden: ${msg}`,
};

export const SETTINGS_TEXTS = translatable('settings', SETTINGS_EN, { de: SETTINGS_DE });
