# Prompt 043: Command Palette als universeller Einstieg (Dateien finden und sofort handeln)

> **Slug:** `command-palette-universal` · **Braucht:** 002 (Aktionen, Palette), 009 (Suche in Rust, gebündelte
> Treffer, Ergebnis-Tabs), 010 (Vorschau), 006 (Kopieren/Verschieben/Umbenennen), 033 (Speicherbelegung), 042 (ähnliche
> Dateien – falls vorhanden, sonst ohne diese Aktion) · **Umfang:** L
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/002-aktionen-tastatur.design.md` (Palette),
> `prompts/done/018-feature-paritaet.design.md` E4 (Ordner in der Palette) und `prompts/done/009-suche.design.md`
> (Suche als Job, Drosselung, Abbruch). Auftrag von Marc (21.10.2026).

## Auftrag (wörtlich)

> Command Palette bereits vorhanden.
>
> TODO Command Palette noch mehr als eine universelle Such- und Aktionsoberfläche ausbauen
>
> Der Nutzer tippt beispielsweise invoice 2025, bekommt passende Dateien aus verschiedenen Verzeichnissen angezeigt und
> kann sofort Aktionen ausführen:
> - Datei öffnen oder in der Vorschau ansehen
> - Zum Speicherort springen
> - In den anderen Dateibereich kopieren
> - Umbenennen oder verschieben
> - Ähnliche Dateien finden
> - Den übergeordneten Ordner analysieren
>
> Die Suche sollte nicht zu einem separaten Werkzeug werden, sondern der Einstieg in die gesamte Anwendung sein.
>
> Für die technische Umsetzung in Tauri würde ich dabei die Dateisystemoperationen im Rust-Backend ausführen und die
> Oberfläche möglichst reaktionsschnell halten. Bei sehr großen Verzeichnissen sind inkrementelles Laden,
> Virtualisierung der Dateiliste und ein begrenzter Speicherverbrauch entscheidend.

## Bestand (zuerst prüfen)

- `features/actions/command-palette.ts` („Command Palette“, `Mod+Shift+P`, F10 = nur Aktionen): Combobox + Listbox
  nach APG, unscharfe Suche über Aktionen, Tools, Farbschemata und bekannte **Ordner** (Tabs, Verläufe, Favoriten,
  zuletzt; 018 E4), getippter Pfad navigiert. **Keine Dateien**, keine Aktionen auf Treffern.
- Suche in Rust (`search.rs`, Job `search`, Treffer gebündelt ≤ 500 / 50 ms, abbrechbar), Ergebnis-Tabs (009).
- Es gibt keinen Index – jede Dateisuche läuft heute durch das Dateisystem.

## Ziel

Die Palette wird zum Einstieg in alles: Aktionen **und** Dateien/Ordner aus mehreren Orten in einer Liste, mit
Aktionen direkt am Treffer. Tippen fühlt sich sofort an (erste Treffer < 100 ms aus bekannten Quellen), weitere Treffer
strömen nach, alles abbrechbar, Speicher begrenzt.

## Aufgaben

1. **Phase 1 – Design 🛑** mit Messungen: Woher kommen Dateitreffer schnell genug? Optionen bewerten und empfehlen:
   (a) Live-Suche wie 009 in festgelegten Wurzeln (Home, Tabs, Favoriten, zuletzt), Tiefe/Zeit begrenzt;
   (b) **eigener, begrenzter Namensindex** in Rust (im Hintergrund aufgebaut, per Watcher aktualisiert, Wurzeln
   konfigurierbar, Ausschlüsse wie `node_modules`/`.git`, Obergrenze Einträge/RAM, optional auf Platte);
   (c) System-Suche (Spotlight `mdfind`, Windows Search, `locate`/`plocate`) als optionale Quelle – nur als externes
   Programm ohne Shell, Ergebnisse geprüft. Empfehlung mit Zahlen (Zeit bis erster Treffer, RAM bei 1 Mio. Dateien).
2. **Abfrage-Sprache (klein, rein, Testkatalog):** mehrere Wörter = alle müssen im Namen oder Pfad vorkommen
   (`invoice 2025`), Groß/klein und Akzente egal (wie Typeahead), optional Präfixe: `>` nur Aktionen, `/` oder `~`
   Pfad, `ext:pdf`, `in:Projekte`, `size>10m`, `modified:2025`. Rangfolge: Treffer im Namen vor Pfad, Wortanfang,
   kürzlich benutzte Orte/Tabs zuerst, Aktionen bei passendem Namen oben.
3. **Rust:** Command/Job `palette_query(id, query, roots, limit)` – streamt Treffer gebündelt, bricht die vorige
   Anfrage ab (je Tastendruck eine neue Id), harte Grenzen (Treffer, Zeit, Tiefe), keine Symlink-Zyklen, keine
   Server-/Archivpfade ohne ausdrückliche Wahl. Blockierendes I/O nie auf dem Runtime-Thread (CLAUDE.md §4).
4. **Treffer-Aktionen** (Untermenü am Treffer: `→` oder `Tab`, plus Direktkürzel in der Palette):
   - **Öffnen** (Enter, wie im Panel inkl. Rückfrage bei Programmen) · **Vorschau** (Leertaste/F3, Schnellvorschau
     in der anderen Seite) · **Zum Speicherort springen** (aktive Seite öffnet den Ordner, Cursor auf der Datei)
   - **In den anderen Dateibereich kopieren** / **Verschieben** (öffnet den normalen F5/F6-Dialog mit dem Treffer als
     Quelle und der anderen Seite als Ziel – keine Abkürzung an der Prüfung vorbei) · **Umbenennen** (Dialog)
   - **Ähnliche Dateien finden** (042, sonst gleicher Name/Größe über die Duplikatsuche) · **Übergeordneten Ordner
     analysieren** (Speicherbelegung 033 für den Elternordner)
   - Mehrfachauswahl in der Palette (Einfg/Leertaste mit Modifier) → Aktion für alle; „Alle Treffer als Ergebnis-Tab“.
   - Alle Treffer-Aktionen sind normale Aktionen im Katalog (CLAUDE.md §4), ihre Kürzel in den Keymaps.
5. **Oberfläche:** Gruppen „Aktionen“, „Ordner“, „Dateien“ (Kopfzeilen, Zahl, „mehr …“), Pfad gekürzt mit vollem Pfad
   im Tooltip, Icon über `FileIconService`, Ladeanzeige ohne Springen der Liste, **virtualisierte Liste** (nur sichtbare
   Zeilen im DOM), Speicher je Anfrage begrenzt. Barrierefreiheit: Live-Region „N Treffer“, `aria-activedescendant`.
6. **Einstellungen:** Suchwurzeln, Ausschlüsse, Index an/aus und Größe, System-Suche nutzen; Texte en/de.
7. **Datenschutz/Sicherheit:** keine Dateiinhalte, Index nur Namen/Pfade/Größe/Datum, im App-Ordner, löschbar; keine
   Pfade in Logs.

## Akzeptanzkriterien

- `invoice 2025` findet `~/Docs/2025/Invoice-0815.pdf` und `~/Downloads/invoice_2025_03.pdf`; erste Treffer erscheinen
  < 100 ms nach dem Tippen (aus Index oder bekannten Orten), weitere strömen nach; jede Taste bricht die alte Suche ab.
- Am Treffer: Enter öffnet, Leertaste zeigt Vorschau, „Zum Speicherort“ setzt den Cursor auf die Datei, „Kopieren in die
  andere Seite“ öffnet den F5-Dialog mit richtigem Ziel, „Ordner analysieren“ öffnet die Speicherbelegung.
- Aktionen bleiben wie bisher auffindbar (`>`-Präfix zeigt nur Aktionen); F10 bleibt „nur Aktionen“.
- 1 Mio. Dateien unter den Wurzeln: Tippen bleibt flüssig, RAM bleibt unter der eingestellten Grenze, Esc schließt sofort.
- Server- und Archivpfade erscheinen nur, wenn sie ausdrücklich als Wurzel gewählt sind.

## Tests

- Rust: Abfrage-Parser, Rangfolge, Index (Aufbau, Watcher-Updates, Grenzen, Ausschlüsse, Zyklen), Abbruch je Anfrage,
  Messung (`#[ignore]`-Benchmark) für Zeit bis erster Treffer.
- Frontend: Abfrage-Sprache als Tabellen-Katalog, Gruppen/Rangfolge, Treffer-Aktionen mit Fakes (Navigieren, Dialoge
  mit Quelle/Ziel), veraltete Antworten verworfen, Virtualisierung (nur sichtbare Zeilen), Tastatur und ARIA.
- E2E unter Xvfb mit erzeugtem großem Baum; light/dark ansehen.
