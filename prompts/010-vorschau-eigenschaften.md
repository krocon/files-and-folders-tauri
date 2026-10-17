# Prompt 010: Ansicht (F3), Schnellvorschau und Eigenschaften

> **Slug:** `vorschau-eigenschaften` · **Braucht:** 004 · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`. Das alte Programm hatte hier nichts (Tool „Edit“ mit Sublime, keine
> Ansicht, kein Attribut-Dialog; legacy §3, §7.3, §9) – dieser Prompt ist neu.

## Ziel

Dateien ansehen, ohne die App zu verlassen: Text (mit Kodierungserkennung und Größenlimit), Bilder, später weitere
Formate über eine erweiterbare Vorschau-Architektur. Dazu ein Eigenschaften-Dialog mit Metadaten und Rechten.

## Aufgaben

1. **Rust**: `read_preview(path, options)` mit harter Obergrenze (z. B. erste 1 MB Text), Erkennung über
   Inhalt (Magic Bytes) **und** Endung – Endung allein ist nicht vertrauenswürdig; Binärdateien → Hex-Ansicht der
   ersten KB. Kodierung (UTF-8, UTF-16 mit BOM, Fallback Latin-1/Windows-1252) – Crate begründen oder selbst
   minimal. Bilder: Bytes nie als `data:`-URL beliebiger Größe; Weg im Design (Tauri Asset-Protocol mit eng
   begrenztem Scope **oder** Command liefert verkleinerte Vorschau). CSP entsprechend minimal erweitern.
2. **Ansicht F3** als eigenes Fenster oder Overlay (entscheiden): Text mit Zeilennummern, Suche (Strg/⌘+F),
   Umbruch an/aus, Kodierung wählen; Bild mit Zoom/Einpassen; Pfeile = nächste/vorige Datei im Panel; Esc schließt.
3. **Schnellvorschau** (TC Strg+Q): das Ziel-Panel zeigt die Vorschau der Datei unter dem Cursor; aktualisiert
   entprellt beim Cursor-Wechsel, veraltete Antworten werden verworfen.
4. **Eigenschaften** (Alt+Enter): Name, Pfad, Typ, Größe (Ordner: Job aus 003), Erstellt/Geändert/Zugriff,
   Rechte (Unix-Modus rwx, Eigentümer; Windows-Attribute R/H/S/A), Symlink-Ziel. Ändern von Attributen/Rechten
   nur als eigener Schritt mit Backend-Validierung (optional in diesem Prompt; sonst Notiz).
5. **Bearbeiten F4**: externen Editor starten – Konfiguration über Tools (Prompt 011); bis dahin Standard-App.
6. Erweiterbarkeit: `PreviewProvider`-Schnittstelle (Frontend) + Typ-Erkennung im Backend, damit PDF, Markdown,
   Audio/Video später andocken.

## Akzeptanzkriterien

- 2-GB-Datei: Vorschau zeigt den Anfang, ohne den Speicher zu füllen; Binärdatei → Hex.
- UTF-8, UTF-16 und Windows-1252-Texte korrekt; falsche Endung (`bild.txt` ist ein PNG) wird erkannt.
- Bildvorschau großer Fotos flüssig; CSP/Capabilities nur so weit geöffnet wie nötig (in `docs/architecture.md`).
- Eigenschaften zeigen plattformgerechte Rechte/Attribute.

## Ergänzungen aus files-and-folders-mr (mr §5)

- **Attribute-Dialog** wie mr: Archiv, Versteckt, Schreibgeschützt, System (Windows), Datum/Uhrzeit ändern – plattform-
  gerecht (Unix: Rechte), Änderungen im Backend validiert.
- **View/Edit** öffnete in mr ein eigenes Fenster mit Monaco (Theme, Zeilennummern, Minimap, Umbruch, Suchen/Ersetzen,
  Speichern, Rückfrage bei ungespeicherten Änderungen). Entscheiden: Monaco in einem Tauri-`WebviewWindow` (Größe der
  Abhängigkeit, CSP) oder schlanker eigener Viewer + externer Editor über Tools (011). Bild-/Medienvorschau fehlte in mr.
