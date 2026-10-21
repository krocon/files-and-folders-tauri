# Prompt 042: Dubletten finden – nach Inhalt, ähnliche Bilder, Regeln zum Behalten

> **Slug:** `dubletten-inhalt` · **Braucht:** 016 (Job `duplicates`, Ergebnis-Tab mit Gruppen, „Keep newest/oldest/
> first“), 009 (Ergebnis-Tabs, Suchkriterien), 010 (Bild-Vorschau, Schema `fnfpreview`), 025 (Archive lesen: Comics
> `.cbz`/`.cbr`/`.cb7`), 006 (Löschen in den Papierkorb), 033 (Sammelkorb als Muster) · **Umfang:** L
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/016-archive-duplikate.design.md` **E6** (Kriterien,
> Hash-Stufen, Ergebnis-Tab) und `prompts/done/009-suche.design.md` (Ergebnis-Tabs). Auftrag von Marc (21.10.2026).

## Auftrag (wörtlich)

> Dubletten finden – anhand des Inhalts
>
> Nicht nur gleiche Dateinamen erkennen, sondern Dateien per Hash vergleichen. So findet man auch Kopien mit
> unterschiedlichen Namen. Ähnliche Bilder (oder comics) könnten optional über Bildähnlichkeit erkannt werden.
>
> Wichtig: Erst die Gruppen anzeigen und den Nutzer entscheiden lassen, welche Kopien gelöscht werden. Das entscheiden
> lassen kann Regelbasiert sein: z.B. das älteste File, das File mit dem kürzeren Namen, das File dessen Pfad ein
> bestimmtes Pattern (regex) hat, usw.

## Bestand (zuerst prüfen, nicht neu bauen)

- **016 E6** findet schon Inhalts-Dubletten: Größe → SHA-256 von Kopf/Ende → SHA-256 vollständig (`duplicates.rs`, Job
  `duplicates`), optional zusätzlich gleicher Name; Ergebnis als Ergebnis-Tab mit Spalte „Group“ (`SearchResult.kind
  = 'duplicates'`), Helfer `DUP_MARK_KEEP_NEWEST/OLDEST/FIRST` (`duplicates-logic.ts`: je Gruppe bleibt genau eine
  Datei unmarkiert). Gelöscht wird mit dem normalen F8 (Papierkorb).
- **Neu** sind also: (a) eine **Regel-Engine** fürs Behalten statt drei fester Knöpfe, (b) eine klare
  **Entscheidungs- und Bestätigungsphase** vor dem Löschen, (c) **ähnliche Bilder** (und Comics) als optionaler
  zweiter Modus, (d) Hardlinks/gleiche Datei sauber behandeln.

## Aufgaben

1. **Phase 1 – Bestandsaufnahme und Design 🛑** (Freigabe abwarten): was 016 schon kann, was fehlt; Entscheidungen
   unten mit Empfehlung.
2. **Exakte Dubletten (Ausbau 016):**
   - Inhaltsvergleich bleibt Default; der Name ist **kein** Kriterium mehr, außer der Nutzer wählt es.
   - Hardlinks (gleiches Gerät + Inode bzw. Windows-File-ID, `platform::entry_id`) sind **keine** Kopien: zusammenfassen
     und als „gleiche Datei“ kennzeichnen, nie zum Löschen vorschlagen. Symlinks werden nicht verfolgt.
   - Optional byteweiser Endvergleich innerhalb einer Hash-Gruppe (Einstellung „paranoid“), sonst SHA-256 voll.
   - Wiederverwendbarer Hash-Cache je Sitzung (Pfad + Größe + mtime → Hash), damit ein zweiter Lauf schnell ist.
3. **Regel-Engine „Welche Datei bleibt?“** (rein, `duplicates-rules.ts`, Testkatalog `.cases.json` wie 007/008):
   - Regeln mit Reihenfolge (die erste entscheidet, weitere brechen Gleichstände): **älteste / neueste** (mtime),
     **kürzester / längster Name**, **kürzester / längster Pfad**, **Pfad passt auf Muster** (Glob oder Regex; „bevorzugt
     behalten“ oder „bevorzugt löschen“, z. B. `/Downloads/` löschen, `/Archiv/` behalten), **liegt in Ordner X**
     (Ordnerwahl über Ordnermenü/Seite), **Name ohne Kopie-Suffix** (`Kopie`, `copy`, `(1)`, `- Copy` …),
     **höhere Auflösung / größere Datei** (für ähnliche Bilder), **zuerst gefunden**.
   - Ergebnis je Gruppe: genau eine Datei „behalten“, Rest „löschen“ – oder „unentschieden“, wenn keine Regel trennt
     (dann nichts markieren und die Gruppe kennzeichnen). **Nie** eine ganze Gruppe zum Löschen markieren.
   - Regelsätze als Vorlagen speichern (Muster `rename-presets.json`/Suchvorlagen), zuletzt benutzter Satz bleibt.
4. **Entscheidungsansicht:** Ergebnis-Tab bleibt die Liste (Gruppen farbig abgesetzt, Spalten Gruppe, Behalten/Löschen,
   Grund = welche Regel entschied). Daneben (andere Seite, wie 033) Vorschau der Gruppe: Bilder als Kacheln über
   `fnfpreview`, sonst Name/Pfad/Größe/Datum. Pro Zeile umschalten (Leertaste), pro Gruppe „diese behalten“
   (Enter/Doppelklick). Summen: Gruppen, zu löschende Dateien, frei werdender Platz.
5. **Löschen erst nach Bestätigung:** eigene Aktion „Markierte Dubletten löschen…“ mit Zusammenfassung; Standard
   Papierkorb; Job prüft **vor jedem Löschen** erneut, dass die behaltene Datei der Gruppe noch existiert und gleich ist
   (Größe/mtime, bei Inhalt den Hash) – sonst die Gruppe überspringen (`expected` wie 030/033). Alternativ
   „in Ordner verschieben“ und „durch Hardlink/Symlink ersetzen“ (nur wenn das Design es sicher hinbekommt; sonst ⬜).
6. **Ähnliche Bilder (optional, eigener Modus):**
   - Wahrnehmungs-Hash (dHash/pHash, z. B. Crate `image_hasher` oder eigener dHash über `image` – Abhängigkeit in
     `docs/architecture.md` begründen), Schwelle (Hamming-Abstand) als Regler „streng … locker“.
   - Formate: JPEG, PNG, GIF, WebP, BMP, TIFF, HEIC nur wenn ohne Systembibliothek machbar (sonst ausweisen); Bilder
     herunterskaliert dekodieren, Grenzen für Pixel/Bytes (Bomben!), kaputte Bilder melden statt abstürzen.
   - **Comics** (`.cbz`/`.cbr`/`.cb7`, über die Archiv-Lesung aus 025): Fingerabdruck aus Titelbild + einigen Seiten
     und Seitenzahl; feindliche Archive wie in 025 (fail-closed, Grenzen vor der Allokation).
   - Gruppierung über Abstand ist nicht transitiv: Verfahren im Design festlegen (z. B. BK-Baum + Verbund mit
     Mindestähnlichkeit zum Gruppenzentrum), Laufzeit für 50 000 Bilder messen.
   - Ähnliche Gruppen nie automatisch löschen-markieren ohne sichtbare Vorschau (Regel-Engine darf vorschlagen, die
     Bestätigung zeigt die Bilder).
7. **Dialog** (`OPEN_FIND_DUPLICATES_DLG` erweitert): Modus „Exakt (Inhalt)“ / „Ähnliche Bilder“ / „Comics“, Wurzeln,
   Filter (Glob, Mindestgröße, versteckte), Regelsatz, Vorlagen. Texte en/de, Aktionen im Katalog, Kürzel in den Keymaps.

## Entscheidungsfragen fürs Design

- Ergebnis im bestehenden Ergebnis-Tab (016) erweitern oder eigener Tab-Typ wie „Belegung“ (033)?
- Regeln: nur Frontend (reine Engine auf den Treffern) oder Teile in Rust (z. B. Auflösung der Bilder lesen)?
- Hash-Cache nur im Speicher oder als Datei (Größe, Datenschutz, Invalidierung)?
- Ersetzen durch Hardlinks: anbieten oder bewusst ✖ (Risiko: spätere Änderung einer „Kopie“ ändert alle)?

## Akzeptanzkriterien

- Ordner mit `a.jpg`, `Kopie von a.jpg`, `sub/x.bin` (gleicher Inhalt wie `a.jpg`), `b.txt` (gleiche Größe, anderer
  Inhalt) → eine Gruppe mit drei Dateien, `b.txt` nicht dabei.
- Hardlink auf `a.jpg` erscheint als „gleiche Datei“, wird nie zum Löschen vorgeschlagen.
- Regelsatz „Pfad passt auf `/Downloads/` → löschen; sonst älteste behalten“ markiert erwartungsgemäß; eine Gruppe, in
  der keine Regel trennt, bleibt unmarkiert und ist gekennzeichnet.
- Löschen zeigt erst die Zusammenfassung (Anzahl, Platz), dann Papierkorb; eine zwischendurch geänderte behaltene Datei
  verhindert das Löschen ihrer Gruppe.
- Ähnliche Bilder: dasselbe Foto als JPEG in zwei Qualitäten und verkleinert landet in einer Gruppe; ein anderes Foto
  nicht. Ein kaputtes/riesiges Bild bricht den Lauf nicht ab.
- Comics: dieselbe `.cbz` neu gepackt (andere Bytes, gleiche Seiten) wird als ähnlich erkannt.
- Abbruch mit Esc in jeder Phase; 100 000 Dateien bleiben bedienbar.

## Tests

- Rust: Hash-Stufen, Hardlinks/Symlinks, Cache-Invalidierung, Wahrnehmungs-Hash (Testbilder generiert: skaliert,
  rekomprimiert, gespiegelt = **nicht** gleich, sofern nicht gewollt), Grenzen bei feindlichen Bildern/Comics,
  erneute Prüfung vor dem Löschen, Abbruch.
- Frontend: Regel-Engine als Tabellen-Katalog (alle Regeln, Gleichstände, Regex-Fehler, nie ganze Gruppe), Umschalten
  per Tastatur, Summen, Bestätigungsdialog (Fakes).
- E2E unter Xvfb mit erzeugten Testbildern. Externes Review (Schwerpunkt: Datenverlust, feindliche Dateien).
