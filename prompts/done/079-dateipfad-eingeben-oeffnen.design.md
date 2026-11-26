# Design 079: Dateipfad in der Pfadzeile – hinwechseln und öffnen wie per Doppelklick

> **Status:** umgesetzt · **Datum:** 26.11.2026 · **Auftrag:** `079-dateipfad-eingeben-oeffnen.md`
> **Phasen:** 1 (Design), 3 (Frontend, Specs zuerst), 5 (Doku), 6 (Abschluss). Phase 2 (Rust) entfällt bis auf einen
> Test: `resolve_location` bleibt unverändert, der MCP-Test aus Aufgabe 5 wird geschärft. Der 🛑-Haltepunkt nach dem
> Design entfällt (Marc: selbständig durcharbeiten).
> **Entscheidungen in Kürze:** eine Stelle `EntryActivator` (E1) · Rust entscheidet Ordner/Datei, Archivdatei wird
> betreten, Pfad *in* ein Archiv und Serverdateien bleiben wie heute (E2) · versteckte/gefilterte Datei wird trotzdem
> geöffnet (E3) · Tippfehler = Fehler im Feld, nichts passiert (E4) · immer öffnen, **Shift+Enter** = nur hinspringen,
> keine neue Einstellung (E5) · vor dem Öffnen wird der Ordner frisch gelistet, nie aus dem Cache (E6).

## 1. Bestand

| Baustein | wofür | Befund |
|---|---|---|
| `FilePanel.submitPath` (`features/workspace/file-panel.ts`) | Enter im Pfadfeld (= „Gehe zu Pfad…“, `OPEN_CHDIR_DLG`) | lädt `dir`, Cursor auf `select`; öffnet nicht → **erweitern**. Prüft nach `await` weder Tab noch Reihenfolge der Eingaben → **ergänzen** (Tab-Id, Eingabe-Sequenz) |
| `FsApi.resolveLocation` / Rust `commands::location_of` | Ordner → `{dir}`, Datei → `{dir: Eltern, select}` | passt. `metadata` folgt Links (Symlink auf Ordner = Ordner). `normalize_lexically` schluckt einen abschließenden Separator (`…/foo.mp4/` → Datei) → im Frontend an der rohen Eingabe erkannt. Pfad in ein Archiv: `archive_error` (Review 016 #7), `remote://`: nur Form geprüft, `select: null` |
| Hook `doubleClick` in `file-list.ts` | Kette Regel (072/073) → `behavior.doubleClick = view` → `'open'` | steckt in der Liste → **herauslösen** (E1) |
| `FileListController.onClick` | ruft den Hook, öffnet bei `'open'`, stellt bei `'rule'` die Markierung zurück | bleibt unverändert (Maus ändert sich nicht) |
| `FileActionsStore.handleDoubleClick(entry, modifiers, panel)` | Regel finden und starten; nicht im Archiv/auf Servern/in Dubletten-Tabs | passt, wird mit `[]` (ohne Taste) gerufen |
| `FileBrowserStore.open` / `openFile` | Ordner/Archiv betreten, Datei mit Standard-App (Programme erst nach Rückfrage), Fehler → `store.error` | passt; `openFile` schweigt, solange `McpGuardService.locked()` (1,5 s nach einer Ansichtsänderung durch einen Client) – gilt auch hier |
| `FileBrowserStore.load` | Request-Sequenz, Cache langsamer Ordner (030) | **erweitern**: `LoadOptions.fresh` (nicht aus dem Cache) und `onListed` (genau diese Antwort wurde gezeigt) |
| `ViewerStore.open()` (`OPEN_VIEW_DLG`) | zeigt den Eintrag unter dem Cursor der aktiven Seite | passt, wenn Seite aktiv und `cursorPath` auf dem Eintrag steht – das stellt `EntryActivator.activate` sicher |
| App-Bundle `Foo.app` | Listing: `kind = directory` → Doppelklick betritt den Ordner | `resolve_location` meldet einen Ordner → nur Wechsel; gleiches Verhalten, nichts Neues |
| MCP `navigate` (`mcp/view.rs::folder_target`) | lehnt alles ab, was kein Ordner ist (`not_a_directory`) | passt; Test wird um „keine Anfrage ans Fenster, kein Job“ ergänzt |

## 2. Entscheidungen

- **E1 – eine Stelle.** Neuer Root-Dienst `features/browser/entry-activator.ts` (`EntryActivator`), wie
  `FileActionsStore.handleDoubleClick` mit dem Panel-Store als Parameter (kein Provider je Host nötig):
  - `decide(entry, modifiers, panel): DoubleClickResult` – die Reihenfolge Regel → Ansicht → `'open'`; das ist der
    bisherige Hook, `file-list.ts` reicht nur noch durch.
  - `activate(entry, panel): Promise<DoubleClickResult>` – „wie ein Doppelklick ohne Taste“: Cursor auf den Eintrag,
    `decide(entry, [], panel)`, bei `'open'` → `panel.open(entry)`. Einziger Rufer: `submitPath`.
  Der Controller behält sein `store.open(row)` für das Ergebnis `'open'` (er braucht das Ergebnis für die
  Markierung); die **Reihenfolge** gibt es nur in `decide`.
- **E2 – Ordner oder Datei.** Maßgeblich ist `resolveLocation`: `select !== null` = Datei.
  - *Archivdatei* (`x.zip`): Kette wie beim Doppelklick → ohne Regel betritt `panel.open` das Archiv.
  - *Abschließender Separator*: die rohe Eingabe endet auf `/` oder `\` → wie Ordner behandelt, d. h. Verhalten wie
    vor 079 (Wechsel in den Elternordner, Cursor auf der Datei), nichts startet. Kein Rust-Umbau: `resolve_location`
    hat zwei weitere Rufer (Kopierziel, Entpackziel), deren Verhalten gleich bleiben soll.
  - *Symlink auf Ordner*, *App-Bundle*: Rust meldet einen Ordner → nur Wechsel (wie der Doppelklick: betreten).
  - *Pfad in ein Archiv* (`…/a.zip/b/c.txt`): **Abweichung von der Empfehlung.** `location_of` lehnt getippte
    virtuelle Pfade bewusst ab (Review 016 #7, auch als Schutz der beiden anderen Rufer). Mitnehmen hieße diese
    Entscheidung für alle Rufer aufheben oder einen zweiten Command bauen – beides sprengt „S, fast nur Frontend“.
    Bleibt: Fehlertext im Feld. → Offen.
  - *Serverpfad* (`remote://…/datei`), *Server-URL*: Zweige unverändert, nie ein Öffnen (kein stiller Transfer). → Offen.
- **E3 – Eintrag nicht sichtbar:** Variante A. Der Eintrag kommt aus dem **ungefilterten** Listing der Antwort; er
  wird geöffnet, obwohl keine Zeile den Cursor tragen kann. Filter und „Hidden“ bleiben, wie sie sind.
- **E4 – Datei gibt es nicht:** unverändert – `resolveLocation` scheitert, Fehlertext im Feld, Feld bleibt offen,
  kein `load`, nichts startet. Verschwindet die Datei zwischen Auflösen und Listing, steht der Tab schon im Ordner;
  dann `not_found` im Feld und nichts startet.
- **E5 – Schalter:** Variante A, immer öffnen, **keine** Einstellung. Dazu **Shift+Enter = nur hinspringen** (Ordner
  wechseln, Cursor auf die Datei, nichts startet). Die Taste ist frei: in den Keymaps gibt es nur `Enter`,
  `Mod+Enter`, `Alt+Enter`, `Alt+Shift+Enter`, `Mod+Shift+Enter`, `Mod+Alt+Enter`; der `KeyboardDispatcher` lässt
  Tasten ohne Mod/Alt in Eingabefeldern ohnehin beim Feld. Genannt im Platzhalter und im Tooltip des Feldes und im
  Tooltip der Pfadleiste. Das Feld fängt Shift+Enter selbst ab (`onPathKeydown`, Widget-Ausnahme wie Esc dort).
- **E6 – ungeprüftes Listing:** Soll geöffnet werden, lädt das Panel mit `fresh: true` – der `ListingCache` wird
  übergangen, es gibt also nie einen ungeprüften Zwischenstand, aus dem geöffnet würde. `onListed` meldet genau die
  Antwort dieser Anfrage; der Eintrag wird in **diesem** Listing gesucht. Fehlt er → wie E4.

## 3. Ablauf in `submitPath(evt, value, jumpOnly)`

1. `submit = ++pathSubmitSeq`, `tabId = tab().id`. Server-URL und `remote://` wie bisher.
2. `resolveLocation(value)`; danach `stale()` (anderer Tab aktiv oder neuere Eingabe) → nichts tun.
3. `open = select !== null && !jumpOnly && !endsWithSeparator(value)`.
4. `store.load(dir, { cursor: select, fresh: open, onListed })`; danach wieder `stale()`.
5. Fehler des Ladens → Text im Feld (wie bisher). `open`, Listing da, Eintrag fehlt → `not_found` im Feld.
6. Feld schließen, Fehler löschen. Ohne Öffnen: `ws.requestFocus(side)` wie bisher. Mit Öffnen: Seite aktiv setzen
   und die Liste **direkt** fokussieren (kein Effekt, der später einem Ansicht-Dialog den Fokus nähme), dann
   `activator.activate(entry, store)`.
7. Wurde das Laden von etwas anderem überholt (kein `onListed`, kein Fehler): Feld zu, nichts öffnen.

Markierungen: `activate` fasst sie nicht an (kein Klick, also nichts zurückzustellen).

## 4. Weg → öffnet nach 079?

| Weg | Code | öffnet |
|---|---|---|
| **Enter im Pfadfeld** (`Mod+L` / Klick in die Pfadleiste) mit Dateipfad | `FilePanel.submitPath` → `EntryActivator.activate` | **ja** |
| Shift+Enter im Pfadfeld; Eingabe mit abschließendem Separator | `submitPath(…, jumpOnly)` | nein |
| Enter im Pfadfeld: Ordner, `~`, Symlink auf Ordner, `.app` | `submitPath` (`select === null`) | nein |
| Enter im Pfadfeld: `remote://…`, `sftp://…` | eigene Zweige | nein |
| Sitzungs-Restore, Tab-Wechsel | `FilePanel`-Effekt → `store.load(tab.path)` | nein |
| Favoriten, Verlauf, Ordnermenü, Laufwerke, Brotkrumen | `ws.requestNavigate` / `store.load` | nein |
| `GOTO_FILE`, Palette `PALETTE_REVEAL_HIT` | `requestNavigate(side, dir, cursor)` | nein |
| Ordner-Finder, Drag & Drop, „in neuem Tab öffnen“ | `requestNavigate` / `openInNewTab` | nein |
| Zielfeld Kopieren/Verschieben, Entpackziel | `resolveLocation` in `ops.store.ts`, `archive.store.ts` | nein |
| MCP `navigate` / `open_tab` / `set_cursor` | Rust lehnt Dateien ab (`not_a_directory`); Fenster: `requestNavigate` | nein |

`EntryActivator.activate` hat genau einen Rufer; eine Spec prüft das am Quelltext.

## 5. Verträge

- Rust: **keine** Änderung an Commands, DTOs, Fehlercodes. Kein neuer Command.
- TS: `LoadOptions.fresh?: boolean`, `LoadOptions.onListed?: (listing) => void`; `EntryActivator` (s. o.);
  `endsWithSeparator(raw)` in `features/workspace/path-input-logic.ts` (rein; prüft die **getippte** Eingabe, rechnet
  nicht mit Backend-Pfaden).
- Tasten: Enter = hin und öffnen, Shift+Enter = nur hin, Esc = abbrechen (alle nur im Feld; keine Keymap-Änderung).
- Texte (`workspace/texts.ts` + `.de.ts`): `pathPlaceholder`, `pathFieldHint`, `enterPathHint` um einen Satz ergänzt.

## 6. Testplan

- `entry-activator.spec.ts`: Regel ohne Taste läuft; Regel mit Shift greift bei `activate` nicht; `view` → Aktion
  `OPEN_VIEW_DLG`, nicht für Ordner; sonst `openFile`; Archiv wird betreten; Fehler von `openFile` landet in
  `store.error`; `activate` hat genau einen Rufer.
- `file-panel.spec.ts`: Dateipfad öffnet einmal und erst nach dem Listing; Ordnerpfad; abschließender Separator;
  Shift+Enter; Tippfehler; Archiv; versteckte Datei; Regel statt Standard-App; `view`; veraltete Antwort
  (Tab-Wechsel, zweites Enter); Fehler beim Öffnen; Cache wird übergangen (E6); `requestNavigate` mit Dateipfad
  öffnet nichts.
- `path-input-logic.spec.ts`: Separator-Erkennung.
- `mcp.store.spec.ts`: `navigate` mit Dateipfad ruft nur `requestNavigate`, `openFile` nie.
- Rust `mcp/tests.rs`: `navigate` auf eine Datei → `not_a_directory`, keine Anfrage ans Fenster, kein Job.
- E2E im echten Fenster: siehe „Offen“.

## 7. Fortschritt

- [x] Design
- [x] Specs rot, dann Implementierung (`EntryActivator`, `submitPath`, `LoadOptions.fresh`/`onListed`, Texte)
- [x] Rust-Test MCP geschärft
- [x] Doku, Index, Verschieben nach `done/`
- [x] `pnpm check`, `pnpm tauri build --debug --no-bundle`

## 8. Offen

- **E2E im echten Fenster nicht geprüft.** Marcs installierte App läuft; Tastendrücke an ein Fenster waren in der
  Sitzung nicht erlaubt. Das Verhalten ist nur über Specs belegt (jsdom, `FakeFsApi`). Von Hand zu prüfen:
  Beispielpfad aus dem Auftrag mit `Mod+L`, Shift+Enter, eine Regel `*.mp4`, `behavior.doubleClick = view`, der
  Fokus nach dem Schließen der Ansicht, Windows `C:\…` und UNC.
- Pfad **in** ein Archiv tippen (`…/a.zip/b/c.txt`): weiter `archive_error` (E2).
- Dateien auf Servern per Pfadeingabe öffnen (`remote://…/datei` lädt als Ordner und scheitert wie bisher).
- Eine Datei, deren Name wirklich auf `\` endet (Unix), wird per Eingabe nur angesprungen, nicht geöffnet.
- Mehrere Pfade, `datei.rs:42`, `file://`-URLs, Startargument `fnf <datei>`, Öffnen über MCP – nicht Teil von 079.
