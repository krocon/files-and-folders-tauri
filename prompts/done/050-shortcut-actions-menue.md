# Prompt 050: Sinnvolles Tastenkürzel für das Actions-Menü (mit Badge am Knopf)

> **Slug:** `shortcut-actions-menue` · **Braucht:** 002 (Aktionssystem, Keymaps je OS), 018 J7 (`OPEN_ACTIONS_MENU`), 020 (Actions-Menü), 026 (mr-Import der Kürzel), 032 (Starter-Menü `Alt+S` mit Badge) · **Umfang:** S (Keymaps + Button-Leiste, kein Rust)
> Lies zuerst `prompts/000-arbeitsweise.md`, `prompts/done/020-*.design.md` und `prompts/done/032-*.design.md` (Badge `startShortcut`, `Alt+S` unter macOS).
> Anlass (Marc, 31.10.2026, Screenshot [`050-shortcut-actions-menue-beispiel.png`](050-shortcut-actions-menue-beispiel.png)): Button-Leiste unten rechts – `[⌥S Start ▴] [Actions ▴] [⚙ Tasks] [🖌] [⌨]`. „Start“ zeigt sein Kürzel, „Actions“ nicht.

## Problem

`OPEN_ACTIONS_MENU` hat heute nur die von mr übernommenen Kürzel (feature-parity J7):

| OS            | heute               | Problem                                                                 |
|---------------|---------------------|-------------------------------------------------------------------------|
| macOS         | `Ctrl+K Ctrl+M`     | Akkord, kaum zu merken, auf dem Knopf nicht als Badge darstellbar        |
| Windows/Linux | `Mod+F12`           | weit weg, auf Laptops oft nur mit `Fn`; ebenfalls ohne Badge am Knopf    |

Der Knopf „Actions ▴“ zeigt – anders als „Start ▴“ (`Alt+S`, 032) – kein Kürzel, und es gibt kein eingängiges,
symmetrisches Kürzel. Das Menü ist der Einstieg in alle Werkzeuge; es soll ohne Maus genauso schnell erreichbar sein.

## Ziel

Ein **kurzes, merkbares Kürzel auf allen drei OS**, als Badge am Knopf „Actions ▴“ (wie bei „Start“), die alten
mr-Kürzel bleiben als **zusätzliche** Belegung erhalten (mr-Gewohnheit, Import 026).

## Vorschlag (im Design prüfen, Phase 1 🛑 kurz)

- **Empfehlung: `Alt+A`** (macOS `⌥A`) – symmetrisch zu `Alt+S` = Start, „A“ wie Actions; laut Keymaps auf allen drei
  OS frei (belegt sind nur `Mod+Alt+A` unter Win/Linux). Liste: `["Alt+A", "Mod+F12"]` bzw. macOS
  `["Alt+A", "Ctrl+K Ctrl+M"]`. Das erste Kürzel ist das angezeigte (Badge, Palette, Menü).
- Zu prüfen, bevor das feststeht:
  - **macOS:** `⌥A` erzeugt im Textfeld `å` – wie bei `⌥S` = `ß`. Gleiche Behandlung wie 032 (Erkennung über
    `e.code`, nicht in Eingabefeldern/Dialogen auslösen). Kollision mit Systemkürzeln/Eingabemethoden?
  - **Windows/Linux:** `Alt+<Buchstabe>` kann mit Zugriffstasten der HTML-Menüleiste (`MenuBar`, 014) oder nativen
    Mnemonics kollidieren (`Alt+M` = `FOCUS_MENU_BAR`). Gibt es Mnemonics mit `A`? Unter GTK/WebKit testen.
  - **Shell-Zeile (021) und Rename-Editor (F2):** `Alt+A` darf dort nicht stören (Wortsprung o. ä. in Shells/Readline?).
  - Konflikt mit GuiExpert-`ShortcutService` (CLAUDE.md §5): nicht gemappt → bubbelt, sollte passen.
  - Alternativen, falls `Alt+A` scheitert: `F9` (TC: Menü aktivieren; auf Win/Linux frei? – prüfen), `Alt+F12`, oder
    `Mod+Alt+A` unter macOS. Entscheidung mit kurzer Begründung in `docs/architecture.md` („Entscheidungen“).
- `KeyboardDispatcher` / Keymap-Override: Konfliktprüfung des Kürzel-Dialogs (002) muss das neue Kürzel kennen; Nutzer
  mit eigener Belegung von `Alt+A` (Override-Datei) behalten ihre Belegung – keine stille Umleitung.

## Aufgaben

1. Keymaps `src/app/core/actions/keymaps/{macos,windows,linux}.json`: `OPEN_ACTIONS_MENU` um das neue Kürzel ergänzen
   (vorne).
2. Button-Leiste (`features/workspace/button-bar/button-bar.ts`): Badge + `title` + `aria-keyshortcuts` für „Actions ▴“
   genau wie `startShortcut`/`startTitle` (ein gemeinsamer Helfer statt Kopie, z. B. `menuShortcut(id)`); Badge nur,
   wenn das erste Kürzel kein Akkord ist (sonst kein Badge, aber Tooltip).
3. Öffnen per Kürzel: Fokus auf den ersten Eintrag des Actions-Menüs (APG Menu Button), `Esc` schließt und gibt den
   Fokus an die Liste zurück; erneutes `Alt+A` bei offenem Menü schließt es (wie Start – prüfen, ob 032 das so macht,
   und angleichen).
4. mr-Import (026, `mr_import/keys.rs`): unverändert lassen, aber prüfen, dass importierte `ctrl+f12`/`ctrl+k ctrl+m`
   das neue Default-Kürzel nicht entfernen (Import ersetzt nur, was mr explizit belegt).
5. Texte: Menü „Ansicht“/Palette zeigen das Kürzel automatisch über `shortcutLabel` – prüfen. Hilfe/Kürzelübersicht
   (`⌨`-Knopf) zeigt den neuen Eintrag.
6. Doku: `docs/feature-parity.md` (Zeile „Actions-Menü öffnen“, Hinweis 050), README-Kürzeltabelle, falls vorhanden.

## Akzeptanzkriterien

1. `Alt+A` (bzw. die im Design gewählte Taste) öffnet auf macOS, Windows und Linux das Actions-Menü aus der Dateiliste
   heraus; Pfeiltasten/Enter/Esc funktionieren sofort.
2. Der Knopf „Actions ▴“ zeigt das Kürzel als Badge (`⌥A` unter macOS, `Alt+A` sonst) im selben Stil wie „Start ▴“;
   Tooltip „Actions (⌥A)“, `aria-keyshortcuts` gesetzt.
3. `Mod+F12` (Win/Linux) und `Ctrl+K Ctrl+M` (macOS) funktionieren weiterhin.
4. In Textfeldern (Pfadfeld, Dialoge, Shell-Zeile, Rename-Editor) löst `Alt+A` nicht aus und tippt dort normal
   (macOS `å`).
5. Eine eigene Belegung von `Alt+A` im Kürzel-Dialog hat Vorrang; der Konflikt wird dort wie andere Konflikte gemeldet.

## Tests

- `button-bar.spec.ts`: Badge/Tooltip/`aria-keyshortcuts` für Actions je Plattform; Akkord → kein Badge.
- Keymap-Specs: `OPEN_ACTIONS_MENU` hat auf allen OS das neue Kürzel an erster Stelle; keine Doppelbelegung in einer
  Keymap (vorhandener Konflikt-Test sollte das abdecken – sonst ergänzen).
- `keyboard-dispatcher`-Spec: `Alt+A` mit `e.code = 'KeyA'` und `e.key = 'å'` (macOS) löst aus; in `input` nicht.
- E2E unter Xvfb: `Alt+A` öffnet das Menü, Screenshot der Button-Leiste mit beiden Badges.
- `pnpm check` grün.

## Nicht in diesem Prompt

- Neue Einträge oder Umbau des Actions-Menüs selbst (020).
- Kürzel für die übrigen Knöpfe (Tasks, 🖌, ⌨) – höchstens als Vorschlag im Bericht.
