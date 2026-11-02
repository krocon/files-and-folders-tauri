# Prompt 047: Speicherbelegung – Diagramm (Ringe/Kacheln) als eigener Tab statt Ziel-Panel-Overlay

> **Slug:** `speicherbelegung-diagramm-tab` · **Braucht:** 004 (Dual-Pane-Tabs, Sitzung), 006 (Kopieren/Verschieben/Löschen, `targetDir`), 012/031 (Drag & Drop von Einträgen und Tabs), 033 (Speicherbelegung), 040 (Panel-Aktionen) · **Umfang:** S (reines Frontend-Feature, Phase 2 Rust entfällt)
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/033-speicherbelegung.design.md` (insb. E1–E3), `prompts/done/004-dual-pane-tabs.design.md` und `prompts/done/031-drag-tabs-links.design.md`.
> Auftrag & Problem-Screenshot von Marc (31.10.2026): [`047-speicherbelegung-diagramm-tab-beispiel.jpg`](047-speicherbelegung-diagramm-tab-beispiel.jpg).

## Auftrag & Problemanalyse

### Gewünschter Nutzer-Workflow

In der Speicherbelegung (`Disk usage`) möchte man nicht nur löschen (`F8`), sondern große Ordner oder Dateien in der Listenansicht (z. B. links `bak`, 3,9 GB / 93 %) auswählen und auf ein anderes Laufwerk / in einen Zielordner auf der gegenüberliegenden Seite (im Screenshot rechts der Tab `Audiobooks` unter `/Volumes/Media/music/Audiobooks`) per **Move** (`F6`, Button-Leiste, Kontextmenü oder Drag & Drop) verschieben.

### Ursache im aktuellen Code (Design 033 E1)

In [`src/app/features/workspace/file-panel.ts`](../src/app/features/workspace/file-panel.ts) (`chartScan`, Z. 105–111) und [`file-panel.html`](../src/app/features/workspace/file-panel.html) (Z. 400–403) wird die Grafikansicht (`<app-disk-usage-chart class="quick">`) bisher nach dem Vorbild der Schnellvorschau (`Ctrl+Q`, 010 E4) als **automatisches Overlay im gegenüberliegenden Panel** gerendert, sobald die Seite mit dem Disk-Usage-Tab aktiv ist:

```ts
protected readonly chartScan = computed(() => {
  const other = otherSide(this.side());
  if (this.ws.activeSide() !== other) {
    return null;
  }
  return this.usage.stateOn(other)?.scanId ?? null;
});
```

Während die Schnellvorschau (`QuickViewStore.on`) vom Nutzer explizit per `Ctrl+Q` ein- und ausgeschaltet wird, greift `chartScan` **zwangsweise und unabschaltbar** bei jedem Fokuswechsel zurück auf den Disk-Usage-Tab. Das erzeugt im Dual-Pane-Betrieb vier konkrete UI-Probleme (siehe [`047-speicherbelegung-diagramm-tab-beispiel.jpg`](047-speicherbelegung-diagramm-tab-beispiel.jpg)):

1. **Ziel-Tab verschwindet beim Selektieren für Move/Copy (`F5`/`F6`):**
   Wechselt der Nutzer nach rechts, um den Ziel-Tab (`Audiobooks`) und Zielordner einzustellen, ist der Ordner nur so lange sichtbar, wie der Fokus rechts liegt. Sobald der Nutzer links in der Disk-Usage-Liste den zu verschiebenden Ordner (`bak`) anklickt oder mit `Tab` nach links wechselt, wird `left` wieder `activeSide` – und rechts legt sich sofort wieder die Rings-Ansicht über den Ziel-Tab. Man sieht beim Auslösen von `Move`/`Copy` weder den Ziel-Tab-Inhalt noch vorhandene Unterordner („blindes Verschieben“).
2. **Drag & Drop aus Disk Usage in den Zielordner / auf Unterordner ist blockiert:**
   Zieht man `bak` mit der Maus aus der linken Disk-Usage-Liste nach rechts, bleibt `left` aktiv. Rechts liegt `<app-disk-usage-chart class="quick">` (`position: absolute; inset: 0; z-index: 2`) über der versteckten `<app-file-list>` (`visibility: hidden`). `document.elementFromPoint` in `DragStore.targetAt` trifft das SVG-Diagramm statt der `FileList`-Dropzone – ein Ablegen im rechten Ordner oder gezielt auf einem Unterordner dort ist unmöglich.
3. **Widersprüchlicher Panel-Rahmen (Header, Tab-Leiste und Statuszeile lügen über den Inhalt):**
   Auf dem Screenshot zeigt die rechte Seite oben `/Volumes/Media/music/Audiobooks`, in der Tab-Leiste ist `Audiobooks` als aktiv markiert (`aria-selected="true"`), und die Statuszeile meldet `0 B / 0 B in 0 / 0 Files, 0 / 14 Folders · not auto-refreshed (network drive)` – dazwischen zeigt der Panel-Rumpf (`aria-labelledby="fnf-tab-…"`) jedoch `Downloads · 4.3 GB` (Rings) der linken Seite.
4. **Diagramm nicht schließbar & `Ctrl+Q` blockiert:**
   Wer nur mit Größenliste links und Zielordner rechts aufräumen will, kann das Diagramm nicht wegklicken oder schließen; außerdem ist `quickView()` wegen `chartScan() !== null` während Disk Usage dauerhaft abgeschaltet.

## Lösungskonzept: Rings/Tiles-Ansicht (+ Sammelkorb) als eigener Tab

Das Fremd-Overlay `chartScan` im Ziel-Panel entfällt vollständig. Stattdessen wird die Grafikansicht (`<app-disk-usage-chart>`: Ringe/Kacheln, Laufwerksbalken und Sammelkorb „Zum Entfernen markiert“) als **eigener Tab** (`usage-chart:<scanId>`) realisiert:

- **Beim Start von Disk Usage (`Mod+Shift+D` / Laufwerks-Belegung):**
  - Auf der aktiven Seite (`side`, z. B. links) öffnet wie bisher der Listen-Tab (`Belegung: Downloads` / `Disk usage: Downloads`, `usage:<scanId>`) und behält `activeSide` sowie den Tastaturfokus.
  - Auf der gegenüberliegenden Seite (`otherSide(side)`, z. B. rechts) öffnet automatisch der zugehörige Diagramm-Tab (`Diagramm: Downloads` / `Chart: Downloads`, `usage-chart:<scanId>`) und wird dort zum `activeTab` dieser Seite – neben den bestehenden Ordner-Tabs (`Swift`, `Audiobooks`).
  - **Direkt nach dem Start** sieht der Nutzer also unverändert Liste links und Ringe/Kacheln + Sammelkorb rechts nebeneinander – jetzt aber mit konsistentem Header, eigenem Tab-Reiter und passender Statuszeile auf der rechten Seite.
- **Beim Wechsel auf einen Zielordner-Tab für Move / Copy / Drag & Drop:**
  - Klickt der Nutzer rechts auf `Audiobooks` (oder öffnet rechts über `+` / `▾` einen Zielordner), wird `Audiobooks` rechts der `activeTab`.
  - Klickt der Nutzer nun links in der Disk-Usage-Liste auf `bak`, **bleibt rechts `Audiobooks` sichtbar**, weil die rechte Seite nur noch ihren eigenen `activeTab` rendert und nicht mehr von der linken Seite überblendet wird.
  - `F6` (Move), `F5` (Copy), Button-Leiste, Kontextmenü, Drag & Drop direkt in die rechte Dateiliste oder auf einen Unterordner sowie `Ctrl+Q` funktionieren damit ohne Einschränkung.
- **Zurück zur Grafikansicht:**
  - Ein Klick auf den Diagramm-Tab in der Tab-Leiste – oder ein Klick auf einen kompakten Knopf `Diagramm` / `Chart` im Header des Listen-Tabs (bzw. Aktion, falls der Diagramm-Tab inzwischen geschlossen wurde) – holt die Rings/Tiles-Ansicht jederzeit wieder nach vorn.

## Aufgaben

1. **Bestand prüfen & Design (`prompts/047-speicherbelegung-diagramm-tab.design.md` 🛑):**
   - `src/app/features/workspace/file-panel.ts`, `file-panel.html`, `file-panel.css` (`chartScan`, `activate`, `showTab`, Header, Statuszeile, `.quick-on`),
   - `src/app/features/diskusage/usage-rows.ts`, `disk-usage.store.ts` (`start`, Release-Effect auf `ws.searchKeys()`, `stateOn`), `disk-usage-chart.ts` (`side`-Input, `highlight`, `pick`, `up`, `remove`), `disk-usage-actions.ts` (`OFF_IN_USAGE`, `DISK_USAGE_TOGGLE_CHART`),
   - `src/app/features/workspace/workspace.store.ts` (`openSearchTab`, `targetDir`, `actionDir`, `cloneTab`, `toPanelSession`), `tab-bar.ts` / `tab-bar.html` (Tab-Icons, Filter/Hidden, `tabZoneHit`),
   - `src/app/features/ops/ops.store.ts` (`openCopyMove`, `openDelete`, `afterJob`),
   - `scripts/screenshots/scenes.json` (Szene `disk-usage`).

2. **Tab-Schlüssel & Scan-Lebenszyklus (`usage-rows.ts`, `disk-usage.store.ts`):**
   - Eigenen Ergebnis-Präfix `USAGE_CHART_KEY_PREFIX = 'usage-chart:'` mit Helfern `usageChartKey(scanId)`, `isUsageChartKey(key)`, `chartScanIdOf(key)` sowie `anyUsageScanId(key)` (für Listen- **und** Diagramm-Tab) ergänzen.
   - **Freigabe im `DiskUsageStore`:** Einen Scan `id` erst dann per `release(id)` freigeben, wenn in `ws.searchKeys()` weder `usageKey(id)` noch `usageChartKey(id)` vorkommt (oder gemäß Entscheidung E1 beim Schließen des Listen-Tabs mitaufräumen). Das Schließen _nur_ des Diagramm-Tabs darf den Scan des offenen Listen-Tabs keinesfalls freigeben.
   - **Start & Wiederöffnen:**
     - `DiskUsageStore.start(side, …)` öffnet den Listen-Tab auf `side` (`activeSide = side`, Fokus in der Liste) und öffnet auf `otherSide(side)` den Diagramm-Tab (ohne `activeSide` von `side` wegzunehmen). Hat `otherSide` bereits `MAX_TABS` erreicht und ist kein alter Diagramm-Tab wiederverwendbar (E2), schlägt der Scan **nicht** fehl: der Listen-Tab öffnet trotzdem, `jobs.report(...)` informiert kurz.
     - `openOrFocusChart(scanId, fromSide)`: Ist bereits ein Diagramm-Tab für `scanId` auf einer Seite offen, wird er dort zum `activeTab` selektiert; wurde er geschlossen, wird er auf `otherSide(fromSide)` neu geöffnet.

3. **`FilePanel` & `TabBar`: Diagramm als regulärer Tab (`file-panel.ts`, `file-panel.html`, `file-panel.css`, `tab-bar.ts`, `tab-bar.html`):**
   - `chartScan` (Fremd-Overlay aus `otherSide`) entfernen; stattdessen `usageChartScan` ausschließlich aus dem **eigenen** aktiven Tab der Seite (`this.tab().search?.key`) berechnen.
   - `showTab`: Für `isUsageChartKey` kein Ordner-Listing laden und keinen Watcher setzen (`store.leaveResult()`, `store.clearListing()`, `navigationLocked.set(false)`). `<app-file-list>` bleibt wie bisher bei `.quick-on` im DOM (`visibility: hidden`), damit beim Zurückwechseln auf `Audiobooks` kein Neuaufbau der GuiExpert Table stattfindet (`CLAUDE.md` §5).
   - **Panel-Header (`nav.part.header`):**
     - Im **Diagramm-Tab**: Zeigt die Scan-Brotkrumen, Größe, Objekte/Fortschritt, Warnhinweise sowie die Umschalter `[Ringe] [Kacheln]` (`[Rings] [Tiles]`) und `[Stopp]` / `[Neu scannen]` (E3) – niemals den Pfad eines zuvor besuchten Ordner-Tabs.
     - Im **Listen-Tab**: Ergänzt einen kompakten Knopf `[Diagramm]` / `[Chart]` (`aria-pressed="true"`, solange der zugehörige Diagramm-Tab auf einer der beiden Seiten sichtbar aktiv ist), der `openOrFocusChart` aufruft.
   - **`TabBar`:**
     - Eigenes Font-Awesome-4.5-Icon für Disk-Usage-Tabs statt der Such-Lupe `fa-search` (z. B. `fa-pie-chart` für den Diagramm-Tab, `fa-hdd-o` oder `fa-bar-chart` für den Listen-Tab).
     - Im Diagramm-Tab Filter- (`fa-filter`) und Hidden-Schalter (`fa-eye`) deaktivieren bzw. ausblenden, da keine Dateiliste gefiltert wird.
     - `isSearching` / Busy-Spinner am Tab-Reiter auch während eines laufenden `diskUsage`-Scans sauber anzeigen (optional, prüfen).
   - **Statuszeile (`footer.part.status`):** Im Diagramm-Tab eine zum Scan/Sammelkorb passende Zusammenfassung anzeigen (z. B. Korb-Auswahl / Knotengröße, Dateien & Ordner des gezeigten Knotens) statt veralteter Ordnerzahlen oder fremder `watchHint`-Hinweise.
   - **`FilePanel.activate`:** Den alten Workaround `target.closest('app-disk-usage-chart')` aufräumen (das Diagramm verschwindet bei Aktivierung seiner Seite nicht mehr).

4. **`DiskUsageChart` von fester Gegenseite lösen (`disk-usage-chart.ts`):**
   - Den Pflicht-Input `side` entfernen; das Diagramm ermittelt dynamisch (`listSide()`), ob und auf welcher Seite (`'left'` | `'right'`) der zugehörige Listen-Tab `usage:<scanId>` gerade aktiv sichtbar ist. Dadurch bleiben Cursor-Kopplung und Navigation auch nach `Ctrl+U` (`SWAP_PANELS`), `Ctrl+Shift+U` (`SWAP_PANELS_WITH_TABS`) oder Tab-Drag auf die andere Seite (031/040) intakt.
   - `highlight()`: Nutzt `cursorEntry()` von `listSide()` nur dann, wenn dort tatsächlich `usage:<scanId>` aktiv ist (sonst nur `hover()`).
   - `pick(shape)` / `up()`: Navigiert den gemeinsamen `UsageState` (`usage.goTo` / `usage.up`). Ist `listSide()` sichtbar, wandert bei Klick auf eine Datei der Listen-Cursor dorthin und die Liste behält/bekommt den Fokus für nahtlose Tastaturnavigation; ist der Listen-Tab gerade verdeckt (z. B. weil gegenüber der Zielordner-Tab offen ist) oder geschlossen, navigiert das Diagramm eigenständig weiter.
   - Wurde der Scan freigegeben / aus dem LRU verdrängt (`state() === null`), zeigt die Komponente einen klaren Hinweis statt einer leeren Fläche.

5. **Operationen, Zielordner, Tastatur & Sitzung (`ops.store.ts`, `workspace.store.ts`, `disk-usage-actions.ts`, `workspace-actions.ts`):**
   - **Sammelkorb sicher löschen (`Entfernen…` & `F8` / `Shift+F8`):**
     `DiskUsageChart.remove()` darf **nicht** blind `otherSide` aktivieren und dort `OPEN_DELETE_DLG` starten (liegt auf der anderen Seite inzwischen ein normaler Ordner-Tab wie `FilmeOut.nosync`, würde sonst dessen Auswahl gelöscht!). Stattdessen öffnet `OpsStore` gezielt den Löschdialog für den Korb von `scanId` (mit `usage.basket(scanId).effective`, `usage.expected(...)`, `usage.ageMinutes(scanId)` und `usage.afterRemoval(scanId, done)` nach Job-Ende). Das gilt gleichermaßen für den Knopf `Entfernen…` im Korb wie für `F8` / `Shift+F8`, wenn der Diagramm-Tab selbst aktiv ist.
   - **Aktionen im aktiven Diagramm-Tab:** Sinnvolle Aktionen (`NAVIGATE_PARENT` / `Backspace`, `NAVIGATE_BACK`, `NAVIGATE_FORWARD`, `RELOAD_DIR` → `rescan`, `DISK_USAGE_TOGGLE_CHART`, `OPEN_DELETE_DLG` / `DELETE_PERMANENT` bei nicht-leerem Korb, Tab-/Panel-Navigation, `CLOSE_TAB`) funktionieren auch bei Fokus auf dem Diagramm-Tab; unpassende Dateilisten-/Schreibaktionen (`OFF_IN_USAGE` sowie Copy/Move/Markieren ohne Listen-Cursor) sind dort sauber gesperrt. Neue Aktion `DISK_USAGE_SHOW_CHART` in Palette und Menü _Ansicht_ registrieren.
   - **`WorkspaceStore.targetDir(from)` & Zielvorschläge:** Ein Diagramm-Tab besitzt **keinen** Ordnerpfad (`path: null`) – er darf niemals den gescannten Quellordner als `targetDir` liefern und nicht in `tabPaths` des Copy/Move-Dialogs auftauchen. Ist auf der Gegenseite noch der Diagramm-Tab aktiv, während der Nutzer im Listen-Tab `F5`/`F6` drückt, fällt `targetDir(from)` sinnvoll auf den benachbarten / zuletzt genutzten echten Ordner-Tab dieser Seite zurück (E4).
   - **`+` (`cloneTab` / `CLONE_TAB`) auf einem Diagramm-Tab:** Legt keinen zweiten identischen Diagramm-Tab an, sondern öffnet einen normalen Ordner-Tab (vom benachbarten Ordner-Tab der Seite bzw. Home).
   - **Sitzungs-Persistenz (`toPanelSession` in `workspace.store.ts`):** Diagramm-Tabs sind flüchtige Begleit-Tabs eines In-Memory-Scans. Beim Speichern der Sitzung werden sie herausgefiltert und `activeTab` der Seite auf einen verbleibenden echten Tab angepasst (nur falls der Diagramm-Tab der einzige Tab einer Seite wäre, fällt er auf Home / den Scan-Wurzelordner zurück, damit jede Seite mindestens einen Tab behält). So entstehen nach einem Neustart keine überflüssigen Duplikat-Ordner-Tabs auf der Ziel-Seite.

6. **Texte, Screenshots & Doku:**
   - Zweisprachige Texte in `disk-usage-texts.ts` + `disk-usage-texts.de.ts` (Diagramm-Tab-Label, Knopf/Aktion „Diagramm zeigen“, Leerzustand), `catalogs.spec.ts` grün.
   - Screenshot-Szene `disk-usage` in `scripts/screenshots/scenes.json` prüfen.
   - Doku aktualisieren: Hinweis in `prompts/done/033-speicherbelegung.design.md` (E1 erweitert/abgelöst durch 047), `docs/architecture.md`, `docs/features.md`, `docs/roadmap.md`, `CLAUDE.md`, `prompts/README.md`.

## Entscheidungsfragen fürs Design (Phase 1 🛑)

- **E1 Schließen des Listen-Tabs:** Was passiert, wenn der Nutzer den Listen-Tab (`Belegung: <Name>`) schließt, während der Diagramm-Tab noch offen ist?
  _(a)_ Diagramm-Tab bleibt eigenständig nutzbar (mit Knopf `[Liste]`, Scan wird erst freigegeben, wenn **beide** Tabs geschlossen sind) oder _(b)_ Schließen des Listen-Tabs schließt den zugehörigen Diagramm-Tab automatisch mit (während das Schließen des Diagramm-Tabs allein den Listen-Tab offen lässt)?
- **E2 Mehrere Scans nacheinander:** Wenn bereits ein Diagramm-Tab eines älteren Scans offen ist und ein neuer Disk-Usage-Scan gestartet wird – vorhandenen Diagramm-Tab auf der Gegenseite wiederverwenden (`reuse`) oder einen weiteren Diagramm-Tab daneben öffnen?
- **E3 Kopfzeile im Diagramm-Tab:** Brotkrumen + Größe + `[Ringe] [Kacheln]` + `[Stopp]`/`[Neu scannen]` vollständig in die obere Panel-Headerzeile (`nav.part.header`) legen (symmetrisch zum Listen-Tab, kein doppelter `.head`-Balken im Diagramm, mehr Platz fürs SVG) oder zweizeilig lassen?
- **E4 `targetDir()` & Ordner-Navigation (`▾`, `Ctrl+L`, `Ctrl+←/→`) bei aktivem Diagramm-Tab:** Fällt `ws.targetDir()` auf den letzten/benachbarten echten Ordner-Tab der Gegenseite zurück, und wechselt/öffnet eine Ordner-Navigation (`requestNavigate`) auf einer Seite mit aktivem Diagramm-Tab in einen Ordner-Tab, statt den Diagramm-Tab zu überschreiben?

## Akzeptanzkriterien

1. **Gewohnter Sofort-Überblick beim Start:** Rechts sind `Swift` und `Audiobooks` (`/Volumes/Media/music/Audiobooks`, aktiv) offen; links wird `Disk usage` auf `Downloads` gestartet → links öffnet und fokussiert `Belegung: Downloads`, rechts öffnet und zeigt ein eigener Tab `Diagramm: Downloads` (`Chart: Downloads`) Ringe/Kacheln + Sammelkorb; `Swift` und `Audiobooks` bleiben als Tabs in der rechten Tab-Leiste erhalten.
2. **Move-Workflow mit sichtbarem Zielordner (Kernproblem aus Screenshot):** Klickt der Nutzer rechts auf den Tab `Audiobooks` und anschließend links in der Disk-Usage-Liste auf `bak` (3,9 GB), **bleibt rechts der Tab `Audiobooks` samt Dateiliste sichtbar** (kein Rücksprung auf die Rings-Ansicht). `F6` (`Move`) schlägt `/Volumes/Media/music/Audiobooks` vor; nach dem Job ist `bak` links aus dem Belegungs-Baum herausgerechnet (Summen korrigiert) und rechts in `Audiobooks` zu sehen.
3. **Drag & Drop in den Zielordner:** Bei rechts aktivem Ordner-Tab `Audiobooks` lässt sich ein Eintrag aus der linken Disk-Usage-Liste per Maus direkt in die rechte Dateiliste oder auf einen Unterordner darin ziehen und öffnet den Kopieren/Verschieben-Dialog mit diesem Ziel.
4. **Ehrlicher Panel-Rahmen:** Ist der Diagramm-Tab aktiv, zeigen Header, aktiver Tab-Reiter und Statuszeile dieser Seite ausschließlich Daten des Scans/Diagramms – nie den Pfad (`/Volumes/…/Audiobooks`) oder `watchHint` eines anderen Ordner-Tabs.
5. **Schließen & Wiederöffnen des Diagramm-Tabs:** Schließt der Nutzer den Diagramm-Tab (`−`, Mittelklick, `Shift+Klick`), bleibt der Listen-Tab samt Scan aktiv; über den Knopf `Diagramm` / `Chart` im Header des Listen-Tabs (bzw. Aktion) lässt sich der Diagramm-Tab jederzeit wieder öffnen bzw. nach vorn holen.
6. **Sammelkorb-Löschen ohne Seiten-Verwechslung:** Ist auf einer Seite ein normaler Ordner-Tab aktiv und auf der anderen Seite der Diagramm-Tab mit gefülltem Sammelkorb, löscht `Entfernen…` im Korb (ebenso `F8` im aktiven Diagramm-Tab) ausschließlich die Korb-Einträge des Scans (mit `expected` und Alters-Hinweis), niemals Einträge des normalen Ordner-Tabs.
7. **Tab-Tausch & Sitzung:** `Ctrl+U`, `Ctrl+Shift+U` und das Ziehen des Diagramm-Tabs auf die andere Seite erhalten die Kopplung zwischen Liste und Diagramm; `+` auf dem Diagramm-Tab öffnet einen echten Ordner-Tab statt eines Diagramm-Klons; ein App-Neustart hinterlässt auf der Ziel-Seite keinen überflüssigen Duplikat-Ordner-Tab aus dem Diagramm-Tab.

## Tests

- **Frontend (Vitest):**
  - `usage-rows` / Schlüssel-Helfer (`isUsageKey`, `isUsageChartKey`, `anyUsageScanId`).
  - `disk-usage.store.spec.ts`: Start legt Listen-Tab auf `side` und Diagramm-Tab auf `otherSide` an (`activeSide` bleibt `side`); Schließen nur des Diagramm-Tabs gibt den Scan **nicht** frei; `openOrFocusChart` fokussiert vorhandenen bzw. öffnet geschlossenen Diagramm-Tab neu; Verhalten bei `MAX_TABS` auf `otherSide`.
  - `file-panel.spec.ts`: Wechsel auf Ordner-Tab rechts + Aktivieren des Disk-Usage-Listen-Tabs links lässt rechts den Ordner-Tab sichtbar (Regressionstest für Marcs Bug); Header und Statuszeile im Diagramm-Tab zeigen keine Daten des vorherigen Ordner-Tabs; Cursor-Highlight und Klick-Navigation im Diagramm funktionieren sowohl mit sichtbarem als auch mit verdecktem Listen-Tab sowie nach `swapActiveTabs()` / `swapSides()`.
  - `workspace.store.spec.ts`: `toPanelSession` filtert Diagramm-Tabs heraus und korrigiert `activeTab` (inkl. Grenzfall „einziger Tab einer Seite“); `targetDir` liefert bei aktivem Diagramm-Tab niemals den gescannten Quellordner, sondern fällt sauber zurück; `cloneTab` auf Diagramm-Tab erzeugt Ordner-Tab.
  - `ops.spec.ts`: `Entfernen…` / `openDelete` aus dem Diagramm-Tab löscht den Scan-Korb mit `expected` + `scanAgeMin` + `afterRemoval`, auch wenn gegenüber ein normaler Ordner-Tab aktiv ist.
  - `catalogs.spec.ts`: vollständige Übersetzung en/de.
- **E2E unter Xvfb:**
  - Marcs Szenario durchspielen: Rechts Zielordner-Tab öffnen, links Ordner per `Mod+Shift+D` scannen → rechts erscheint Diagramm-Tab → rechts zurück auf Zielordner-Tab klicken → links großen Unterordner markieren/selektieren → rechts bleibt Zielordner sichtbar → `F6` Move + Drag & Drop prüfen → Diagramm-Tab schließen und über Header-Knopf wieder öffnen.
  - Screenshot-Szene `disk-usage` prüfen.

## Nicht in diesem Prompt

- Änderungen am Rust-Backend (`src-tauri/src/disk_usage/` bleibt unverändert).
- Umbau von `QuickView` (`010`, bewusst per `Ctrl+Q` schaltbar) oder `DuplicateGroupView` (`042`, eigener Dedupe-Workflow; bei Bedarf separater Folge-Prompt).
