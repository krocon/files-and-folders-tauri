# Design 070: Farbschema-Auswahl mit Vorschaubildern

Status: umgesetzt (02.11.2026, Entscheidungen selbständig – bitte prüfen).

- **E1** 🎨 öffnet den Picker (Aktion `OPEN_THEME_PICKER`); das alte Popup-Menü entfällt – die Namen stehen im
  Hauptmenü, der Editor ist aus dem Picker erreichbar („Edit colour schemes…“, `Mod+E`).
- **E2** Untermenü **View ▸ Colour scheme ▸** (wie editlicious): „Choose colour scheme…“ (Picker), alle Schemata als
  Radio-Einträge mit ✓ (`@themes`, Quelle `ActionService.themeChoices`, gesetzt vom `ThemeService`), dann Next / Follow
  the system / Edit. Nativ macOS als Check-Items (`MenuNode::Item.checked`, Rust `CheckMenuItemBuilder`); der Menübau
  folgt der Auswahl über `nativeStructureKey`.
- **E3** Reihenfolge: „Follow the system“, eigene, eingebaute, alte Designs – je mit Überschrift (wie `themes()`).
- **E4** Vorschaubild aus den Tokens (`ThemeThumb`): Mini-Dual-Panel mit Kopf, gewähltem Tab in Listenfarbe (069),
  Ordner/Datei/markiert/Cursor, Statuszeile. Nur aufgelöste `#rrggbb` gelangen in die CSS-Variablen
  (`thumbStyle`); keine Bilddateien, eigene/importierte Schemata bekommen automatisch ein Bild. Karten ab 11,5rem,
  Spalten responsiv.
- **E5** Filter: jedes Wort in Name, Gruppe oder hell/dunkel (auch deutsch); Zähler als `role="status"`.
- Live-Vorschau über `ThemeService.preview` (wie der Editor); Enter/OK wählt (`select`/`followSystem`), Esc/Cancel und
  Schließen setzen die Vorschau zurück. Raster als `listbox` mit `aria-activedescendant`, eigenes Enter (057).
