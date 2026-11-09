import type { Translation } from '../../core/i18n/i18n';
import type { FILE_ACTIONS_EN } from './file-actions-texts';

/** Deutsche Texte der Doppelklick-Aktionen (Design 072). */
export const FILE_ACTIONS_DE: Translation<typeof FILE_ACTIONS_EN> = {
  title: 'Doppelklick-Aktionen',
  intro:
    'Was ein Doppelklick auf eine passende Datei statt des Öffnens tut – mit oder ohne gehaltene Taste (Umschalt, ⌘/Strg, Alt). Die erste Regel von oben mit denselben Tasten und passendem Muster gilt. Nichts läuft über eine Shell – jedes Wort des Kommandos ist ein Argument. Es läuft im Hintergrund, außer du wählst ein Terminalfenster.',
  rules: 'Regeln',
  noRules: 'Noch keine Regeln – unten eine hinzufügen.',
  listHelp: 'Alt+↑/↓ verschieben, Entf entfernt.',
  add: 'Hinzufügen',
  remove: 'Entfernen',
  moveUp: 'Hoch',
  moveDown: 'Runter',
  newPattern: '(kein Muster)',
  noSelection: 'Links eine Regel wählen oder eine hinzufügen.',
  trigger: 'Auslöser',
  triggers: { doubleClick: 'Doppelklick' },
  keysHeld: 'Gehaltene Tasten (keine angehakt = ohne Taste)',
  modifierNames: {
    macos: { mod: 'Befehl', alt: 'Wahl', shift: 'Umschalt' },
    other: { mod: '', alt: '', shift: '' },
  },
  ruleHeading: (keys, kind, pattern) =>
    `${keys ? `${keys} ` : ''}${kind} auf ${pattern || '(kein Muster)'}`,
  shadowed: 'Läuft nie: dieselbe Regel steht darüber.',
  shadowedHint:
    'Eine Regel darüber hat denselben Auslöser, dieselben Tasten und dasselbe Muster, diese läuft also nie. Tasten oder Muster ändern oder sie entfernen.',
  pattern: 'Dateimuster',
  patternHelp:
    'Zum Beispiel *.js – mehrere durch ; oder Leerzeichen getrennt, Groß-/Kleinschreibung egal.',
  confirm: 'Vor dem Ausführen fragen',
  terminal: 'In einem Terminalfenster ausführen',
  command: 'Kommando',
  commandHelp:
    'Zum Beispiel node %N – läuft im Ordner der Datei. %N oder %name Name der Datei · %P%N voller Pfad · %O Name ohne Endung · %E Endung · %T Ordner des anderen Panels · %% ein Prozentzeichen. Anführungszeichen fassen Wörter zusammen.',
  problems: {
    trigger:
      'Dieser Auslöser oder eine seiner Tasten ist dieser Version unbekannt – Auslöser und Tasten neu wählen.',
    pattern: 'Das Dateimuster ist leer.',
    program:
      'Das Kommando muss mit einem Programmnamen oder einem absoluten Pfad beginnen, ohne Platzhalter.',
    params_quote: 'Ein Anführungszeichen im Kommando ist nicht geschlossen.',
    params_files: '%S muss ein eigenes Wort sein.',
    too_long: 'Das Kommando hat zu viele Wörter.',
  },
  fixProblems: 'Bitte zuerst die markierten Regeln korrigieren.',
  help: 'Hilfe',
  cancel: 'Abbrechen',
  save: 'Speichern',
  saveFailed: (reason) => `Speichern fehlgeschlagen: ${reason}`,
  loadFailed: (reason) => `Die Doppelklick-Aktionen konnten nicht geladen werden: ${reason}`,
  confirmTitle: 'Kommando ausführen?',
  confirmRun: 'Ausführen',
  started: (command, name) => `${command} für ${name} gestartet`,
  helpContent: {
    title: 'Hilfe: Doppelklick-Aktionen',
    close: 'Schließen',
    howHeading: 'So funktioniert es',
    how: 'Ein Doppelklick auf eine Datei geht die Regeln von oben durch. Die erste mit denselben gehaltenen Tasten und passendem Muster führt ihr Kommando aus, statt die Datei zu öffnen. Passt keine, öffnet sich die Datei wie gewohnt – auch mit gehaltener Taste. Ordner, Archive, Serverordner und die Dubletten-Ansicht sind nie betroffen, und Enter öffnet die Datei immer normal.',
    fieldsHeading: 'Felder',
    fields: [
      { term: 'Auslöser', text: 'Was die Regel auslöst. Vorerst ist das der Doppelklick.' },
      {
        term: 'Gehaltene Tasten',
        text: 'Die Tasten, die beim Doppelklick gehalten werden müssen – genau diese: Eine Regel für Umschalt+Doppelklick läuft nicht bei einem Doppelklick ohne Taste, und eine Regel ohne Tasten nicht bei Umschalt+Doppelklick. ⌘ auf macOS ist Strg unter Windows und Linux. Ctrl auf macOS öffnet das Kontextmenü und wird deshalb nicht angeboten. Manche Linux-Desktops verschieben bei Alt+Ziehen das Fenster; dort kommt ein Alt+Doppelklick eventuell nicht in der App an.',
      },
      {
        term: 'Dateimuster',
        text: 'Wird mit dem Dateinamen verglichen: * steht für beliebigen Text, ? für ein Zeichen. Mehrere Muster: *.js;*.mjs. Groß- und Kleinschreibung sind egal.',
      },
      {
        term: 'Vor dem Ausführen fragen',
        text: 'Zeigt zuerst Kommando und Datei. Enter bedeutet dort Abbrechen: Gestartet wird nur über den roten Button.',
      },
      {
        term: 'In einem Terminalfenster ausführen',
        text: 'Öffnet Terminal (macOS), cmd (Windows) oder dein Terminalprogramm (Linux; $TERMINAL hat Vorrang). Du siehst die Ausgabe und kannst Fragen beantworten; danach bleibt das Fenster mit einer Eingabezeile im Ordner der Datei offen. Ohne diese Option läuft das Programm unsichtbar, und nur ein fehlgeschlagener Start wird gemeldet.',
      },
      {
        term: 'Kommando',
        text: 'Zuerst das Programm, dann seine Argumente. Das Programm ist ein Name aus dem PATH oder ein voller Pfad; ~ ist dein Benutzerordner. Es läuft im Ordner der Datei.',
      },
    ],
    placeholdersHeading: 'Platzhalter',
    placeholdersIntro:
      'Für die Datei /home/marc/docs/report final.js mit /backup im anderen Panel:',
    placeholders: [
      'Name der Datei',
      'Voller Pfad',
      'Name ohne Endung',
      'Endung ohne Punkt',
      'Ordner der Datei',
      'Ordner des anderen Panels',
      'Ein Prozentzeichen',
    ],
    placeholdersNote:
      'Ein Name mit Leerzeichen bleibt ein Argument und braucht keine Anführungszeichen.',
    examplesHeading: 'Beispiele',
    examples: [
      'Führt ein Skript aus; im Terminalfenster siehst du seine Ausgabe.',
      'Ein festes Argument nach der Datei.',
      'Erzeugt report final.mp3 neben der Datei.',
      'Kopiert die Datei ins andere Panel.',
    ],
    limitsHeading: 'Grenzen',
    keysHeading: 'Gehaltene Tasten',
    keysExample:
      'Beispiel: zwei Regeln für *.js – Umschalt+Doppelklick führt node %N im Terminalfenster aus, ⌘/Strg+Doppelklick führt code %N aus. Ein Doppelklick ohne Taste hat keine Regel und öffnet die Datei wie gewohnt.',
    keysNote:
      'Ein ⌘/Strg- oder Umschalt-Klick markiert Dateien. Übernimmt eine Regel den Doppelklick, wird die Markierung wie vor dem ersten Klick wiederhergestellt – sie kann kurz aufblitzen.',
    limits:
      'Kommandos laufen nicht über eine Shell, deshalb werden |, && und > als normaler Text weitergegeben. Dafür schreibst du ein kleines Skript und startest dieses. Doppelte Anführungszeichen fassen mehrere Wörter zu einem Argument zusammen. Unter Windows lässt sich ein doppeltes Anführungszeichen im Terminalfenster nicht weitergeben.',
  },
};
