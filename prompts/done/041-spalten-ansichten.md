# Prompt 041: Spaltenauswahl und Ansichtsmodi

> **Slug:** `spalten-ansichten` · **Braucht:** 001 (Dateiliste, `TableBridge`), 015 (Einstellungen), 010
> (Bild-Vorschau, Schema `fnfpreview`) · **Umfang:** M–L
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/001-guiexpert-dateiliste.design.md` (G1–G14) und
> `prompts/done/015-einstellungen-i18n.design.md` §9 („Spaltenauswahl … offen“). **Vor jeder API-Aussage zur Table**
> das Mono-Repo lesen (CLAUDE.md §5) – Lücken dort lösen oder in `mono/TODO.md` vorschlagen.

## Ziel

Spalten der Dateiliste sind frei wählbar (ein-/ausblenden, Reihenfolge, Breite bleibt), je Tab oder global
(Entscheidung im Design). Dazu kommen – soweit die GuiExpert Table es sauber trägt – eine **Kurzansicht**
(nur Icon + Name, mehrspaltig) und eine **Miniaturansicht** für Bildordner.

## Aufgaben

1. **Bestand prüfen:** welche Spalten gibt es (`file-columns.ts`), was liefert Rust schon (`model.rs`: Größe,
   Änderungsdatum, …), was wäre billig (Erstellt, Zugriff, Rechte, Eigentümer, Endung, Typ, Link-Ziel)? Neue Felder
   nur, wenn das Listing dadurch nicht langsamer wird (SMB, 030) – sonst nachladen oder weglassen.
2. **Spaltenauswahl:** Kontextmenü auf dem Spaltenkopf + Einstellungsseite; Reihenfolge per Tastatur änderbar;
   Spaltenbreiten bleiben beim Verzeichniswechsel (kein Neuaufbau, CLAUDE.md §5) und über Neustart (Sitzung).
3. **Breite „Modified“**: Bug aus `TODO.md` §4 – das US-Format wird abgeschnitten. Breite aus dem tatsächlichen
   Datumsformat der Sprache messen oder Mindestbreite je Locale; roter Test zuerst.
4. **Kurzansicht** (TC „Kurz“): mehrere Namensspalten nebeneinander. Prüfen, ob die Table das kann (Zeilen-Umbruch
   in Spalten); wenn nicht, Lücke im Mono-Repo vorschlagen und hier nicht nachbauen.
5. **Miniaturansicht**: Kacheln mit Vorschaubild über `fnfpreview` (010), Thumbnails in Rust erzeugt und begrenzt
   gecacht (Crate `image` ist ggf. schon da), nur sichtbare Kacheln laden, abbrechbar. Wenn die Table keine
   Kachelansicht trägt: eigene, schlanke virtuelle Kachelliste mit derselben Cursor/Markier-Logik – im Design
   abwägen, ob sich das lohnt.
6. Aktionen `OPEN_COLUMNS_DLG`, `VIEW_MODE_FULL/BRIEF/THUMBNAILS` (TC: Strg+F1/F2, Strg+Shift+F1), Menü Ansicht.

## Akzeptanzkriterien

- Spalte „Erstellt“ einblenden, „Größe“ ausblenden, Reihenfolge ändern → bleibt beim Ordnerwechsel und nach Neustart.
- Englisch (US) eingestellt → Datum vollständig lesbar.
- Bildordner mit 2 000 Bildern → Miniaturen erscheinen beim Scrollen, Liste bleibt flüssig, Cursor/Markierung/F5
  funktionieren wie in der Detailansicht.
- Tastaturbedienung in allen Ansichten (Pfeile, Pos1/Ende, Leertaste, Einfg).

## Tests

- Frontend: Spaltenmodell (rein), Persistenz, Breitenmessung, Ansichtswechsel ohne Verlust von Cursor/Markierung.
- Rust: Thumbnail-Erzeugung (Größen, kaputte Bilder, Grenzen), neue Listing-Felder.
- E2E unter Xvfb; Performance-Messung mit großem Ordner.
