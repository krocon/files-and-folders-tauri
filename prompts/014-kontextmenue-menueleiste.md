# Prompt 014: Kontextmenü und Menüleiste

> **Slug:** `kontextmenue-menueleiste` · **Braucht:** 002, 006 · **Umfang:** S–M
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: Kontextmenü war ein Platzhalter (legacy §3), Aktionen
> waren über ein Fuß-Menü erreichbar (legacy §2, „Menu-only actions“).

## Ziel

Jede Aktion ist auch mit der Maus erreichbar: ein Kontextmenü auf Dateien/Ordnern/Panel-Hintergrund und eine
Menüleiste (nativ unter macOS, in Windows/Linux wahlweise nativ oder in der App) – beides aus dem Aktionsregister
(002), mit angezeigten Tastenkürzeln.

## Aufgaben

1. **Kontextmenü** (Rechtsklick, Menü-Taste, Shift+F10): Einträge je Kontext (Datei, Ordner, Mehrfachauswahl,
   leere Fläche, Ergebnis-Tab), deaktivierte Einträge statt fehlender, Untermenüs (Tools, Kopieren als …).
   Entscheiden: natives Menü (Tauri `Menu`/`popup`) oder eigenes HTML-Menü (APG Menu-Muster, Tastatur, Fokus
   zurück). GuiExpert-Ereignis `contextmenu` liefert Zeile/Spalte – Rechtsklick auf nicht markierte Zeile setzt
   den Cursor dorthin (TC-Verhalten), auf markierte behält die Markierung.
2. **Menüleiste**: Datei, Bearbeiten, Ansicht, Gehe zu, Werkzeuge, Fenster, Hilfe; macOS-Anwendungsmenü
   (Über, Einstellungen ⌘,, Beenden). Native Menü-Kürzel und Keymap (002) dürfen sich nicht widersprechen – eine
   Quelle (Keymap) erzeugt die Accelerator der nativen Menüs.
3. Optional: Systemkontextmenü des OS (Explorer-Shell-Erweiterungen) – nur bewerten und dokumentieren.

## Akzeptanzkriterien

- Kontextmenü per Maus und Tastatur, Einträge passend zum Kontext, Aktion wirkt auf die richtige Auswahl.
- Menüleiste zeigt dieselben Kürzel wie die Keymap; Änderung im Override (002) schlägt nach Neustart durch.
