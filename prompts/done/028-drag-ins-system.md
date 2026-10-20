# Prompt 028: Drag & Drop erweitert – Ziehen aus der App ins System

> **Slug:** `drag-ins-system` · **Braucht:** 012 (Drag & Drop in der App, Drop von außen), 011 (OS-Integration)
> · **Umfang:** S–M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/012-ueberwachung-drag-drop.design.md` (E5–E7, §9).
> Anlass: offener Punkt aus 012 (E7) und `TODO.md` §4. Marc hat am 20.10.2026 den Umfang festgelegt: **nur** das Ziehen
> ins System; Tabs zwischen den Seiten ziehen und Verknüpfung per Drag bleiben offen.

## Ziel

Dateien und Ordner aus einer Dateiliste lassen sich mit der Maus in andere Programme ziehen – Finder, Explorer,
Nautilus/Dolphin, Mail, Browser-Upload, Desktop. Das Ziehen innerhalb der App (012 E5: Dialog statt direkter
Operation) bleibt unverändert.

## Bestand

- `file-list.ts`: Pointer-Drag ab 6 px (`DRAG_THRESHOLD`), Pointer-Capture, `DragStore.begin/move/drop`, Esc bricht ab.
- `DragStore` (Root): Zonen beider Panels, Ziel unter dem Zeiger, Übergabe an `OpsStore.openCopyMoveFor`; Drop von
  außen über `DragDropApi` (`onDragDropEvent`) → `describe_paths` → Kopieren-Dialog.
- Tauri 2 hat **kein** Kern-API für einen Drag-Source (012 E7). Geprüft: Crate `drag` (CrabNebula, MIT/Apache):
  macOS `NSDraggingSession`, Windows `DoDragDrop`, Linux GTK `drag_begin`.

## Aufgaben

1. **Übergabe an das System:** Verlässt der Zeiger während eines App-internen Drags das Fenster, endet der interne Drag
   und ein nativer Drag mit denselben Einträgen beginnt (Entscheidung im Design: Fensterrand vs. sofort nativ).
2. **Command `start_os_drag(paths)`** (schmal, validiert, async): nur das Hauptfenster, nur absolute, existierende
   Pfade (keine virtuellen Archivpfade), Obergrenze der Anzahl; Start auf dem Main-Thread. **Nicht** das Plugin
   `tauri-plugin-drag` (beliebige Pfade/Bilder vom Frontend). Fehlercodes im DTO-Vertrag.
3. **Nur Kopieren anbieten** (oder begründet anders): ein Verschieben, das das Zielprogramm ausführt, wäre eine
   destruktive Operation ohne unsere Prüfung.
4. **Plattformcode** hinter `platform/` mit gleicher Signatur; Linux-Dateinamen als korrekte `file://`-URIs
   (Leerzeichen, Umlaute, `%`, `#`, nicht-UTF-8).
5. Zurück ins eigene Fenster gezogen: verhält sich wie ein Drop von außen (012 E6), ohne Sonderfall.
6. Hinweis am Zeiger („Ziehen ins System …“) und Statusmeldung bei Fehlern; Texte en/de.

## Akzeptanzkriterien

- Datei aus der Liste auf den Desktop/in Finder/Explorer/Nautilus ziehen → das Zielprogramm kopiert sie.
- Mehrere markierte Einträge (inkl. Ordner) werden zusammen gezogen.
- Ziehen innerhalb der App öffnet weiterhin den Kopieren/Verschieben-Dialog; Esc bricht weiterhin ab.
- Einträge in Archiven lassen sich nicht ins System ziehen (Hinweis statt Fehler-Stacktrace).
- Namen mit Leerzeichen, Umlauten, Emoji, `%` und `#` kommen im Zielprogramm richtig an (Linux geprüft per E2E).

## Tests

- Rust: Validierung (relativ, fehlend, Archivpfad, zu viele, Unicode), URI-Bau unter Linux.
- Frontend: Übergabe beim Verlassen des Fensters (Store + Liste), keine Übergabe bei Archiv-/leeren Quellen, Fehler →
  Statusmeldung, Fassade per Fake.
- E2E unter Xvfb: Ziehen in ein GTK-Testfenster, das die empfangenen URIs ausgibt.
- macOS/Windows nur bei Marc bzw. in der CI (im Container nicht kompilierbar) – im Bericht nennen.
