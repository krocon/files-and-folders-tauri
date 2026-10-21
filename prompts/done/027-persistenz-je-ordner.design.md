# Design 027: Persistenz je Ordner und letzte Dialogeingaben

> **Status:** umgesetzt (21.10.2026), Branch `feat/persistenz-je-ordner` · Phasen zusammengelegt, ohne Freigabe-Halt
> (Marc: „bitte den nächsten Prompt“; die Entscheidungen sind klein und umkehrbar) · neue Rust-Datei, keine neuen
> Abhängigkeiten.

## 1. Bestand

| Baustein                                                               | wofür                                                             | Befund                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `tab-memory.ts` (`TabMemory.folders`, LRU 50, 003 E3)                  | Cursor/Markierung/Scroll je Ordner und Tab                        | **passt** – fehlt nur das Speichern; die Map hängt per Tab-Id am `WorkspaceStore` |
| `FileBrowserStore.apply`                                               | stellt beim Betreten Cursor und Markierung aus dem Gedächtnis her | **passt** – schneidet Markierungen schon mit dem neuen Listing (`intersect`)      |
| Tab-Ids in der Sitzung (`session.rs`)                                  | Zuordnung Datei ↔ Tab                                             | **passt** – Ids bleiben über den Neustart gleich                                  |
| `config_file::read_config` (022)                                       | fehlend/kaputt/unlesbar, `.bad`, nicht überschreiben              | **passt** für eine eigene Datei                                                   |
| `settings.json`, Typ `json` (015)                                      | gemerkte Listen (`search.recent`)                                 | **passt** für die Dialogeingaben (Export/Import inklusive)                        |
| Stores 008 (`GroupFilesStore`, `CleanFoldersStore`, `MultiMkdirStore`) | Dialogwerte                                                       | nur „für die Sitzung“ – Laden/Merken fehlt                                        |

## 2. Entscheidungen

- **E1 – Eigene Datei `folder-memory.json`** statt Sitzungsschema v2: die Sitzung bleibt klein und wird bei jeder
  Cursorbewegung geschrieben; das Gedächtnis kann groß werden (bis 100 Tabs × 50 Ordner × 2 000 Markierungen),
  hat ein eigenes, längeres Entprellen (1,5 s) und wird nur geschrieben, wenn sich das JSON geändert hat. Rust
  (`folder_memory.rs`) prüft nur Form und Größe (16 MiB, Pfade ≤ 4 096 Zeichen, keine NUL), wie `rename_presets`.
- **E2 – Je Tab, nicht je Pfad global** (anders als mr `selection0/1`): ein globales Gedächtnis würde Markierungen in
  einen anderen Tab tragen, der zufällig denselben Ordner zeigt – für F8 gefährlich. Die Datei hält je Tab-Id die
  Ordner (älteste zuerst). Geschlossene Tabs fallen beim nächsten Schreiben weg; Tabs, die seit dem Start noch nicht
  angezeigt wurden, behalten ihren Stand aus der Datei.
- **E3 – Nicht gespeichert:** Ordner in Archiven, auf Servern (`remote://`), Ergebnis- und Belegungs-Tabs
  (`FolderState.volatile`). Der angezeigte Ordner jeder Seite wird beim Schreiben als neuester Eintrag ergänzt
  (`FileBrowserStore.currentFolderState()`), aber nur, wenn das Panel wirklich den Ordner des Tabs zeigt (nicht beim
  Laden eines anderen).
- **E4 – Einstellung** `behavior.rememberFolders` (Default an). Aus: nichts wird beim Start eingesetzt, die Datei wird
  sofort geleert; das Gedächtnis innerhalb der Sitzung (003) bleibt wie bisher. Damit braucht es keinen eigenen Knopf
  „Gedächtnis leeren“: aus- und wieder einschalten leert es. Nicht im Export/Import (eigene Datei).
- **E5 – Dialogeingaben** in `settings.json` unter `dialogs.recent` (Typ `json`, ≤ 3 Einträge, 16 KiB):
  `{ dialog: 'groupFiles' | 'clean' | 'multiMkdir', value }`. Gemerkt wird **nach einem Lauf** (Job gestartet bzw.
  Ordner angelegt), nicht jede Änderung; gelesen beim ersten Öffnen der Sitzung. Jedes Feld wird einzeln geprüft
  (`restoreGroupOptions`, `restoreCleanForm`, `restoreMkdir`, Helfer in `shared/restore-fields.ts`), Ungültiges fällt
  auf den Default. **Der Löschmodus von „Ordner aufräumen“ wird nie gemerkt** – jedes Mal Papierkorb (CLAUDE.md §4).
  In den Einstellungen: Zähler + „Leeren“ (wie die letzten Suchen).
- **E6 – Fehler:** kaputte Datei → `.bad`, Hinweis, leer weiter; unlesbare Datei → Hinweis, in dieser Sitzung nie
  überschreiben (wie Sitzung/Konfiguration); Speicherfehler → Hinweis in der Workspace-Leiste.

## 3. Verträge

```
Rust  folder_memory.rs     FolderMemory { version: 1, tabs: [TabFolders { tabId, folders: [FolderState {
                           path, cursor?, marks[], scrollTop }] }] }   load → Loaded<FolderMemory>, save(bound)
      commands/config.rs   load_folder_memory() → Loaded<FolderMemory>; save_folder_memory(memory)  (async)
TS    core/memory/         FolderMemoryApi (Fassade), folder-memory.models.ts
      browser/             folder-memory-logic.ts: seedTabMemory, folderMemoryFile (rein)
      shared/              dialog-memory.ts (recall/remember), restore-fields.ts (rein)
Settings  behavior.rememberFolders (bool, true), dialogs.recent (json, maxItems 3, maxBytes 16384)
```

## 4. Tests

- Rust `folder_memory.rs`: Round-Trip mit Unicode/Leerzeichen, fehlend/kaputt/neuere Version → `.bad`, Grenzen
  (Tabs, Ordner, Markierungen, Dubletten, NUL, leere Ids, NaN), zu große Datei.
- `folder-memory-logic.spec.ts`: Seeding begrenzt, flüchtige Ordner fehlen, angezeigter Ordner als neuester,
  unbenutzte Tabs behalten ihren Stand.
- `folder-memory.spec.ts` (WorkspaceStore): Seeding beim ersten Öffnen eines Tabs, Schreiben bei `flush` und
  entprellt, unverändert = kein Schreiben, ladendes Panel zählt nicht, aus = leer, zur Laufzeit ausschalten, kaputt
  vs. unlesbar.
- `navigation.spec.ts`: gelöschte Markierung fällt weg; Ergebnisansicht ist flüchtig.
- `dialog-memory.spec.ts`, `tools.spec.ts`: Merken nach dem Lauf, nicht bei Abbruch; Wiederherstellen feldweise;
  Löschmodus nie gemerkt.

## 5. Fortschritt

- [x] Rust, Frontend, Einstellungen, Texte en/de, Specs
- [ ] E2E unter Xvfb (Neustart-Szenario)
- [ ] `pnpm check`, Doku
