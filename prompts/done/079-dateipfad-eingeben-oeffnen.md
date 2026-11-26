# Prompt 079: Dateipfad in der Pfadzeile – hinwechseln und die Datei öffnen wie per Doppelklick

> **Slug:** `dateipfad-eingeben-oeffnen` · **Braucht:** 003 (Pfadzeile, „Gehe zu Pfad…“ `OPEN_CHDIR_DLG`), 010
> (Ansicht), 025 (Archiv-Einträge öffnen), 034 (Serverpfade), 053 (Pfadleiste), 071 (MCP-Stufen), 072/073
> (Doppelklick-Aktionen) · **Umfang:** S (fast nur Frontend)
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `features/workspace/file-panel.ts` (`submitPath`,
> `pathEditRequest`), `core/fs/fs-api.ts` (`resolveLocation` → `{ dir, select }`) samt Rust-Gegenstück,
> `features/browser/file-list/file-list.ts` (Hook `doubleClick`) und `file-list-controller.ts` (`onClick`,
> `clickCount >= 2`), `features/browser/file-browser.store.ts` (`open`, `openFile`, `openInArchive`,
> `openOnServer`), `features/fileactions/file-actions.store.ts` (`handleDoubleClick`).
> Design-Dokument: `prompts/079-dateipfad-eingeben-oeffnen.design.md` (kurz).

## Auftrag (Marc, 25.11.2026)

Wenn ich in „Change Dir“ (Gehe zu Pfad…, `Mod+L`) oder direkt in die Pfadzeile einen **vollständigen Dateipfad**
eingebe, z. B. `/Users/marckronberg/RustroverProjects/mud-and-steel/build/trailer/bocage_barrage.mp4`, dann soll
der **aktive Tab in das Verzeichnis wechseln** und die App soll so tun, **als hätte jemand die Datei
doppelgeklickt** (Ausführen).

## Ist-Zustand

- „Change Dir“ und die Pfadzeile sind **dasselbe Eingabefeld**: `OPEN_CHDIR_DLG` ruft
  `WorkspaceStore.requestPathEdit(side)`, Enter landet in `FilePanel.submitPath`.
- `submitPath` ruft `fsApi.resolveLocation(value)`; für einen Dateipfad kommt `{ dir, select }` zurück, das Panel
  lädt `dir` und stellt den **Cursor auf die Datei** (`store.load(dir, { cursor: select })`). Die Datei wird
  **nicht** geöffnet – das ist die Lücke.
- Der Doppelklick läuft heute so: `FileListController.onClick` → Hook `doubleClick(entry, modifiers)` in
  `file-list.ts` → zuerst die Regeln aus 072/073 (`FileActionsStore.handleDoubleClick`), dann
  `behavior.doubleClick === 'view'` → `OPEN_VIEW_DLG`, sonst `store.open(entry)` (Standard-App, Archiv als Ordner,
  Eintrag im Archiv/auf dem Server).
- Diese Kette steckt in der Liste (Hook + Controller), nicht an einer Stelle, die `submitPath` rufen könnte.

## Ziel

Enter im Pfadfeld mit einem Dateipfad =

1. Tab wechselt in den Ordner der Datei (wie heute, mit Verlaufseintrag),
2. Cursor steht auf der Datei, das Panel hat den Fokus,
3. **dieselbe Kette wie beim Doppelklick ohne gehaltene Tasten** läuft für diesen Eintrag: Doppelklick-Regel
   (072/073, Auslöser „ohne Taste“) → Einstellung `behavior.doubleClick` (Ansicht) → `store.open`.

Ein Ordnerpfad verhält sich wie bisher (nur hinwechseln).

## Entscheidungsfragen (Phase 1, kurz im Design beantworten)

- **E1 Eine Stelle für „öffnen wie Doppelklick“.** Die Kette aus `file-list.ts` in eine aufrufbare Funktion ziehen
  (z. B. `FileList.activate(entry, modifiers)` bzw. ein kleiner Dienst je Panel), die Hook **und** `submitPath`
  nutzen – keine zweite Kopie der Reihenfolge Regel → Ansicht → Öffnen. Empfehlung: so; im Design die Stelle
  benennen.
- **E2 Ordner oder Datei?** Maßgeblich ist, was `resolveLocation` meldet (`select !== null` und der Eintrag im
  Listing ist kein navigierbarer Ordner). Sonderfälle festlegen:
  - **Archivdatei** (`x.zip`): Doppelklick betritt das Archiv – also auch hier (Empfehlung), sofern keine Regel
    greift.
  - **Abschließender Separator** (`…/foo.mp4/`) oder Symlink auf einen Ordner: wie Ordner, nichts ausführen.
  - **App-Bundle** auf dem Mac (`Foo.app`): wie der Doppelklick heute damit umgeht – nachsehen, nicht neu erfinden.
  - **Pfad in ein Archiv** (`…/a.zip/b/c.txt`) und **Serverpfad** (`remote://…/datei`): prüfen, was
    `resolveLocation` bzw. der `isRemotePath`-Zweig heute liefert. Empfehlung: Archiv-Einträge mitnehmen, wenn es
    ohne neuen Command geht; Serverpfade in diesem Prompt nur hinwechseln (Öffnen = Download, kein stiller
    Transfer) und unter „Offen“ notieren.
- **E3 Eintrag nicht sichtbar** (versteckte Datei bei „Hidden aus“, aktiver Filter): Der Cursor kann nicht auf
  die Zeile. Optionen: A trotzdem öffnen (der Nutzer hat den Namen ausdrücklich getippt) – **Empfehlung**, mit dem
  Eintrag aus dem ungefilterten Listing; B nur hinwechseln. Nie den Filter stillschweigend ändern.
- **E4 Datei gibt es nicht** (Tippfehler im Namen, Ordner existiert): wie heute – Fehlertext im Pfadfeld, Feld
  bleibt offen; kein Wechsel in den Elternordner und nichts wird gestartet.
- **E5 Schalter?** Ausführen per Eingabe ist neu für alle, die bisher einen Pfad nur zum „Hinspringen“ eingefügt
  haben. Optionen: A immer (Marcs Auftrag) – **Empfehlung**; B Einstellung `behavior.pathEnterOpensFile` (Default
  an). Nur B bauen, wenn Marc es will. In beiden Fällen: **Shift+Enter** (oder ein anderer Modifier) im Pfadfeld =
  nur hinspringen ohne Öffnen? Vorschlag machen, freie Taste prüfen, im Platzhalter/Tooltip des Feldes nennen.
- **E6 Ungeprüftes Listing** (030, `cachedAt`): erst öffnen, wenn Rust den Ordner bestätigt hat und der Eintrag
  noch da ist; sonst Fehler wie E4.

## Aufgaben

1. **Bestand prüfen:** die oben genannten Dateien; zusätzlich jeden weiteren Rufer von `resolveLocation` und
   jeden Weg, der einen Pfad „ansteuert“, ohne dass der Nutzer ihn ins Pfadfeld getippt hat: Sitzungs-Restore,
   Favoriten/Verlauf/Ordnermenü, `GOTO_FILE`, Palette (`PALETTE_REVEAL_HIT`), Drag & Drop, Ordner-Finder,
   **MCP `navigate`** (`mcp/view.rs` + `McpStore`). Tabelle „Weg → öffnet nach 079: ja/nein“ – **ja nur für Enter
   im Pfadfeld**.
2. **Kette herauslösen (E1)** und in `submitPath` nach erfolgreichem `store.load` aufrufen – erst wenn das Listing
   da ist (Request-Sequenz beachten: eine veraltete Antwort oder ein inzwischen gewechselter Tab öffnet nichts),
   Tab **per Id** festhalten.
3. **Reihenfolge im Fenster:** Pfadfeld schließen, Fokus ins Panel (`ws.requestFocus`), Cursor setzen, dann
   öffnen. Greift eine Doppelklick-Regel, bleibt die Markierung unberührt (hier gab es keinen Klick).
4. **Fehler:** scheitert das Öffnen (keine Standard-App, `not_found`, Rechte), bleibt der Tab im Ordner mit dem
   Cursor auf der Datei; die Meldung erscheint so, wie sie beim Doppelklick erscheint (`describeFsError`).
5. **Sicherheit / Abgrenzung (CLAUDE.md §4):** Geöffnet wird ausschließlich nach **Enter des Nutzers im Pfadfeld**.
   Kein neuer Rust-Command, der „Pfad öffnen“ aus beliebigem Frontend-Code anbietet; `opener.rs` und seine Prüfung
   bleiben der einzige Weg. **MCP:** Stufe 1 darf weiterhin nur navigieren – „Öffnen“ ist Stufe 3 und existiert
   nicht; ein Test belegt, dass `navigate` mit einem Dateipfad nichts startet. Server-URL (`isServerUrl`) und
   `remote://` behalten ihre Zweige.
6. **Texte** en/de: Platzhalter/Tooltip des Pfadfeldes („Ordner oder Datei – eine Datei wird geöffnet“, je nach
   E5 mit der Taste für „nur hinspringen“); Label der Aktion bleibt.
7. **Doku:** `docs/architecture.md` (Entscheidung), `docs/ui-layout.md` (Pfadzeile), README-Abschnitt Navigation,
   `docs/mcp.md` (ein Satz: Navigieren öffnet nie), `docs/roadmap.md`, `CLAUDE.md` §1, Index `prompts/README.md`.

## Akzeptanzkriterien

- `Mod+L`, Marcs Beispielpfad einfügen, Enter → aktiver Tab zeigt `…/build/trailer`, Cursor auf
  `bocage_barrage.mp4`, das Video startet in der Standard-App. Dasselbe nach Klick in die Pfadzeile (053).
- Der andere Tab und die andere Seite bleiben unverändert; „Zurück“ führt in den vorherigen Ordner.
- Gibt es eine Doppelklick-Regel `*.mp4` → Programm X (ohne Taste), startet X statt der Standard-App. Eine Regel
  mit Modifier (z. B. Shift) greift nicht.
- `behavior.doubleClick = view` → die Ansicht (F3) öffnet die Datei.
- Ordnerpfad, Pfad mit `/` am Ende, `~`-Pfad auf einen Ordner → nur Wechsel, nichts startet.
- `…/archiv.zip` → nach E2 (Empfehlung: Panel zeigt den Inhalt des Archivs).
- Dateiname mit Tippfehler → Fehlertext im Feld, Tab unverändert, nichts startet.
- Versteckte Datei bei „Hidden aus“ → nach E3.
- Pfade mit Leerzeichen, Umlauten, Emoji; unter Windows `C:\…\datei.txt` und UNC.
- MCP-`navigate` auf denselben Dateipfad wechselt nur den Ordner; Sitzungs-Restore, Verlauf und `GOTO_FILE`
  öffnen nichts.
- Schnelles Enter + sofortiger Tab-Wechsel oder zweites Enter mit anderem Pfad → höchstens die letzte Eingabe
  öffnet, nie im falschen Tab.

## Tests

- **Frontend:** Spec für die herausgelöste Kette (Regel → Ansicht → Öffnen, Modifier), `file-panel.spec.ts` mit
  `FakeFsApi`: Dateipfad (öffnet genau einmal, nach dem Listing), Ordnerpfad, fehlende Datei, Archiv, versteckt
  (E3), veraltete Antwort, Fehler beim Öffnen. Bestehende Doppelklick-Specs bleiben grün (kein Verhalten der Maus
  ändert sich).
- **Rust:** nur falls `resolve_location` angefasst wird (Archiv-Eintrag, abschließender Separator) – dann
  tabellengetrieben mit `tempfile`; MCP-Test aus Aufgabe 5.
- **E2E** (echtes Fenster): Beispielpfad auf dem Mac; im Container mit einer Textdatei und einer Doppelklick-Regel,
  die ein Protokoll-Skript startet.

## Nicht in diesem Prompt (→ „Offen“ im Design)

- Dateien auf Servern per Pfadeingabe öffnen (E2).
- Mehrere Pfade auf einmal, Pfad mit Zeilennummer (`datei.rs:42`), `file://`-URLs.
- Dateipfad als Startargument der App (`fnf <datei>`).
- Öffnen über MCP.
