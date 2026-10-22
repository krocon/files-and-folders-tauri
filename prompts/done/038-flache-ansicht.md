# Prompt 038: Flache Ansicht (alle Dateien unterhalb eines Ordners)

> **Slug:** `flache-ansicht` · **Braucht:** 001 (Dateiliste), 003 (Navigation, Filter), 005/006 (Jobs, Operationen),
> 009 (Ergebnis-Tabs der Suche) · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/009-suche.design.md` (Ergebnis-Tabs, `SearchStore`,
> gebündelte Treffer, Operationen auf Treffern). Vorbild: Total Commander „Flache Ansicht“ (Strg+B).

## Ziel

Ein Tastendruck zeigt im aktiven Tab alle Dateien (optional auch Ordner) unterhalb des aktuellen Ordners in einer
Liste – mit relativem Pfad als zusätzlicher Spalte. Auf dieser Liste funktionieren Markieren, Kopieren, Verschieben,
Löschen, Umbenennen, Multi-Rename, F3, Packen usw. wie in einem normalen Ordner. Nochmals Strg+B kehrt zurück.

## Aufgaben

1. **Entscheidung im Design:** eigener Tab-Typ (wie Ergebnis-Tabs `search:<id>`) oder Modus des bestehenden Tabs.
   Empfehlung prüfen: Wiederverwendung der Ergebnis-Tab-Mechanik (Treffer = alle Einträge), aber als Umschalter im
   selben Tab, damit Zurück/Pfad stimmen.
2. **Rust:** Auflistung als Job (Suche ohne Kriterien reicht vermutlich: zyklensicher, ohne Symlink-Folgen,
   Obergrenze + Hinweis bei sehr vielen Einträgen, abbrechbar, gebündelt).
3. **Liste:** Spalte „Pfad“ (relativ), Sortierung nach Pfad/Name/Größe/Datum, Filter und Hidden gelten, Statuszeile
   zählt richtig; Option „Ordner zeigen“.
4. **Operationen:** alle Aktionen, die auf Ergebnis-Tabs schon gehen, gehen hier auch; was nicht passt (z. B. „Ordner
   anlegen“), ist per Veto aus. Nach Operationen wird die Liste aufgefrischt (Watcher sieht nur den Wurzelordner –
   Design entscheidet: rekursiver Watch oder Auffrischen nach Jobs).
5. Aktion `TOGGLE_FLAT_VIEW` (Strg+B / macOS im Design), Menü Ansicht, Anzeige im Tab-Titel/Pfadkopf.

## Akzeptanzkriterien

- Ordner mit 3 Ebenen → Strg+B zeigt alle Dateien mit relativen Pfaden; nochmals Strg+B → normaler Ordner, Cursor dort,
  wo er war.
- Markierte Dateien aus mehreren Unterordnern per F5 in einen Zielordner kopieren → Konflikte gleichnamiger Dateien
  werden gefragt.
- Multi-Rename auf der flachen Liste benennt in den jeweiligen Unterordnern um.
- 100 000 Dateien → bleibt bedienbar, Hinweis bei Obergrenze, Abbruch mit Esc.
- Symlink-Zyklus → keine Endlosschleife.

## Tests

- Rust: Auflistung (Tiefe, Zyklen, Grenzen, Abbruch).
- Frontend: Umschalten und Zurück, Spalten, Vetos, Auffrischen nach Jobs (Fakes).
- E2E unter Xvfb.
