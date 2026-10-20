# Prompt 031: Drag & Drop erweitert, Teil 2 – Tabs ziehen, Verknüpfungen, Verschieben ins System

> **Slug:** `drag-tabs-links` · **Braucht:** 004 (Tabs), 005/006 (Jobs, Kopieren/Verschieben-Dialog), 012 (Drag & Drop
> in der App), 028 (Ziehen ins System) · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/028-drag-ins-system.design.md` (§2, §7, §8) und
> `prompts/done/012-ueberwachung-drag-drop.design.md` (E5–E7). Anlass: „Rest von 028“ – `TODO.md` §4 („Offen:
> Verknüpfung per Drag, Tabs zwischen den Seiten ziehen, Verschieben ins System“) und die legacy/mr-TODO
> „Tab-Drag&Drop“. Marc hat am 20.10.2026 den Rahmen festgelegt und die Umsetzung ohne Freigabe-Halt beauftragt.

## Ziel

1. Tabs lassen sich mit der Maus in der Tab-Leiste umsortieren und auf die andere Seite ziehen (verschieben; mit
   Modifier kopieren). Dasselbe geht per Tastatur über Aktionen.
2. Ziehen mit einem Modifier legt **Verknüpfungen** (symbolische Links) an statt zu kopieren; dazu eine Aktion
   „Verknüpfung anlegen…“ mit Dialog (TC: Strg+Umschalt+F5). Ausgeführt als Job-Art `link` mit Validierung in Rust.
3. **Verschieben ins System** (028 E3) neu bewerten und entscheiden.

## Bestand

- `WorkspaceStore`: Tabs je Seite (per Id), `moveTab(side, i, ±1)`, `moveTabToOther`, `cloneTabToOther`; das
  Kontextmenü der Tab-Leiste bietet diese Funktionen schon an, Aktionen/Kürzel dafür fehlen. Sitzung speichert
  `panels` entprellt (Snapshot).
- `TabBar`: APG-Tabliste (Roving Focus), Tab-Köpfe sind Drop-Ziele für Dateien (028 §8).
- `DragStore`/`file-list.ts`: Pointer-Drag (012 E5), `DragKind = 'copy' | 'move'`, Verknüpfung „reserviert“.
- `OpsStore.openCopyMoveFor` + `CopyMoveDialog` (Ziel, Vorschläge, Konflikte); Job-Engine (`JobSpec`).
- `start_os_drag` (028): nur `DragMode::Copy`.

## Aufgaben

1. **Tabs ziehen:** eigener Pointer-Drag in der Tab-Leiste (Schwelle, Esc, Einfügemarke), Ziel = Position in einer
   der beiden Tab-Leisten oder die andere Seite (ans Ende). Verschieben; mit Modifier (Plattformkonvention) kopieren.
   Letzter Tab einer Seite bleibt. Ergebnis-Tabs (009) und Archiv-Tabs (016) ziehen wie andere Tabs. Aktionen für
   Tab nach links/rechts, auf die andere Seite, auf die andere Seite kopieren. Sitzung speichert die Ordnung.
2. **Verknüpfung:** `DragKind` `link` (Modifier je OS), Dialog „Verknüpfung anlegen“ (Ziel, Name bei einem Eintrag,
   relativ/absolut, bei vorhandenem Namen), Job-Art `link`: nie überschreiben, Archivpfade abgelehnt, Windows ohne
   Recht → eigener Fehlercode. Aktion `OPEN_LINK_DLG`.
3. **Verschieben ins System:** Entscheidung mit Begründung im Design und in `docs/feature-parity.md`.

## Akzeptanzkriterien

- Tab innerhalb der Leiste an eine andere Stelle ziehen → neue Reihenfolge, bleibt nach Neustart.
- Tab auf die andere Seite ziehen → dort an der Einfügemarke, ausgewählt; mit Modifier bleibt das Original.
- Den einzigen Tab einer Seite wegziehen geht nicht (Kopieren schon); Esc bricht ab, Klick ohne Bewegung wählt nur.
- Tastatur: Aktionen verschieben den aktiven Tab (auch auf die andere Seite); Fokus bleibt auf dem Tab.
- Datei mit Link-Modifier auf die andere Seite ziehen → Dialog „Verknüpfung anlegen“ → Link entsteht; vorhandener Name
  wird nie überschrieben; relativer Link zeigt auf dieselbe Datei oder scheitert mit klarer Meldung.
- Aus einem Archiv keine Verknüpfung; in ein Archiv keine Verknüpfung.

## Tests

- Rust: Job `link` (absolut, relativ, Unicode/Leerzeichen, Ordner, dangling Quelle, Konflikt nie überschreiben,
  „beide behalten“, Archivpfad, Ziel kein Ordner, relativer Link über einen verlinkten Ordner), reine Funktion für den
  relativen Pfad.
- Frontend: Tab-Drag-Logik (Einfügeposition, Regeln), `WorkspaceStore.placeTab`, Aktionen, Tab-Leiste (Marke,
  Esc, Modifier), `dragKind` mit Link, `OpsStore`/Dialog für Links.
- E2E unter Xvfb: Tab umsortieren, auf andere Seite ziehen (mit/ohne Strg), Neustart; Link per Drag und per Aktion.
