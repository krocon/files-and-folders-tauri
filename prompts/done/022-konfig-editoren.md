# Prompt 022: Konfigurations-Editoren – Buttons, Dateitypen, Suchvorlagen, Vollbild

> **Slug:** `konfig-editoren` · **Braucht:** 002 (Aktionen, Keymaps), 009 (Suche), 014 (Menüs), 015 (Einstellungen,
> Export/Import), 018 (Parität: Zeilen „Button-Konfig“, „Dateityp-Konfig“, „Suchmuster“, J14) · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/015-einstellungen-i18n.design.md` (E1–E4: Dateien im
> Konfig-Ordner, Bündel) und `docs/feature-parity.md` (Abschnitt „Folge-Prompts“, 022).
> Marc hat am 20.10.2026 den Rahmen festgelegt (unten); Details entscheidet das Design, ohne Haltepunkt nach Phase 1.

## Ziel

Was in mr per Monaco-JSON-Editor konfigurierbar war (Button-Leiste, Dateitypen) und was heute nur fest eingebaut oder
nur für die Sitzung gilt (eigene Suchvorlagen), wird dauerhaft und mit strukturierten, barrierefreien Dialogen
änderbar. Dazu kommt Vollbild unter Windows/Linux (J14).

## Bestand

- `features/workspace/button-bar/buttons.json` (mr-Format + `ctrl`), `BUTTON_SETS` als Konstante;
  `OPEN_BUTTON_CONFIG_DLG` im Katalog ohne Handler.
- `core/file-icon/file-icon.service.ts`: `FILE_CATEGORIES` fest (11 mr-Kategorien), nur für Icons und Icon-Farben.
  Der Markier-Dialog hat eigene feste Vorlagen (`PATTERN_PRESETS`).
- Suche: `search-presets.json` (mr-Format), eigene Vorlagen nur im Speicher (`SearchStore.templates`), letzte Suchen
  dauerhaft in `settings.json` (`search.recent`).
- Konfig-Dateien in Rust nach dem Muster `keymap.rs`/`rename_presets.rs` (Version, sanitize, atomar, `.bad`);
  Bündel-Export/Import in `settings.rs` (Teile `settings`, `keymap`, `themes`, `renamePresets`, `tools`).
- Vollbild nur über das native macOS-Menü (`{ native: 'fullscreen' }`).

## Aufgaben

1. **Button-Leiste konfigurierbar:** Nutzerdatei `buttons.json` (Rust-Modul, Schema-Version, Grenzen, atomar, kaputte
   Datei beiseite) überschreibt die eingebauten Sätze **je Modifier-Satz** (default/shift/ctrl/alt/cmd). Dialog
   `OPEN_BUTTON_CONFIG_DLG`: je Satz die Slots, Aktion aus dem Katalog wählen (Combobox mit Suche über das Label),
   Reihenfolge ändern, Slot hinzufügen/entfernen (Obergrenze), „Auf Standard zurücksetzen“ je Satz und gesamt,
   Vorschau. Unbekannte Aktions-Ids werden beim Laden verworfen (mit Hinweis). Die Leiste übernimmt Änderungen sofort.
2. **Dateitypen konfigurierbar:** neue Aktion `OPEN_FILETYPE_CONFIG_DLG`; Nutzerdatei `filetypes.json` (mr-Format
   `[{label, extensions[]}]` lesbar); Dialog: Kategorie anlegen/umbenennen/löschen/verschieben, Endungen als Text,
   Icon aus einer festen FA-4.5-Liste, Icon-Farbe, Reset. Alle Nutzer der Kategorien (Icons/Farben der Liste,
   Markieren nach Typ) lesen aus einem Root-Store.
3. **Eigene Suchvorlagen dauerhaft:** speichern/löschen im Suchdialog, persistiert (Ort im Design begründen).
4. **Vollbild unter Windows/Linux (J14):** Aktion `TOGGLE_FULLSCREEN`, schmaler async Command auf das Hauptfenster
   (keine Capability), Kürzel F11 unter Windows/Linux, macOS behält ⌃⌘F im nativen Menü; Menüeintrag.
5. **Export/Import aller Einstellungen** um die neuen Dateien erweitern.
6. **Einstiege:** Menüleiste, Einstellungsdialog, Befehlspalette; Dialoge mit Tastatur, Fokusfalle, APG-Mustern.

Nicht im Umfang: KI-Prompt-Konfiguration; Import der alten mr-Dateien (026) – Formate so wählen, dass 026 sie leicht
übersetzen kann.

## Akzeptanzkriterien

- Button-Dialog: Slot im Satz „Shift“ ändern, speichern → die Leiste zeigt mit gehaltenem Shift sofort die neue
  Aktion; nach Neustart bleibt es. „Satz zurücksetzen“ stellt die eingebauten Buttons wieder her.
- Eine `buttons.json` mit unbekannter Id zeigt einen Hinweis; die übrigen Slots gelten. Eine kaputte Datei wird als
  `buttons.json.bad` beiseitegelegt, die Leiste zeigt die Standardbelegung.
- Dateitypen: neue Kategorie „Comics“ mit `.cbz` und Icon `fa-book` → `.cbz`-Dateien zeigen sofort das Icon; im
  Markier-Dialog gibt es die Vorlage „Comics“. Reset stellt die 11 eingebauten Kategorien her.
- Eine mr-`filetypes.json` (nacktes Array) wird gelesen.
- Suchdialog: Vorlage speichern, App neu starten, Vorlage ist da; Vorlage löschen.
- F11 (Linux/Windows) schaltet Vollbild an und aus; der Menüeintrag „Vollbild“ tut dasselbe.
- Einstellungen exportieren/importieren enthält Buttons und Dateitypen (und die Suchvorlagen über `settings.json`).
- Alle Dialoge sind ohne Maus bedienbar, Texte en/de.

## Tests

- Rust: Laden/Speichern/Grenzen beider Dateien (Unicode im Pfad, kaputt → `.bad`, Lesefehler, Version, mr-Array),
  Bündel mit den neuen Teilen, Command-Regel (async).
- Frontend: reine Logik (Sätze auflösen, Slots verschieben/ersetzen, Endungen parsen, Kategorien prüfen), Stores mit
  Fake-Fassade (Laden mit Hinweis, Speichern, Reset), Dialoge (Tastatur, Combobox), Icons aus dem Store,
  Markier-Vorlagen, Suchvorlagen dauerhaft, Fullscreen-Aktion, Katalog-Vollständigkeit en/de.
- E2E unter Xvfb: Button-Satz ändern und Leiste prüfen, Dateityp anlegen und Icon prüfen, Vorlage speichern +
  Neustart, F11.
