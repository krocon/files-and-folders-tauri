# Prompt 045: Serien nach Staffeln gruppieren

> **Slug:** `serien-gruppieren` · **Braucht:** 005 (Jobs), 006 (Kopieren/Verschieben), 008 (Gruppieren: Job `group`,
> Clean Folders, Vorschau-Table), 009/038 (rekursives Aufzählen), 022 (Dateitypen), 027 (letzte Dialogeingaben)
> · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/008-gruppieren-leere-ordner.design.md` (E1–E3, E5,
> Verträge) und den Abschnitt „Verträge“ von `prompts/done/038-flache-ansicht.design.md`. Beispiel aus Marcs
> Filmordner: [`045-serien-gruppieren-beispiel.txt`](045-serien-gruppieren-beispiel.txt).

## Ziel

Ein neuer Dialog (Aktion) räumt einen **Serienordner** auf: Alle Videodateien im aktuellen Ordner **und in seinen
Unterordnern** werden nach Staffel in Unterordner `S01`, `S02`, … des aktuellen Ordners **kopiert** (Default) oder
verschoben. Release-Beiwerk wie `Sample/`, `*-sample.mkv` und `*.nfo` wird ignoriert. Der Dateiname bleibt
unverändert.

Beispiel (Marc, 29.10.2026), aktueller Ordner = `…/Die Kirche bleibt im Dorf`:

```
Die.Kirche.bleibt.im.Dorf.S01E01.German.1080p.WEB.h264-DMPD/die.kirche.bleibt.im.dorf.s01e01.german.1080p.web.h264-dmpd.mkv
  → S01/die.kirche.bleibt.im.dorf.s01e01.german.1080p.web.h264-dmpd.mkv
Die.Kirche.bleibt.im.Dorf.S01E01.German.1080p.WEB.h264-DMPD/die.kirche.bleibt.im.dorf.s01e01.german.1080p.web.h264-dmpd.nfo
  → ignoriert (Endung .nfo)
Die.Kirche.bleibt.im.Dorf.S01E01.German.1080p.WEB.h264-DMPD/Sample/die.kirche.bleibt.im.dorf.s01e01.german.1080p.web.h264-dmpd-sample.mkv
  → ignoriert (Ordner Sample, Name *-sample)
```

Die vollständige Liste (90 Dateien, 30 Folgen in 4 Staffeln: S01 = 12, S02–S04 = je 6) liegt in der Beispieldatei
und wird zum Testfall (s. „Tests“).

## Abgrenzung zum vorhandenen Gruppieren (008)

Gruppieren (008) arbeitet auf den Einträgen **eines** Ordners und kennt keine Staffel-Erkennung (mr `ebook_mode`
steht dort unter „Offen“). Hier kommen hinzu: rekursives Einsammeln, Filter für Videos/Beiwerk, Erkennung von
Staffel/Folge im Namen, Dubletten-Erkennung je Folge und optional das Aufräumen der leeren Release-Ordner. Die
**Ausführung** soll die Job-Art `group` aus 008 E2 wiederverwenden (`{ path, group }`-Paare + Wurzel, Gruppenordner
legt der Job an, Konflikte/Abbruch/Pause aus 005) – im Design prüfen, ob sie für Quellen aus Unterordnern ohne
Änderung trägt (Gefahrenprüfung, „schon am Ziel“, Ziel liegt in der Quelle) oder was fehlt.

## Aufgaben

1. **Bestand prüfen** (Phase 1, Design `045-serien-gruppieren.design.md`): `JobSpec::Group` und `copy::run_pairs`,
   `group-engine.ts`, `GroupFilesStore`/Dialog, Clean (`clean.rs`, `JobSpec::Clean`), Vorschau-Table
   (`shared/preview-grid/`), Video-Endungen in `core/file-icon/file-types.json`, rekursives Aufzählen (Suche 009 /
   flache Ansicht 038 – oder ein schmaler neuer Command, s. 2.).
2. **Einsammeln (Rust):** rekursiv ab dem aktuellen Ordner (bzw. den markierten Ordnern), **keinen Symlinks folgen,
   kein fremdes Dateisystem**, Tiefe und Anzahl begrenzt (`truncated` melden), unlesbare Ordner melden. Vorhandene
   Staffelordner (`S01` …) des Zielordners werden mitgelesen, damit „schon am Ziel“ erkannt wird. Abwägen:
   vorhandene Suche (Job `search`, Kriterien „Endung“) wiederverwenden vs. eigener Command `scan_series(root,
   options)` mit `spawn_blocking` – Empfehlung im Design. Serverpfade (`remote://`) und Archive: erst einmal
   ablehnen (Aktion gesperrt), im Design begründen.
3. **Filter:**
   - Videos: Endungen aus der Dateityp-Kategorie „Video“ (022) plus fehlende gängige (`.m4v`, `.ts`, `.m2ts`,
     `.mpg`, `.mpeg`, `.divx`, `.ogm`) – Liste im Dialog sichtbar und editierbar.
   - Beiwerk ignorieren (Default an, Liste editierbar, Vergleich ohne Groß/klein): Ordner `Sample`, `Samples`,
     `Proof`; Namen mit `sample` als eigenem Token (`-sample.`, `.sample.`,
     `sample-`); Endungen `.nfo`, `.sfv`, `.txt`, `.url`, `.jpg`, `.png`, `.srr`, `.md5`. Optional: Dateien unter
     einer Mindestgröße ignorieren (Default aus).
   - Option „Untertitel mitnehmen“ (`.srt`, `.sub`, `.idx`, `.ass`, `.ssa`, `.vtt`; Default aus): gleiche Staffel wie
     das Video, Erkennung über den eigenen Namen.
4. **Erkennung (rein, TypeScript, `features/seriesgroup/series-engine.ts`)** – wie 007/008 E1: Vorschau ohne IPC,
   Rust prüft und führt aus. Je Datei Staffel + Folge(n) aus dem **Dateinamen**, ersatzweise aus dem Namen des
   Elternordners (Release-Ordner), sonst „nicht erkannt“ (Zeile wird nicht ausgeführt). Muster (Unicode, Groß/klein
   egal, Token-Grenzen beachten, damit z. B. `x264`/`h264`/`1080p` nicht als Folge zählen):
   - `S01E01`, `s1e1`, `S01.E01`, `S01_E01`, `S01 E01`, Doppelfolgen `S01E01E02` / `S01E01-E02`;
   - `1x01`;
   - deutsch/englisch ausgeschrieben: `Staffel 1 Folge 2`, `Season 1 Episode 2` (im Design entscheiden, ob nötig);
   - Spezialfolgen `S00E…` → Ordner `S00` (Annahme, im Design bestätigen).
   Mehrere Treffer in einem Namen: der erste gewinnt, Fall in die Testtabelle.
5. **Staffelordner-Name:** Vorlage mit Default `S{nn}` (zweistellig, ab 100 dreistellig); Auswahl `S{nn}`,
   `Staffel {n}`, `Season {nn}`, eigene Vorlage. Name über `validate_name` (Rust) – ungültig = Zeile nicht ausführbar.
6. **Dubletten/Konflikte in der Vorschau:** dieselbe Folge mehrfach (andere Qualität/Release) → Zeilen markiert,
   Default: alle übernehmen, der Konfliktdialog (005) entscheidet bei gleichem Namen; zusätzlich Hinweis „Folge
   doppelt“. Lücken in der Folgen-Nummerierung je Staffel als Hinweis (nur Info). Mehrere verschiedene Seriennamen
   im Ordner (Text vor `SxxEyy`) → Warnhinweis, aber ausführbar.
7. **Ausführung:** Kopieren (Default, wie Marc es beschreibt) oder Verschieben als **ein Job** (`group` bzw.
   minimale Erweiterung). Wurzel = aktueller Ordner (Default) oder Ordner der anderen Seite (Option, wie 008).
   Nach dem Job beide Panels auffrischen (Watcher/`DirsChanged`).
8. **Aufräumen danach (nur bei Verschieben, Option, Default aus):** Release-Ordner, die danach nur noch Beiwerk
   enthalten (`.nfo`, `Sample/` …), über den Clean-Job aus 008 E3 entfernen – mit eigener Vorschau-Liste,
   **Papierkorb als Default**, nie oberhalb des Startordners, der Job prüft jeden Ordner neu. Klären, ob
   `CleanOptions` dafür „Beiwerk-Muster + Unterordner `Sample`“ braucht oder die vorhandenen Muster reichen.
9. **Dialog** „Serien nach Staffeln gruppieren…“: oben Optionen (Ziel, Vorlage, Kopieren/Verschieben, Filter,
   Untertitel, Aufräumen), darunter die Vorschau-Table (Quelle relativ zur Wurzel → Ziel, Staffel, Folge, Status:
   ok / schon am Ziel / ignoriert / nicht erkannt / doppelt / ungültig), Filter „ignorierte zeigen“, Summen je
   Staffel. Strg/⌘+Enter = Ausführen, Esc. Letzte Eingaben über `dialogs.recent` (027).
10. **Aktion** `OPEN_SERIES_GROUP_DLG` im Aktionskatalog, Kürzel in allen drei Keymaps (freie Taste suchen, Vorschlag
    `Alt+Shift+G` / `⌥⇧G` – vorher prüfen), Menü „Dateien“ neben „Gruppieren…“, Actions-Menü, Befehlspalette;
    Texte en/de (`*-texts.ts` + `.de.ts`). Gesperrt in Archiven, auf Serverpfaden und auf ungeprüften Listings
    (`OFF_WHILE_UNCHECKED`, 030) – Verschieben ist destruktiv.
11. **Doku:** README-Feature (Norton-Screenshot nach 044, falls passend), `docs/architecture.md` (Entscheidungen),
    `docs/roadmap.md`, `prompts/README.md`.

## Akzeptanzkriterien

- Marcs Beispiel (als Fixture nachgebaut, Dateien leer oder klein) → Vorschau zeigt 30 ausführbare Zeilen, 60
  ignorierte (30 `.nfo`, 30 Samples); Kopieren legt `S01` (12), `S02` (6), `S03` (6), `S04` (6) an, Originale
  bleiben unverändert.
- Zweiter Lauf auf demselben Ordner → alle 30 Zeilen „schon am Ziel“, kein Job nötig (Knopf gesperrt).
- Verschieben + „Aufräumen“ → Release-Ordner landen im Papierkorb, die Staffelordner bleiben; nichts oberhalb des
  aktuellen Ordners wird angefasst (Rust-Test).
- `x264`, `h264`, `1080p`, `2160p`, `DDP5.1` im Namen werden nie als Staffel/Folge erkannt (Testtabelle).
- Doppelte Folge (S01E03 in 720p und 1080p) → beide als „doppelt“ markiert; bei gleichem Zielnamen Konfliktdialog.
- Symlink auf einen Ordner außerhalb → nicht verfolgt; 10 000 Dateien → Vorschau bleibt flüssig, Einsammeln
  abbrechbar.
- Bedienung komplett per Tastatur; Texte deutsch/englisch.

## Tests

- **Frontend (rein):** `series-engine.ts` mit tabellengetriebenem Katalog `series-engine.cases.json` (alle Muster,
  Fehlerkennungen, Doppelfolgen, Ordner-Fallback, Vorlagen, Dubletten) – **Marcs Beispieldatei als ein Fall** (90
  Pfade → 30 Ziele, 60 ignoriert). Store-Tests mit Fakes (Einsammeln, Vorschau, Start des Jobs, Aufräumen nur bei
  Verschieben).
- **Rust:** Einsammeln (Symlinks, fremdes FS, Grenzen, unlesbar, nicht-UTF-8 unter Linux), Ausführung mit Quellen
  aus Unterordnern (tempfile): Kopieren, Verschieben, schon am Ziel, Zielordner existiert als Datei, Abbruch;
  Aufräumen (nur Beiwerk-Ordner, nie oberhalb der Wurzel, neuer Inhalt → „nicht mehr leer“).
- **E2E unter Xvfb:** Fixture aus der Beispieldatei anlegen, Dialog öffnen, Vorschau prüfen, Kopieren, Ergebnis im
  Panel; Screenshot im Bericht beschreiben.

## Nicht in diesem Prompt (→ „Offen“ im Design)

- Umbenennen der Folgen (z. B. `Serie - S01E01 - Titel.mkv`) – dafür gibt es Multi-Rename (007).
- Metadaten aus dem Netz (TVDB/TMDB), Episodentitel.
- Mehrere Serien in einem Ordner automatisch in Serienordner trennen.
