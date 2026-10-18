# TODO – Stand Sonntag, 18.10.2026 (Weiter am Montag)

Fertig, reviewt und in `main`: **001–014, 016, 017, 019** (Details: `prompts/README.md`, Design-Dokumente
`prompts/NNN-*.design.md` mit Abschnitten „Review“ und „Offen“). `pnpm check` auf `main` grün (Linux).

## 0. Achtung: ich habe das SCSS auf CSS umgestellt

## 1. Laufende Prompts

- [ ] **015 Einstellungen/i18n** – Branch `feat/einstellungen-i18n` (PR #9, noch nicht mergen).
      Stand: Rust (`settings.json`, Schema, Export/Import) und Frontend (Store, Dialog, Laufzeit-i18n de/en, Specs)
      fertig, `pnpm check` grün. Offen: `main` einmergen (Konflikte mit 016/017 erwartet: `DialogKind`, `lib.rs`,
      Keymaps, About-Dialog aus 017, Doku), E2E unter Xvfb, Review durch separaten Agenten, Doku (Phase 5/6),
      Punkte aus Design §9 „Offen“.
- [ ] **018 Feature-Parität** – noch nicht begonnen (braucht 015).

## 2. Auf dem Mac prüfen (Marc – im Container nicht möglich)

`pnpm tauri dev` baut auf macOS (nur 2 Warnungen, behoben in `d4ca3f3`). Bitte durchklicken:

- [ ] Natives Menü (014): ⌘-Kürzel in Textfeldern (F2-Editor, Filter) lösen **keine** Aktion aus; Kürzel-Badges.
- [ ] Papierkorb (006): Finder-Erlaubnis, „Zurücklegen“.
- [ ] Multi-Rename (007): nur Groß/klein (`a.txt` → `A.txt`) und NFD-Namen auf APFS; Tausch `a↔b`; Undo.
- [ ] Überwachung (012): Änderungen im Finder erscheinen sofort; Drop aus dem Finder öffnet den Kopieren-Dialog.
- [ ] OS-Integration (011): Laufwerke (`/Volumes`), „Im Finder zeigen“ (⌘⇧F), Terminal (⌘⇧C), F4.
- [ ] Vorschau (010): Schnellvorschau ⌃Q, Bilder, ⌘I Eigenschaften.
- [ ] Themes (013/019): System-Hell/Dunkel live; die acht alten Designs ansehen.

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
- [ ] GuiExpert-Table-Lücken G15–G19 an `mono/TODO.md` melden (Details in den Design-Dokumenten 009, 012).

## 5. Logo

- [ ] Nutze als App-Logo das Logo in 'docs/logo'
