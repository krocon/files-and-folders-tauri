# Prompt 056: Die Funktionen des Actions-Menüs im App-Hauptmenü auffindbar machen

> **Slug:** `hauptmenue-actions` · **Braucht:** 014 (Menüleiste nativ/HTML aus einem Modell), 020 (Actions-Menü), 015 (Texte en/de), 054/055 (Wording, Ellipse) · **Umfang:** S (reines Frontend: `menu-model.ts`, Texte, Specs; Rust nur, falls das native Menü Untermenü-Tiefe/Anzahl begrenzt)
> Lies zuerst `prompts/000-arbeitsweise.md`, `prompts/done/014-*.design.md` (E8 Menüleiste) und `prompts/done/020-*.design.md`
> (E1 Spalten des Actions-Menüs). Kurzes Design-Dokument `prompts/056-hauptmenue-actions.design.md` 🛑 (Struktur-Entwurf
> als Baum, en + de) – **vor** der Umsetzung Marc zeigen.

## Auftrag (Marc, 01.11.2026)

Die vielen Actions im Actions-Menü (Button „Actions ▴“ unten) sollen sich auch im App-Hauptmenü (macOS nativ, Windows/
Linux HTML-Menüleiste) wiederfinden.

## Befund (Code gelesen, 01.11.2026)

- **Formal ist schon alles da:** Alle 54 Einträge aus `ACTIONS_MENU_COLUMNS` (`features/actions/actions-menu-def.ts`)
  kommen auch in `MENU_BAR` (`features/menus/menu-model.ts`) vor; `menu-model.spec.ts` › „has every action of the
  catalog in the menu bar“ sichert sogar den ganzen Katalog ab (Ausnahmen u. a. `OPEN_ACTIONS_MENU` selbst).
- **Gefühlt fehlen sie trotzdem**, weil man sie dort nicht wiederfindet:
  - **Datei/File** ist eine flache Liste mit ~37 Einträgen in 4 Gruppen: Öffnen, Anlegen, Kopieren/Verschieben/Löschen
    **und** alle Werkzeuge (Multi-Rename, Gruppieren, Serien, Aufräumen, Packen/Entpacken, Dubletten, Vergleichen,
    Synchronisieren, Prüfsummen ×3, Speicherbelegung ×2) **und** Attribute. Auf einem 13"-Bildschirm scrollt das.
  - Die Gruppen des Actions-Menüs (Spalte 1 Ansicht/Zwischenablage, 2 Suchen/Markieren/Navigation/Panels/Tabs, 3 Datei-
    operationen + Werkzeuge, 4 Konfiguration) sind auf Datei/Bearbeiten/Ansicht/Gehe zu/Werkzeuge/Fenster verteilt –
    wer das Actions-Menü kennt, erkennt das Hauptmenü nicht wieder.
  - Die Bezeichnungen weichen ab: Actions-Menü nutzt eigene Kurzlabels (`actions-texts.ts`, mr-Wortlaut, z. B. „Change
    Dir…“, „Enhance Selection“, „Clean Folders…“), das Hauptmenü die Katalog-Labels (`action-catalog.ts`: „Go to path…“,
    …). Dieselbe Funktion heißt an zwei Stellen verschieden → man sucht vergeblich.
  - „Werkzeuge/Tools“ enthält Suchen, externe Tools und Konfiguration – aber nicht die Datei-Werkzeuge (die stehen
    unter Datei).
- **Zuerst bei Marc nachfragen** (Phase 1, eine Frage): Welche Einträge hat er konkret vermisst, und auf welchem OS
  (macOS nativ)? Falls dort Einträge **wirklich fehlen** (z. B. das native Menü nicht aktualisiert, `nativeLabel`
  kürzt, Untermenü fehlt), ist das ein Bug → roter Test zuerst, dann beheben – unabhängig vom Umbau unten.

## Lösungsrichtung (im Design wählen)

- **A – Hauptmenü neu gliedern nach Total-Commander-Vorbild** (TC: Dateien · Markieren · Befehle · Netz · Anzeige ·
  Konfiguration · Starter):
  - **Datei** nur noch Öffnen/Ansehen/Bearbeiten, Anlegen, Kopieren/Verschieben/Verknüpfen/Umbenennen/Löschen,
    Packen/Entpacken, Attribute.
  - Neues Top-Menü **„Befehle“/„Commands“** (zwischen Gehe zu und Werkzeuge) mit den Datei-Werkzeugen in Gruppen:
    Umbenennen & Ordnen (Multi-Rename, Rückgängig, Mehrere Ordner, Gruppieren, Serien, Ordner aufräumen) · Vergleichen
    (Dateien, Ordner, Synchronisieren) · Prüfen (Dubletten, Prüfsummen ×3, Speicherbelegung ×2) · Suchen (Suchen,
    Suche wiederholen, Ordner-Finder, Befehlspalette).
  - **Werkzeuge** → **„Konfiguration“/„Settings“**-artig: Einstellungen, Farbschemata, Buttons, Tools, Starter,
    Dateitypen, Kürzel, Import alter Konfiguration (entspricht Spalte 4 des Actions-Menüs). Externe Tools („Mit Tool
    öffnen“) als Untermenü bei Datei oder Befehle.
  - Bearbeiten (macOS: nativ Undo/Cut/Copy/Paste bleibt) = Markieren + „Kopieren als“ – wie heute.
- **B – Zusätzliches Top-Menü „Aktionen“/„Actions“**, das `ACTIONS_MENU_COLUMNS` 1:1 spiegelt (Spalten = Gruppen mit
  Trennern oder Untermenüs, gleiche Labels). Billig und garantiert wiedererkennbar, aber jede Funktion steht doppelt
  im Hauptmenü und das Menü ist sehr lang (54 Einträge).
- **C – A + gemeinsame Quelle:** Hauptmenü nach A; das Actions-Menü wird aus denselben Gruppen abgeleitet (oder die
  Gruppen beider Menüs sind in einem Modell definiert), damit sie nie wieder auseinanderlaufen.
- **Empfehlung: A**, ergänzt um **einheitliche Labels**: Actions-Menü und Hauptmenü zeigen für dieselbe Aktion dasselbe
  Wort (Katalog-Label als Quelle; mr-Kurzlabels nur, wo Marc sie ausdrücklich behalten will – Liste im Design). Dann
  findet man „Clean Folders…“ im Hauptmenü unter genau diesem Namen. B nur, falls Marc den 1:1-Spiegel ausdrücklich will.

## Aufgaben

1. Rückfrage an Marc (s. Befund), ggf. Bug beheben.
2. Design: Baum der neuen Menüleiste (en/de), Zuordnungstabelle Actions-Menü-Spalte → Hauptmenü-Ort, Label-
   Vereinheitlichung (welche mr-Labels bleiben), Länge je Menü (Ziel: kein Menü > ~25 Einträge ohne Untermenü).
3. `menu-model.ts` (`MENU_BAR`) umbauen; neue Top-Menü-Texte in `menu-texts.ts` + `.de.ts`; Untermenüs über das
   vorhandene `{ sub, items }`. macOS-Eigenheiten beachten (App-Menü mit Einstellungen/Kürzeln, `macosOnly`/`when`).
   Native Spec (`toNativeSpec`) und HTML-`MenuBar` funktionieren unverändert; Kürzel als Accelerators bleiben.
4. Neuer Eintrag **„Actions-Menü öffnen“** (`OPEN_ACTIONS_MENU`, Kürzel aus 050) z. B. unter Ansicht oder Hilfe – heute
   aus dem Hauptmenü ausgenommen; Ausnahme in `menu-model.spec.ts` entfernen, falls gewählt.
5. **Regressionstest:** jede Id aus `ACTIONS_MENU_COLUMNS` (außer `'-'`) steht im Hauptmenü **und** trägt dort dasselbe
   Label wie im Actions-Menü (bzw. die im Design erlaubten Ausnahmen); keine Id doppelt in derselben Top-Menü-Ebene
   (außer bewusst, z. B. Befehlspalette unter Gehe zu und Hilfe).
6. Doku: `docs/ui-layout.md` (Menüleiste), `docs/feature-parity.md` (Menü-Spalte), README-Abschnitt Bedienung,
   Screenshot-Szene `menu-bar` (falls vorhanden, sonst anlegen; Windows/Linux-HTML-Menü) prüfen.

## Akzeptanzkriterien

1. Jede Funktion des Actions-Menüs ist im Hauptmenü unter **demselben Namen** an einer erwartbaren Stelle zu finden
   (Marc prüft mit seiner Liste aus Aufgabe 1).
2. Kein Top-Menü ist ohne Untermenüs länger als ~25 Einträge; „Datei“ enthält keine Analyse-/Ordnungswerkzeuge mehr
   (bei Variante A).
3. macOS: natives Menü inkl. App-Menü, Dienste, Fenster-Einträge unverändert korrekt; Windows/Linux: HTML-Menüleiste
   mit Tastaturbedienung (`Alt+M`, Pfeile) wie bisher.
4. Kürzel werden in beiden Menüs angezeigt; Aktivierung/Deaktivierung (z. B. kein Ordner, Dialog offen) wie bisher.
5. Die Specs „every action in the menu bar“ und der neue Spiegel-/Label-Test sind grün.

## Tests

- `menu-model.spec.ts`: Struktur-Snapshot pro OS, Spiegel-/Label-Test (Aufgabe 5), Untermenü-Tiefe im native Spec.
- `menus.spec.ts`: HTML-Menüleiste öffnet neue Top-Menüs per Tastatur.
- `catalogs.spec.ts` grün; `pnpm check` grün.
- E2E unter Xvfb (Linux-HTML-Menü) + Screenshot; macOS-Natives bei Marc.

## Nicht in diesem Prompt

- Neue Funktionen; Umbau der Spalten des Actions-Menüs selbst (außer Labels, falls im Design so entschieden).
- Kontextmenüs der Dateiliste/Tabs (051/052).
