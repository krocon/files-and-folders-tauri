# Prompt 012: Verzeichnis-Überwachung und Drag & Drop

> **Slug:** `ueberwachung-drag-drop` · **Braucht:** 006 · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: `docs/legacy-analysis.md` §1.1 (Listing-Cache 120 s),
> §1.2 (Event-Cache), §3 (Drop-Dialog „not implemented“).

## Ziel

Panels aktualisieren sich von selbst, wenn sich Dateien ändern (auch durch andere Programme), ohne Cursor,
Markierung oder Scrollposition zu verlieren. Dateien lassen sich per Drag & Drop zwischen den Panels und mit dem
Betriebssystem austauschen.

## Aufgaben – Überwachung

1. Rust: Watcher je sichtbarem Ordner (Crate `notify` o. ä., begründen), nicht rekursiv, Ereignisse entprellt und
   zusammengefasst (z. B. 100–300 ms), beim Ordnerwechsel abgemeldet; Fallback auf Polling für Netzlaufwerke
   (konfigurierbar, aus per Default?).
2. Inkrementelle Updates (hinzugefügt/entfernt/geändert) statt Komplett-Neuladen bei großen Ordnern; Frontend
   wendet sie im Store an (Pfad als Schlüssel), Table über `setRows`/`updateRows` (Table-API prüfen).
3. Massenänderungen (z. B. 50 000 Dateien entpackt) → einmal neu laden statt Event-Flut.
4. Jobs aus 005 melden weiterhin `changedDirs`; doppelte Aktualisierung vermeiden.

## Aufgaben – Drag & Drop

1. **Innerhalb der App**: Markierung von Panel zu Panel ziehen = Kopieren (Modifier: Verschieben, Verknüpfung –
   plattformübliche Tasten), Ablegen auf Ordnerzeile = in diesen Ordner; Vorschau-Hinweis am Mauszeiger; Tastatur-
   Alternative existiert bereits (F5/F6). Mit der GuiExpert Table klären: Row-Drag (`rowDragOptions.managed: false`
   liefert nur Events) oder eigene Pointer-Logik.
2. **Vom System in die App**: Tauri Drag-&-Drop-Ereignisse des Fensters (Pfade der abgelegten Dateien) → Kopier-/
   Verschiebe-Dialog mit Ziel = Panel bzw. Ordner unter dem Zeiger.
3. **Aus der App ins System** (Dateien in Finder/Explorer/Mail ziehen): Machbarkeit je OS prüfen (Tauri hat dafür
   keinen Kern-API; Plugin/Crate wie `tauri-plugin-drag` bewerten). Wenn nicht zuverlässig plattformübergreifend:
   bewusst weglassen und dokumentieren.

## Akzeptanzkriterien

- Datei im Finder/Explorer anlegen/löschen/umbenennen → Panel aktualisiert sich < 1 s, Cursor bleibt.
- 50 000 neue Dateien auf einmal → kein Einfrieren (gemessen).
- Drag & Drop zwischen Panels und vom System in die App funktioniert; Grenzen beim Ziehen ins System dokumentiert.
