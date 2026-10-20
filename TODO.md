# TODO – Stand Montag, 19.10.2026

Fertig und in `main`: **001–020** (Details: `prompts/README.md`, Design-Dokumente
`prompts/NNN-*.design.md` mit Abschnitten „Review“ und „Offen“). `pnpm check` auf `main` grün (Linux).

## 0. SCSS → CSS

- [x] Umstellung übernommen (auch in 015: `settings-dialog.css`; CLAUDE.md §4: kein SCSS mehr).

## 1. Laufende Prompts

- [ ] **030 Ordner-Cache + schnelleres Listing (SMB)** – Prompt geschrieben (20.10.), baut auf 029 auf. Teil C
      (`getattrlistbulk`) braucht Test und Messung auf Marcs Mac an der SMB-Freigabe.
- [x] **029 Bedienbar bei langen Jobs** (20.10., Branch `feat/reaktionsfaehig-bei-jobs`, gepusht, **nicht** gemergt):
      Anlass Marcs Screenshot (Ziel-Panel beim Kopieren aufs langsame Laufwerk gesperrt). Auffrischen ohne Overlay,
      Drossel, Hinweis „antwortet langsam“ + Esc, Tab-Wechsel sofort aus dem letzten Listing, Watcher hält Rescans von
      Job-Zielen zurück, ein Listing je hängendem Ordner, 1-MiB-Blöcke + `F_NOCACHE`, Commands async. E2E unter Xvfb
      mit `FNF_TEST_SLOW`. **Bei Marc prüfen:** Kopie auf das echte langsame Laufwerk (USB/NAS) auf macOS – Panel
      bedienbar? `F_NOCACHE` messbar (Aktivitätsanzeige → Speicher)? Menüs/Fenster nach der async-Umstellung normal?
- [x] **015 Einstellungen/i18n** – in `main` (19.10.): `main` eingemergt (About aus 017 bleibt, Texte von
      016/017/019 übersetzt), E2E unter Xvfb, Review (16 Befunde, Tabelle in Design §6), Doku. Offen (Design §9):
      Button-Editor, Spaltenauswahl, Dialog-Optionen 008/010 dauerhaft, weitere Sprachen; Leertaste/Start-Ordner/
      Netzlaufwerk-Polling nur E2E bzw. ohne eigenen Store-Test.
- [x] **018 Feature-Parität + 020 Actions-Menü** (19.10.): Matrix gegen `old_project/` in `docs/feature-parity.md`
      (192 ✅, 26 🟡, 11 ⬜, 24 ✖), kleine Lücken geschlossen, E2E Linux. Nächstes: Folge-Prompts **021–028** schreiben
      (Vorschläge in `docs/feature-parity.md` „Folge-Prompts“: Shell-Leiste, Konfig-Editoren, Editor, Attribute,
      Archive, Import alter Konfiguration, Persistenz je Ordner, Drag & Drop).

## 2. Auf dem Mac prüfen (Marc – im Container nicht möglich)

`pnpm tauri dev` baut auf macOS (nur 2 Warnungen, behoben in `d4ca3f3`). Bitte durchklicken:

- [ ] Natives Menü (014): ⌘-Kürzel in Textfeldern (F2-Editor, Filter) lösen **keine** Aktion aus; Kürzel-Badges.
- [ ] Papierkorb (006): Finder-Erlaubnis, „Zurücklegen“.
- [ ] Multi-Rename (007): nur Groß/klein (`a.txt` → `A.txt`) und NFD-Namen auf APFS; Tausch `a↔b`; Undo.
- [ ] Überwachung (012): Änderungen im Finder erscheinen sofort; Drop aus dem Finder öffnet den Kopieren-Dialog.
- [ ] OS-Integration (011): Laufwerke (`/Volumes`), „Im Finder zeigen“ (⌘⇧F), Terminal (⌘⇧C), F4.
- [ ] Vorschau (010): Schnellvorschau ⌃Q, Bilder, ⌘I Eigenschaften.
- [ ] Themes (013/019): System-Hell/Dunkel live; die acht alten Designs ansehen.
- [ ] Einstellungen (015): App-Menü „Einstellungen…“ (⌘,), Sprache umschalten (auch natives Menü), Zeilenhöhe.
- [ ] Arbeitstag (018) auf macOS und Windows: markieren, F5 mit Konflikt, Multi-Rename, Gruppieren, Suchen, Tabs,
      Neustart; alte Kürzel ⌃⌘D (abwählen), ⌃⌥D (Pfad), ⌃⌘C/M/R/A, ⌃⌥G/N/M, ⇧Leertaste.
- [ ] Actions-Menü (020): ⌃K ⌃M öffnet es (macOS), Badges `^ ⌘ alt ⇧` lesbar in hellen und dunklen Designs.

## 3. CI und Plattformen

- [ ] Workflow-Vorlagen aus `docs/ci/` übernehmen (`docs/ci/README.md`) – erster Windows-/macOS-Lauf deckt
      `#[cfg]`-Code aus 006–016 auf, der im Container nie kompiliert wurde (Fehler wahrscheinlich).
- [ ] Windows: Papierkorb je Laufwerk prüfen (006 Review #5), atomares Umbenennen im Fallback (`MoveFileExW`,
      007 #6), Pause der Watcher bei Move/Rename (012 #3, nur plattformneutral getestet).
- [ ] Projektlizenz festlegen (Voraussetzung für jedes Release, `docs/release.md`) + `THIRD-PARTY-NOTICES`.

## 4. Kleinere offene Punkte

- [ ] Flackernder Test: `watch::tests::a_mass_change_becomes_a_rescan` scheiterte einmal im Gesamtlauf (timing).
- [ ] Bundle-Budget auf 1,5 MB angehoben (Merge 009) – Dialoge per `@defer` nachladen, dann zurücksetzen.
- [ ] 019: Kontrast-Korrekturen in `docs/legacy-themes-contrast.md` durchsehen; Fehlertext in Dialogen hat kein
      eigenes Token (Norton 1,9:1).
- [ ] 016: 7z/RAR, Dateien im Archiv ansehen, ZIP-Zeiten als UTC, Konfliktdialog sagt „Cancel copying“.
- [ ] 012: Ziehen aus der App ins System, Verknüpfung per Drag.
- [ ] Spalte „Modified“ ist für das US-Format (`10/19/2026, 08:48 AM`) zu schmal – wird abgeschnitten (E2E 015).
- [ ] 015: `loadingText` der Table folgt keinem Sprachwechsel (Overlay-Texte nur beim Erzeugen, `TODO(guiexpert)`).
- [ ] GuiExpert-Table-Lücken G15–G19 an `mono/TODO.md` melden (Details in den Design-Dokumenten 009, 012).

## 5. Logo

- [x] Nutze als App-Logo das Logo in 'docs/logo' (erledigt in `0ab9a54`: `ff-green` als `app-icon.svg`, Icons + favicon)
