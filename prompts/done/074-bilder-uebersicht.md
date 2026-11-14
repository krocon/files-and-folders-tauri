# Prompt 074: Bilder-Übersicht – Kacheln statt zwei Panels, schnell hinein und wieder heraus

> **Slug:** `bilder-uebersicht` · **Braucht:** 002 (Aktionen), 004 (Workspace, Sitzung), 010 (Bild-Vorschau, Schema
> `fnfpreview`), 015 (Einstellungen, i18n), 022 (Vollbild `TOGGLE_FULLSCREEN`), 038 (flache Ansicht, `relDir`), 042
> (Thumbnails `duplicates/thumbs.rs`, Decoder mit Grenzen `duplicates/images.rs`), 045 (`collect_files`), 057
> (Dialog-Tasten) · **Umfang:** M–L
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/042-dubletten-inhalt.design.md` (E6.5 Thumbnails, Grenzen, Semaphor),
> `prompts/done/038-flache-ansicht.design.md` (rekursive Sammlung, Auffrischen) und `prompts/done/010-vorschau-eigenschaften.design.md` (Bildansicht,
> `fnfpreview`-Token). Vorlage: [074-bilder-uebersicht-beispiel.png](074-bilder-uebersicht-beispiel.png) (ACDSee
> „Durchsuchen“: Ordnerbaum links, Kachelraster, Größen-Slider unten rechts, Statuszeile mit Abmessungen).
> Auftrag von Marc (14.11.2026, Entwurf als „072-image-kacheln“).

## Ziel

**Bilder in einem Ordner leicht wiederfinden.** Auf Knopfdruck schaltet das Fenster von den zwei Panels in eine
**Bilder-Übersicht**: links ein kleiner Ordnerbaum (ein-/ausblendbar), rechts ein Raster aus Vorschaubildern, deren
Größe man per Slider oder −/+ stufenlos ändert. Doppelklick (oder Enter) zeigt ein Bild groß – im Fenster oder auf
dem ganzen Bildschirm (umschaltbar). Auf Wunsch zeigt die Übersicht **alle Bilder rekursiv** aus den Unterordnern.

Leitsatz: **Die Übersicht ist ein Blick, kein zweites Programm.** Hinein mit einer Taste, heraus mit derselben Taste
oder Esc – die Panels stehen danach exakt so da wie vorher (Tabs, Cursor, Markierung, Scrollposition), nur der
Cursor des aktiven Panels darf auf das zuletzt gewählte Bild springen.

## Aufgaben

1. **Bestand prüfen** (Tabelle „Baustein → wofür → passt / fehlt / erweitern“), mindestens:
   - `src-tauri/src/duplicates/thumbs.rs`: JPEG im Speicher, Token `t…` über `fnfpreview`, `MAX_PX = 256`,
     `MAX_THUMBS = 256`, `MAX_THUMB_BYTES = 32 MiB`, `MAX_PATHS = 24` je Aufruf. Für Kacheln bis ~512 px und Ordner mit
     2 000+ Bildern reicht das nicht: eigener Cache (oder Parameter) mit eigenen Grenzen, Größenstufen statt jeder
     Pixelzahl (z. B. 128/256/512 – die Anzeige skaliert dazwischen per CSS), Abbruch veralteter Anfragen beim Scrollen
     und Ordnerwechsel.
   - `duplicates/images.rs`: `IMAGE_EXT` (jpg, png, gif, webp, bmp, tif …), `UNSUPPORTED_EXT` (heic/heif/avif),
     Grenzen `MAX_BYTES`/`MAX_PIXELS`/`MAX_ALLOC`, `MAX_DECODES = 4` (Semaphor). Thumbnails eventuell in ein gemeinsames
     Modul (`images/`) heben, statt aus `duplicates` zu importieren – im Design entscheiden.
   - **RAW** (`.NEF`, `.CR2`, `.ARW`, `.DNG` …, siehe Vorlage): meist steckt ein eingebettetes JPEG drin. Prüfen, ob
     sich das ohne neue schwere Abhängigkeit sicher herausholen lässt (TIFF-/EXIF-Struktur, fail-closed wie bei
     Archiven); sonst Platzhalter-Kachel mit Datei-Icon und Name. **EXIF-Orientierung** beachten (Hochformat-Fotos).
   - Bildansicht F3 (`features/preview/viewer.store.ts`, `views/`), Schnellvorschau, `MAX_IMAGE_BYTES = 64 MiB`.
   - Flache Ansicht 038 / `collect_files` 045 für „rekursiv“ (Grenzen, keine Links, kein fremdes FS, Abbruch).
   - `WorkspaceStore`/`workspace.html` (wo die Übersicht die Panels ersetzt), `TOGGLE_FULLSCREEN` (022), Sitzung (004).
2. **Umschalten:** Aktion `TOGGLE_IMAGE_OVERVIEW` (Vorschlag `Mod+Shift+I`, in allen drei Keymaps frei – prüfen),
   Eintrag im Menü „Ansicht“, Button in der Button-Leiste (optional, `buttons.json`), Befehlspalette. Start im Ordner
   des aktiven Panels, Cursor auf dessen aktueller Datei (falls Bild). **Zurück:** dieselbe Taste, Esc (wenn keine
   Großansicht offen), sichtbarer Knopf „Zurück zu den Panels“ im Kopf. Entscheidung im Design: Fenstermodus des
   Workspace (Panels bleiben im DOM verborgen, Zustand unangetastet) **oder** eigener Tab-Typ wie `usage:<scanId>`
   (033/047) – Empfehlung mit Begründung. Ob die Übersicht über einen Neustart erhalten bleibt: Sitzung, Default nein.
3. **Aufbau** (ASCII-Skizze mit Fokus-Reihenfolge und ARIA-Rollen im Design):
   - **Kopf:** Pfadleiste (wiederverwenden), Schalter „Unterordner einbeziehen“, Sortierung (Name, Datum,
     Größe, Typ), Filterfeld (Name enthält …), Zurück-Knopf.
   - **Links Baum** (ein-/ausblendbar, Breite per Splitter, Zustand gemerkt): zeigt **nur den aktuellen Ordner und
     seine Unterordner** (lazy aufklappen, Eltern über die Pfadleiste). Klick/Enter wechselt den Ordner der Übersicht.
     APG-Tree (`role="tree"`).
   - **Mitte Kachelraster:** virtuell (nur sichtbare Zeilen im DOM, Vorlauf ±1 Bildschirm), Kachel = Bild + Name
     (gekürzt, Tooltip voll), Markierung und Cursor sichtbar wie in der Liste (Tokens, light/dark, alle Farbschemata).
     Ordner erscheinen nicht als Kacheln (dafür ist der Baum da) – oder doch als erste Kacheln: im Design entscheiden.
     Nicht-Bilder: ausblenden (Default) oder als Icon-Kachel (`FileIconService`), umschaltbar.
   - **Unten:** Größen-Slider mit −/+ (wie in der Vorlage), Statuszeile: Anzahl Bilder (gesamt/markiert, Summe Größe),
     zur Cursor-Kachel Name, Größe, Abmessungen, Änderungsdatum (Aufnahmedatum aus EXIF nur, wenn billig).
   - Ein Vorschaufeld links unten wie in der Vorlage ist **nicht** Teil des Auftrags (die Großansicht leistet das).
4. **Kachelgröße:** stufenlos per Slider, −/+, `Mod+=`/`Mod+-` und `Mod`+Mausrad im Raster; Wert in den
   Einstellungen (`imageOverview.tileSize`) gemerkt. Spaltenzahl folgt der Fensterbreite; der Cursor bleibt beim
   Ändern auf demselben Bild und im Sichtbereich.
5. **Rekursiv:** Schalter „Unterordner einbeziehen“ sammelt alle Bilder unterhalb (Rust, gestreamt als Job oder
   über `collect_files` mit Grenzen und Abbruch). Anzeige wahlweise flach (Kachel zeigt `relDir` im Tooltip) oder mit
   **Abschnittsköpfen je Ordner** – Empfehlung im Design. Obergrenze sichtbar melden („erste 20 000 Bilder“).
6. **Großansicht** (Doppelklick, Enter): Bild in voller Auflösung über `fnfpreview` (Grenzen wie F3), eingepasst, mit
   Zoom 100 %/Einpassen, ←/→ bzw. Bild↑/↓ = vorheriges/nächstes Bild der aktuellen Sortierung, Pos1/Ende, Esc zurück
   zur Kachel (Cursor folgt dem zuletzt gezeigten Bild). **Umschaltbar** (Taste `F`, Knopf, Einstellung merkt den
   letzten Modus): *im Fenster* (Overlay über der App) oder *ganzer Bildschirm* (über `TOGGLE_FULLSCREEN`/022, beim
   Schließen wieder zurück, falls vorher nicht Vollbild). Nächste Bilder vorladen (1–2), dunkler Hintergrund aus Tokens.
7. **Mit Dateien arbeiten** (Pflicht = **fett**): **Markieren** (Leertaste/Einfg, Shift+Pfeil, Klick mit Mod/Shift),
   **„Im Panel zeigen“** (zurück und Cursor setzen), **Löschen in den Papierkorb (F8)** über den normalen Dialog,
   **Kopieren/Verschieben (F5/F6)** mit dem inaktiven Panel als Ziel über den normalen Dialog, Umbenennen (F2, Dialog),
   Kontextmenü (Teilmenge des Datei-Kontextmenüs, `menu-model.ts`), Ziehen ins System (028). Alles über das
   Aktionssystem; Aktionen, die in der Übersicht keinen Sinn ergeben, per Veto aus (Muster: Archiv-/Belegungs-Tab).
   Nach Jobs frischt die Übersicht auf (Watcher wie die Panels, 012/029 – `background`, kein Overlay).
8. **Tastatur und Barrierefreiheit:** Raster als `role="grid"` (APG), Pfeile in zwei Richtungen, Pos1/Ende,
   Bild↑/↓, Tippen springt zum ersten passenden Namen (wie in der Liste), Tab wechselt Baum ↔ Raster ↔ Fußleiste,
   sichtbarer Fokus, Live-Region für „n Bilder, m markiert“. Kein eigener `keydown` für Funktionen außerhalb der
   Widget-Ausnahmen (CLAUDE.md §4).
9. **Langsame Laufwerke / Server** (029/030/034): Übersicht auf Netzlaufwerken erlaubt, Thumbnails dort gedrosselt
   (weniger parallel), nie das Fenster blockieren; auf `remote://…` und in Archiven im ersten Schritt aus (Hinweis),
   Ausbau als Folge-Prompt.
10. **Abgrenzung zu 041** (Punkt 5 „Miniaturansicht“ in der Dateiliste): Die Kachel-Komponente und der Thumbnail-Dienst
    hier sollen dort wiederverwendbar sein. Im Design festhalten, ob 041 Punkt 5 damit entfällt oder darauf aufbaut,
    und `prompts/041-spalten-ansichten.md` entsprechend anpassen.

## Entscheidungsfragen (im Design beantworten)

- Fenstermodus vs. Tab-Typ (Aufgabe 2); Übersicht im Sitzungszustand?
- Gemeinsames Thumbnail-Modul vs. Erweiterung von `duplicates/thumbs.rs`; Größenstufen; Cache-Grenzen (Anzahl, MiB);
  Platten-Cache im App-Cache-Ordner ja/nein (Empfehlung erst nach Messung mit 2 000 Bildern auf SSD und SMB).
- RAW über eingebettetes JPEG: ja/nein, mit welcher (ggf. eigener, kleiner) Logik; HEIC über OS-Mittel (macOS
  ImageIO/`sips`) oder weiter „nicht unterstützt“.
- Rekursiv flach vs. Abschnittsköpfe; Ordner als Kacheln ja/nein; Nicht-Bilder ausblenden vs. Icon-Kachel.
- Eigene virtuelle Kachelliste vs. GuiExpert Table (kann die Table ein Raster mit variabler Spaltenzahl? Mono-Repo
  prüfen, CLAUDE.md §5 – fehlt es, Vorschlag in `mono/TODO.md`, hier schlank selbst bauen).

## Akzeptanzkriterien

- Im Panel `Mod+Shift+I` → Übersicht des Ordners, Cursor auf dem Bild unter dem Panel-Cursor; nochmal `Mod+Shift+I`
  oder Esc → beide Panels unverändert (Tabs, Cursor, Markierung, Scrollposition).
- Ordner mit 2 000 Bildern (JPEG/PNG/WebP gemischt, einige kaputt, eines 12 000 × 8 000 px, Hochformat mit EXIF-Drehung):
  erste Kacheln < 1 s sichtbar, Scrollen flüssig, kaputte Bilder als Platzhalter, nichts friert ein; Ordnerwechsel
  während des Ladens bricht alte Anfragen ab.
- Slider/−/+/`Mod`+Mausrad ändern die Kachelgröße stufenlos; Größe bleibt nach Neustart.
- Baum ein-/ausblenden; Klick auf Unterordner wechselt die Übersicht; Baum zeigt nur aktuellen Ordner + Unterordner.
- „Unterordner einbeziehen“ zeigt alle Bilder darunter, Abbruch beim Ausschalten, Grenze wird gemeldet.
- Doppelklick → Großansicht; `F` schaltet Fenster ↔ ganzer Bildschirm; ←/→ blättert; Esc → zurück, Cursor auf dem
  zuletzt gezeigten Bild; der Vollbildzustand des Fensters ist danach wie vorher.
- Markieren, F8 (Papierkorb), F5/F6 ins inaktive Panel, „Im Panel zeigen“ funktionieren; nach dem Löschen verschwindet
  die Kachel ohne Neuladen-Flackern.
- Komplett per Tastatur bedienbar; light/dark und mindestens Norton, True Black, Solarized Light angesehen.
- Testordner mit Umlauten, Leerzeichen, Emoji im Namen, Symlink auf Bild/Ordner, nicht lesbarem Unterordner.

## Tests

- **Rust:** Thumbnail-Erzeugung (Größenstufen, EXIF-Orientierung, kaputte/zu große Bilder, Grenzen des Caches,
  Abbruch), ggf. RAW-Vorschau (Testdateien klein generieren, fail-closed bei kaputter Struktur), rekursive Sammlung
  (Grenzen, Symlink-Zyklen, kein fremdes FS, nicht lesbarer Ordner).
- **Frontend:** Raster-Logik rein (Spaltenzahl, Fenster der virtuellen Liste, Cursorbewegung 2-D, Größe ändern ohne
  Cursorverlust), Store (Ein-/Ausschalten ohne Verlust des Panel-Zustands, veraltete Thumbnail-Antworten verwerfen,
  Rekursiv an/aus), Großansicht (Blättern, Modus merken), Aktionen/Veto, Texte en/de (`catalogs.spec.ts`).
- **E2E:** echte App (`pnpm tauri dev` bzw. Xvfb), Ordner mit 2 000 Bildern (Generator-Skript, nicht einchecken),
  Messung Zeit bis erste Kacheln und Speicher; Screenshot-Szene für `pnpm screenshots` ergänzen.

## Nicht im Umfang

Bildbearbeitung, Drehen/Speichern, Bewertungen/Tags/Stichwörter, Diashow mit Übergängen, Video-Thumbnails, ein
Vorschaufeld neben dem Baum, Übersicht auf Servern und in Archiven (Folge-Prompt), Gesichter/KI-Suche.
