# Prompt 002: Aktionssystem, Tastenkürzel und „Go to anything“

> **Slug:** `aktionen-tastatur` · **Braucht:** 001 · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: `docs/legacy-analysis.md` §1.2 (Action-Dispatch,
> Dialog-Modus), §2 (Action-IDs, Shortcuts, Tastatur-Mechanik), §3 („Go to anything“, Enhance/Reduce selection),
> §4 (Auswahlmodell).

## Ziel

Jede Funktion der App ist eine **Aktion mit stabiler Id** – auslösbar per Tastenkürzel, Menü, Button-Leiste,
Kontextmenü und Befehlspalette. Tastenkürzel kommen aus einer Keymap je Betriebssystem (inklusive **Linux**, das im
alten Programm fehlte) und lassen sich vom Nutzer überschreiben. Alle späteren Prompts registrieren ihre Funktionen
nur noch hier.

## Altes Verhalten (Kurzfassung)

- Action-Ids (`OPEN_COPY_DLG`, `TOGGLE_PANEL`, `NAVIGATE_BACK`, …) sind Schlüssel eines Event-Busses; `OPEN_*`
  öffnet einen Dialog. Keymaps `osx.json`/`windows.json` (`{"mapping":[{"shortcut","id"}]}`, Keypress-Syntax),
  Nutzer-Override je Username. Während ein Dialog offen ist, sind alle Kürzel aus, nur Strg+Enter (primärer Button)
  und Esc wirken.
- „Go to anything“: Typeahead über alle Aktionen **mit** Kürzel + Tools, max. 12 Treffer.
- Auswahl: Insert (macOS Strg+0) = Zeile umschalten + Cursor weiter, Num* = invertieren, Num+/Num− = Dialog „Auswahl
  erweitern/verringern“ per Regex (mit Vorlagen), Strg+Num+/− = alles/nichts. Leertaste = Ordnergröße (Prompt 003).

## Aufgaben

1. **Aktions-Register** (`src/app/core/actions/`): `ActionId` als String-Union (alte Ids übernehmen, wo sinnvoll;
   Tippfehler wie `OPEN_FIND_DUBLICATES_DLG` korrigieren und im Design auflisten), `ActionDef { id, label, category,
   enabled(ctx), run(ctx) }`, Kontext = aktives Panel, Quelle/Ziel, Auswahl. Ausführen zentral (`ActionService.run`),
   Ergebnis/Fehler als Toast/Live-Region.
2. **Keymaps** als JSON im Repo (`src/assets/keymaps/{macos,windows,linux}.json` oder Rust-Ressource – entscheiden),
   moderne Notation auf Basis von `KeyboardEvent.key`/`code` (z. B. `Mod+Shift+S`, `Insert`, `NumpadAdd`, `F7`),
   Umrechnungstabelle von der alten Keypress-Syntax im Design. Defaults: Total-Commander-Standard auf Windows/Linux
   (F3 Ansicht, F4 Bearbeiten, F5 Kopieren, F6 Verschieben, Shift+F6 Umbenennen, F7 Ordner, F8/Entf Löschen, Alt+F7
   Suchen, Tab Panel wechseln, Strg+T/Strg+W Tabs, Strg+R neu laden …); macOS mit platform-typischen Alternativen
   (⌘-Kombinationen, F-Tasten zusätzlich). Konflikte mit System-/WebView-Kürzeln (⌘Q, ⌘W, ⌘R, Strg+Tab) prüfen.
3. **Nutzer-Override**: Datei im App-Config-Verzeichnis (Pfad über Tauri `path().app_config_dir()`), wird beim Start
   geladen und mit den Defaults gemischt (pro Aktion ersetzen, nicht Arrays per Index wie früher). Fehlerhafte
   Einträge melden, nicht abstürzen. (Einstellungs-UI kommt in Prompt 015.)
4. **Tastatur-Dispatcher**: ein globaler Handler (Capture an `document`) mit Prioritäten: Dialog/Palette offen →
   nur deren Tasten (Esc, Strg/⌘+Enter); Texteingabe fokussiert → keine Einzeltasten-Kürzel; sonst Keymap. Abgleich
   mit der GuiExpert Table: welche Tasten verbraucht sie (Prompt 001), welche müssen über
   `shortcutActionIdMapping` umgebogen oder abgeschaltet werden? Kein Kürzel darf doppelt belegt sein (Test, der alle
   Keymaps prüft).
5. **Total-Commander-Auswahl**: Insert/Leertaste-Variante (Design: Leertaste markieren wie TC **oder** Ordnergröße
   wie das alte Programm – Empfehlung TC: Leertaste markiert Datei, bei Ordnern markieren + Größe berechnen),
   Shift+Pfeile/Bild/Pos1/Ende erweitern, Num+/Num− Dialog mit Muster (Glob **und** Regex, Vorlagen aus dem alten
   Programm), Num* invertieren, Strg/⌘+A. Gilt nur für Zeilen, die der Filter zeigt.
6. **Befehlspalette „Go to anything“** (Strg/⌘+Shift+P und alte Kürzel): alle Aktionen (auch ohne Kürzel), Tools
   (Prompt 011) und später Favoriten/Verlauf; unscharfe Suche, Kürzel rechts als `<kbd>` (macOS-Symbole ⌘⌥⇧⌃),
   Tastatur und Screenreader (APG Combobox + Listbox).
7. **Anzeige der Kürzel** in Tooltips und Menüs aus derselben Quelle (`formatShortcut(platform)`).
8. **Funktionstasten-Leiste** unten (wie TC: F3 … F8), Klick = Aktion; ausblendbar.

## Entscheidungsfragen

- Keymaps im Frontend (Assets) oder im Rust-Backend (eine Quelle für Menüs der nativen Menüleiste)? Native
  Menüleiste (Tauri `Menu`) jetzt oder später?
- Notation `key` vs. `code` (Tastaturlayouts! Deutsche Tastatur: `Mod+Shift+7`?) – Empfehlung mit Begründung.
- Leertaste: TC-Verhalten oder altes Verhalten?
- Dürfen Nutzer Aktionen ganz abschalten (leerer Shortcut)?

## Akzeptanzkriterien

- Alle bis dahin vorhandenen Funktionen (Öffnen, Hoch, Neu laden, Panel-Fokus) laufen über Aktionen.
- Keymaps für macOS, Windows, Linux; Test: keine Doppelbelegung, jede Id existiert.
- Override-Datei ändert ein Kürzel nach Neustart; fehlerhafte Datei → Warnung, Defaults bleiben.
- Insert/Leertaste, Shift+Pfeile, Num+/−/* und Strg/⌘+A markieren wie beschrieben; Markierung übersteht Sortieren.
- Befehlspalette findet jede Aktion per Tastatur; Esc schließt und gibt den Fokus an die Liste zurück.

## Definition of Done (zusätzlich zu 000)

- [ ] Tabelle Aktion → Kürzel je OS in README („Tastenkürzel“)
- [ ] Umrechnungstabelle alte → neue Notation im Design-Dokument
- [ ] `docs/feature-parity.md`: Zeilen Shortcuts, Go to anything, Auswahl aktualisiert
