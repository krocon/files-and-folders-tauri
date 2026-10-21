# Prompt 027: Persistenz je Ordner und letzte Dialogeingaben

> **Slug:** `persistenz-je-ordner` · **Braucht:** 003 (Navigation, `TabMemory`), 004 (Sitzung), 008 (Gruppieren,
> Aufräumen, Multi-MkDir), 015 (Einstellungen) · **Umfang:** S–M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/003-navigation-liste.design.md` (E3, `TabMemory`) und
> `prompts/done/004-dual-pane-tabs.design.md` (Sitzungsdatei). Herkunft: `docs/feature-parity.md` Zeilen „Auswahl/Cursor
> je Ordner merken“ und „Letzte Dialogeingaben“ (beide 🟡), Vorschlag aus 018.

## Ziel

Was mr im `localStorage` hielt, überlebt auch hier einen Neustart: Cursor und Markierung je Ordner und die letzten
Eingaben der Werkzeug-Dialoge. Heute liegt beides nur im Speicher (`TabMemory.folders`, 50 Ordner je Tab) bzw. gar nicht.

## Bestand

- `features/browser/tab-memory.ts`: Cursor/Markierung/Scroll je Ordner und Tab, nur im Speicher (Design 003 E3).
- `src-tauri/src/session.rs`: Sitzungsdatei Schema v1 (Tabs, Pfade, Verlauf), `sanitize`, atomar (`fs_atomic.rs`).
- Dialoge 008: `GroupFilesStore`, `CleanFoldersStore`, `MultiMkdirStore` – Eingaben gehen mit dem Dialog verloren.
  Suche (`search.recent`) und Multi-Rename (`rename-presets.json`, „zuletzt“) merken schon etwas – Muster dafür.

## Aufgaben

1. **Ordnergedächtnis über Neustart:** Entscheidung im Design – in der Sitzungsdatei (Schema v2 mit Migration) oder
   eigene Datei `folder-memory.json`. Obergrenzen (Ordner je Tab, Markierungen je Ordner, Dateigröße), LRU, kein
   Speichern für Archiv-, Server- (`remote://`) und Ergebnis-Tabs, es sei denn, das Design begründet es.
2. **Beim Wiederherstellen** nur anwenden, was im neuen Listing noch existiert (Pfade sind opak, Abgleich per Pfad);
   Markierungen nie auf andere Einträge „rutschen“ lassen.
3. **Einstellung** „Cursor und Markierung je Ordner merken“ (an/aus, Default an) und „Gedächtnis leeren“.
4. **Letzte Dialogeingaben** für Gruppieren, Aufräumen und Multi-MkDir (Muster, Modus, Optionen) – eine kleine
   Datei oder ein Abschnitt in `settings.json`; Entscheidung im Design. Ungültiges aus der Datei wird verworfen
   (`sanitize`), nie ein Fehlerdialog beim Start.
5. Datenschutz: nur Pfade/Namen, die ohnehin in der Sitzung stehen; Export/Import der Einstellungen (015) entscheidet
   das Design (Gedächtnis eher **nicht** exportieren).

## Akzeptanzkriterien

- Ordner öffnen, Cursor auf Datei X, zwei Dateien markieren, in einen anderen Ordner, App beenden und neu starten,
  zurück in den Ordner → Cursor auf X, beide markiert.
- Eine der markierten Dateien wurde zwischendurch gelöscht → nur die verbliebene ist markiert, kein Fehler.
- Gruppieren-Dialog öffnen, Modus/Optionen ändern, ausführen, Neustart → Dialog zeigt die letzten Werte.
- Kaputte oder zu große Datei → wird beiseitegelegt (`.bad`), App startet normal.

## Tests

- Rust: Schema/Migration, `sanitize` (Grenzen, falsche Typen), atomares Schreiben, `.bad`.
- Frontend: `TabMemory` lädt/speichert über eine Fassade (Fake), Wiederherstellen nur vorhandener Einträge,
  Einstellung aus → nichts gespeichert, Dialog-Stores übernehmen gespeicherte Eingaben.
- E2E unter Xvfb: Neustart-Szenario aus den Akzeptanzkriterien.
