# Design 010: Ansicht (F3), Schnellvorschau und Eigenschaften

> **Status:** ✅ freigegeben (Marc: Go für alle Empfehlungen, 2026-10-17) – alle Empfehlungen übernommen ·
> **Datum:** 2026-10-17 · **Branch:** `feat/vorschau-eigenschaften` (von `main`, 001–008 fertig)
> **Grundlage:** Prompt 010, legacy §3/§7.3/§9 (dort gab es nichts), mr §5 (Attribute-Dialog, View/Edit mit Monaco),
> Design 003 (Datei öffnen, Ordnergröße als Job), 005 (Jobs), 006 (Dialog-Muster).
> **Phasen:** alle sechs; Rust und Frontend sind beide betroffen.

---

## 1. Bestand

| Baustein | heute (008) | Bewertung |
|---|---|---|
| Aktionen `OPEN_VIEW_DLG` (F3), `OPEN_EDIT_DLG` (F4), `OPEN_ATTRIBUTE_DLG` | im Katalog ohne Handler | **passt**, Handler ergänzen; neue Aktion `QUICK_VIEW` (E4) |
| `opener::check_openable` + `open_file` (003) | Standard-App, Programme nur mit Bestätigung | **passt** für F4 (E6) |
| Job `dirSize` (003) | Ordnergröße ohne Links, abbrechbar | **passt** für die Größe im Eigenschaften-Dialog |
| `Modal`, `DialogService` | ein Dialog zur Zeit, Fokusfalle | **passt** – Ansicht und Eigenschaften sind Dialoge (`viewer`, `properties`) |
| `FileListController.displayedEntries` | Zeilen in Anzeige-Reihenfolge | **passt** für ←/→ im Viewer; **ergänzen**: `moveCursorTo(path)` |
| CSP `img-src 'self' data:` | keine Datei-Bilder | **erweitern** um das eigene Schema `fnfpreview:` (E3) |
| `platform.rs` | Unix/Windows-Helfer | **erweitern**: Eigentümer-/Gruppenname (Unix), Attribute (Windows) |

## 2. Entscheidungen (Empfehlungen, alle übernommen)

### E1 – Ansicht als Overlay-Dialog im Hauptfenster, eigener schlanker Viewer, kein Monaco ✅

| Option | + | − |
|---|---|---|
| **A: Overlay (Modal, fast fenstergroß)** | ein Fenster, keine zweite Capability, ←/→ steuert direkt den Panel-Cursor, Fokus kehrt zur Liste zurück | Liste ist während der Ansicht verdeckt |
| B: eigenes `WebviewWindow` | nebeneinander ansehen | zweites Fenster braucht eigene Capability/CSP-Prüfung, Zustand über Events, Fokus-Rückgabe schwierig |
| C: Monaco (mr) | Suche/Ersetzen, Minimap, Bearbeiten | ~5 MB, Web-Worker (`worker-src blob:`) → CSP aufweichen; Bearbeiten gehört zu F4/011 |

**Empfehlung A + eigener Viewer.** Bearbeiten macht der externe Editor (E6, ab 011 konfigurierbar). Mehrere
Ansichtsfenster → „Offen“.

### E2 – `read_preview`: Erkennung über Inhalt, harte Grenzen, Kodierung selbst ✅

- Ablauf (rein std, `preview.rs`): `symlink_metadata` → Ordner/sonstiges sofort; Datei (auch über Link) öffnen,
  **Kopf 8 KiB lesen**, `detect(head, ext)` (Magic Bytes zuerst, Endung nur als Hinweis). Nur für Text wird
  weitergelesen: `File::take(limit)` – nie mehr als `maxTextBytes` (Default 1 MiB, geklemmt auf 4 KiB … 8 MiB).
  Eine 2-GB-Datei kostet also höchstens 1 MiB Speicher; Binär → `hexBytes` (Default 4 KiB, max. 64 KiB).
- **Magic Bytes:** PNG, JPEG, GIF, WebP, BMP, ICO, AVIF (`ftyp avif`), PDF, ZIP (auch docx/xlsx/jar), GZIP, 7z, RAR,
  BZIP2, XZ, TAR (`ustar` @257), ELF, Mach-O, PE (`MZ`), WASM, SQLite, MP3 (ID3/Frame-Sync), OGG, FLAC, WAV, MP4/MOV
  (`ftyp`), Matroska/WebM, TIFF, HEIC. SVG: Text, der (nach BOM/Leerraum, ggf. `<?xml …?>`/Kommentaren) mit `<svg`
  beginnt.
- **Text oder binär:** BOM (UTF-8/UTF-16 LE/BE) → Text. Sonst UTF-16 ohne BOM, wenn ≥ 90 % der geraden bzw.
  ungeraden Bytes 0 sind (≥ 16 Bytes). Sonst ein NUL-Byte oder > 10 % Steuerzeichen (außer `\t\n\r\f` und ESC) im
  Kopf → binär.
- **Kodierung (ohne Crate):** `auto` = BOM → UTF-8 (gültig, eine am Schnitt abgeschnittene Sequenz zählt als gültig)
  → Windows-1252. Wählbar: `utf-8`, `utf-16le`, `utf-16be`, `windows-1252`, `latin-1`. Windows-1252 = Latin-1 plus
  Tabelle für 0x80–0x9F (5 undefinierte Werte → U+FFFD). Begründung gegen `encoding_rs`: die geforderten Kodierungen
  sind ~80 Zeilen, getestet; Shift-JIS/GBK & Co. → „Offen“ (dann `encoding_rs`). Schnitt am Limit: UTF-8 an der letzten
  vollständigen Sequenz, UTF-16 auf gerader Länge; `truncated = true`. Ungültige Bytes → U+FFFD und `lossy = true`.
- **Endung passt nicht** (`bild.txt` ist PNG): `extMismatch = true`, wenn die Endung zu einer bekannten Familie
  (Text, Bild, Archiv, Dokument, Audio/Video, Programm) gehört und der Inhalt zu einer anderen; die Ansicht zeigt den
  Hinweis „Inhalt ist PNG-Bild, Endung .txt“ und den Inhalt so, wie er wirklich ist.
- Dateiinhalte werden nie geloggt; Fehlertexte enthalten keinen Inhalt.

### E3 – Bilder über ein eigenes, schmales URI-Schema mit Einmal-Token ✅

| Option | + | − |
|---|---|---|
| Tauri Asset-Protocol | eingebaut | Feature `protocol-asset`, Scope müsste ganz `$HOME`/alle Laufwerke sein (der Nutzer sieht überall Bilder) – liefert dann jede Datei per URL |
| `data:`-URL (Base64) | keine CSP-Änderung | +33 % über IPC, ein 30-MB-Foto = 40-MB-String im JS-Heap; ruckelt |
| verkleinerte Vorschau in Rust (`image`-Crate) | kleine Antworten | große Abhängigkeit, Dekodieren in Rust langsamer als nativ in der WebView, EXIF-Drehung selbst |
| **eigenes Schema `fnfpreview`** (`register_asynchronous_uri_scheme_protocol`) | liefert **nur** Dateien, die `read_preview` gerade als Bild erkannt hat (Token → Pfad, max. 16, ältestes fällt raus), Bytes direkt an die WebView, nativ dekodiert | eigener Code (~80 Zeilen) |

**Empfehlung: eigenes Schema.** Regeln: Token = 128 Bit aus `RandomState`-Hashes (nicht ratbar, keine Crate);
beim Abruf wird erneut geprüft: reguläre Datei, ≤ 256 MiB, Magic Bytes sind immer noch ein Bild – sonst 404. Antwort
mit `Content-Type` aus den Magic Bytes, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`; SVG zusätzlich
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` (im `<img>` laufen ohnehin keine Skripte
und es wird nichts nachgeladen). Lesen in einem eigenen Thread (nie auf dem Runtime-/Main-Thread). URL über
`convertFileSrc(token, 'fnfpreview')` (`fnfpreview://localhost/<token>`, Windows `http://fnfpreview.localhost/<token>`).
**CSP:** `img-src 'self' data: fnfpreview: http://fnfpreview.localhost` – sonst unverändert. Keine Plugins, keine
neuen Capabilities.

### E4 – Schnellvorschau (TC Strg+Q) im Ziel-Panel ✅

- Neue Aktion `QUICK_VIEW` (Strg+Q; macOS **⌃Q**, ⌘Q beendet die App). `WorkspaceStore.quickView` (bool, nur für die
  Sitzung). Ist sie an, zeigt das **nicht aktive** Panel statt seiner Liste die Vorschau der Datei unter dem Cursor
  des aktiven Panels (die Liste bleibt im DOM, nur verborgen → Table-Zustand bleibt). Seitenwechsel (Tab) tauscht mit.
- Entprellt 150 ms beim Cursor-Wechsel, Request-Sequenz verwirft veraltete Antworten; Ordner/`..` zeigen „Ordner“.
- Gleiche Provider wie die Ansicht (E7), kompakt (ohne Suche/Kodierungswahl), Limit 256 KiB Text.

### E5 – Eigenschaften (Alt+Enter, macOS zusätzlich ⌘I) – nur Anzeige ✅

- `get_properties(path)` (Command, `spawn_blocking`): Name, Pfad, Art, Größe, Erstellt/Geändert/Zugriff (ms, `null`
  wenn das System es nicht liefert), Symlink-Ziel (`read_link`) und Zielart, erkannter Typ (E2, nur Dateien),
  `unix { mode, uid, gid, owner, group }` (Namen über `getpwuid_r`/`getgrgid_r`, `libc` ist schon da) bzw.
  `windows { readonly, hidden, system, archive }` (`file_attributes`). `readonly` für alle Systeme.
- Anzeige: `rwxr-xr-x (755)` plus Sonderbits (setuid/setgid/sticky) in TS formatiert (rein, getestet).
- Ordnergröße: Knopf „Berechnen“ startet den Job `dirSize` (003), Fortschritt/Abbruch über die Engine.
- **Ändern** von Rechten/Attributen/Datum (mr) bewusst **nicht** in diesem Prompt: eigener Schritt mit
  Backend-Validierung → „Offen“ (Annahme: das Prompt erlaubt das ausdrücklich).

### E6 – F4 Bearbeiten = Standard-App ✅

Bis 011 öffnet F4 die Datei unter dem Cursor mit der Standard-App über `open_file` (Programme nur nach
Rückfrage, wie Enter in 003). Ordner → Hinweis. 011 ersetzt den Handler durch das konfigurierte Tool.

### E7 – Erweiterbarkeit ✅

- Rust: `PreviewKind` = `text | image | binary | directory | other` und `format { id, label, mime }` aus der Erkennung;
  neue Formate (PDF, Markdown, Audio/Video) bekommen eigene `kind`-Werte, ohne die bestehenden zu ändern.
- Frontend: `PreviewProvider { id, canShow(p): boolean, component }` in einer Liste
  (`features/preview/preview-providers.ts`); die erste passende gewinnt. Heute: Text, Bild, Hex, Info (Ordner/sonst).
  Markdown/HTML werden als **Text** gezeigt (nie gerendert) – ein Markdown-Provider müsste sanitisiert in ein
  `sandbox`-iframe rendern (→ „Offen“).

### E8 – Viewer-Bedienung und Darstellung ✅

- Text: Zeilennummern, Umbruch an/aus (`W`, Knopf), Kodierung (Auswahl), Suche **Strg/⌘+F** (Eingabe, Enter/F3 =
  nächster, Shift+Enter/Shift+F3 = voriger, Groß/klein egal, Trefferzahl live), Hinweis „erste 1 MiB von 2,0 GiB“.
  Darstellung **ohne `innerHTML`**: Zeilen als DOM-Knoten mit `textContent`, in Blöcken zu 500 Zeilen mit
  `content-visibility: auto` (1 MiB ≈ 20 000 Zeilen bleiben flüssig); Treffer als `<mark>` per `textContent`.
- Bild: Einpassen (Default) / 100 % / Zoom `+`/`-`, `0` = einpassen, `1` = 100 %; Abmessungen aus `naturalWidth`.
- Hex: Offset · 16 Bytes · ASCII, als Text in einem `<pre>` (Interpolation, escaped).
- **←/→ (und Leertaste/Backspace)** = nächste/vorige **Datei** im Panel (Ordner werden übersprungen); der Panel-Cursor
  folgt, nach Esc steht er auf der zuletzt angesehenen Datei. ↑/↓/Bild↑/Bild↓/Pos1/Ende scrollen. Esc schließt.
- Dialog `role="dialog"`, `aria-modal`, Fokusfalle (Modal); der Inhaltsbereich ist fokussierbar (`tabindex=0`,
  `role="document"`), Status (Kodierung, Größe, Hinweise) in einer Live-Region.

### E9 – Kürzel ✅

| Aktion | Windows/Linux | macOS | frei? |
|---|---|---|---|
| `OPEN_VIEW_DLG` | F3 (vorhanden) | F3 | – |
| `OPEN_EDIT_DLG` | F4 (vorhanden) | F4 | – |
| `QUICK_VIEW` (neu) | Strg+Q | ⌃Q | geprüft |
| `OPEN_ATTRIBUTE_DLG` | Alt+Enter | ⌥Enter, ⌘I | geprüft |

## 3. Verträge

### Rust (`preview.rs`, `properties.rs`, Commands)

```rust
pub struct PreviewOptions { encoding: Option<String> /* auto */, max_text_bytes: Option<u64>, hex_bytes: Option<u64> }
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Preview {
  Text   { size, format: Format, encoding: String, detected_encoding: String, text: String, truncated: bool, lossy: bool, ext_mismatch: bool },
  Image  { size, format: Format, token: String, ext_mismatch: bool },
  Binary { size, format: Format, bytes: Vec<u8>, truncated: bool, ext_mismatch: bool },
  Directory { },
  Other  { },                                   // Gerät, Socket, FIFO – wird nie geöffnet
}
pub struct Format { id: &'static str /* "png", "text", "pdf" … */, label: &'static str, mime: Option<&'static str> }
pub struct Properties { name, path, kind: EntryKind, size: Option<u64>, created_ms, modified_ms, accessed_ms,
  readonly: bool, link_target: Option<String>, target_kind: Option<EntryKind>, format: Option<Format>,
  unix: Option<UnixPerms { mode: u32, uid: u32, gid: u32, owner: Option<String>, group: Option<String> }>,
  windows: Option<WinAttrs { readonly, hidden, system, archive }> }
```

| Command | Rückgabe / Fehler |
|---|---|
| `read_preview(path, options)` | `Preview` · `invalid_path`, `not_found`, `permission_denied`, `io`; unbekannte Kodierung → `io` mit Text (Annahme) |
| `get_properties(path)` | `Properties` · wie oben |
| Schema `fnfpreview://localhost/<token>` | Bildbytes oder 404 |

FIFOs/Geräte werden nie geöffnet (`Other`), sonst hinge `read` – Test unter Unix mit `mkfifo`.

### TypeScript

```ts
// core/preview/preview.models.ts (Spiegel von preview.rs), core/preview/preview-api.ts
abstract class PreviewApi { readPreview(path, options?): Promise<Preview>; getProperties(path): Promise<Properties>; imageUrl(token): string }
// features/preview/: viewer.store.ts (Root: Datei, Liste, Optionen, Sequenz), quick-view.ts, viewer-dialog.ts,
// text-view.ts (DOM per textContent), text-search.ts (rein), hex.ts (rein), preview-providers.ts,
// properties.store.ts + properties-dialog.ts, permissions.ts (rein: rwx, Oktal)
```

## 4. UI-Skizzen

```
┌ View – Brief ä.txt ───────────────────────────────────── 3 / 12 ┐
│ [◀] [▶]  Encoding [Auto (UTF-8) ▾]  [x] Wrap   [Find…]          │
│ ⚠ Content is a PNG image, extension .txt     first 1 MiB of 2 GiB│
│ ┌──┬────────────────────────────────────────────────────────────┐│
│ │ 1│ Lorem ipsum …                                              ││
│ │ 2│ …                                                          ││
│ └──┴────────────────────────────────────────────────────────────┘│
│ Find [ipsum      ] 3 / 17  [↑] [↓]                     [Close]   │
└──────────────────────────────────────────────────────────────────┘
┌ Properties – Foto.jpg ─────────────────────┐
│ Name      Foto.jpg                          │
│ Path      /home/u/Bilder/Foto.jpg           │
│ Type      JPEG image (image/jpeg)           │
│ Size      2.4 MB (2 412 551 bytes)          │
│ Created / Modified / Accessed …             │
│ Permissions rw-r--r-- (644) · Owner u:staff │
│ Link to   – / Attributes R H S A (Windows)  │
│                                   [Close]   │
└─────────────────────────────────────────────┘
```

Fokus Viewer: Inhalt (autofocus) → Werkzeugleiste → Suche → Schließen. Eigenschaften: `<dl>`, Schließen hat Fokus.

## 5. Tests

| Ebene | Fälle |
|---|---|
| Rust `preview` | UTF-8 (Umlaute, Emoji), UTF-8 mit BOM, UTF-16 LE/BE mit BOM, UTF-16 LE ohne BOM, Windows-1252 (€ „ä“), Latin-1 erzwungen, Schnitt mitten in einer UTF-8-Sequenz, Limit bei großer (sparse) Datei – gelesene Bytes ≤ Limit, binär → Hex, PNG/JPEG/GIF/PDF/ZIP-Erkennung, `bild.txt` ist PNG (`extMismatch`), `foto.png` ist Text, SVG, leere Datei, Ordner, Symlink auf Datei, dangling Link, FIFO (`Other`), Unicode-Dateiname |
| Rust `properties` | Datei/Ordner/Link (Ziel, Zielart), Modus und Eigentümer (Unix), Zeiten, fehlende Datei |
| Rust Token-Register | Token nur für Bilder, Abruf prüft neu (Datei gegen Text getauscht → 404), Grenze 16, unbekannt → 404 |
| TS rein | `text-search` (Treffer je Zeile, Groß/klein, Unicode, Navigation rundum), `hex` (Zeilen, ASCII-Spalte), `permissions` (rwx, Sonderbits, Oktal) |
| TS Stores | Viewer: öffnen nur für Dateien, ←/→ überspringt Ordner und setzt den Cursor, Kodierungswechsel lädt neu, veraltete Antworten verworfen; Schnellvorschau: Entprellung, Sequenz, nur Ziel-Panel; Eigenschaften: Laden, Ordnergröße als Job; F4 → `openFile`, Programm → Rückfrage; Aktionen enabled/disabled |
| E2E (Xvfb) | 2-GB-Datei (sparse), Binär → Hex, UTF-16/1252, `bild.txt`, großes Foto, Schnellvorschau beim Cursor-Wechsel, Eigenschaften mit Link/Rechten |

## 6. Annahmen

- Schnellvorschau und Viewer-Optionen (Umbruch) gelten nur für die Sitzung (Einstellungen kommen mit 015).
- Eine unbekannte Kodierung ist ein `io`-Fehler mit Text (kein neuer Fehlercode).
- ⌃Q auf macOS für die Schnellvorschau (⌘Q bleibt „Beenden“).
- Ändern von Attributen/Rechten folgt in einem eigenen Schritt (E5).

## 7. Abweichungen bei der Umsetzung

| Punkt | Design | umgesetzt | Grund |
|---|---|---|---|
| Schnellvorschau-Zustand | `WorkspaceStore.quickView` | eigener Root-Store `QuickViewStore` (`on`, `shownOn`) | WorkspaceStore bleibt schlank; die Seite folgt `activeSide` |
| Ansicht erzwingen | – | `mode`: Automatisch / Text / Hex (Auswahl im Viewer) | Binärdatei als Text oder Text als Hex ansehen; kleiner Zusatz ohne neues Risiko (gleiche Limits) |
| BOM vor Magic Bytes | Magic Bytes zuerst | ein Text-BOM gewinnt | UTF-16 LE `FF FE` sah wie ein MP3-Frame-Sync aus (roter Test) |
| Zeilen im Text-View | Text je Zeile | Zeile = Grid aus Nummer (`::before`) und **einem** `<span>` | E2E-Fund: `<mark>` und Textknoten wurden sonst eigene Grid-Spalten |
| Bild einpassen/zoomen | `max-width/height` im Grid | Einpassen absolut positioniert, Zoom mit `margin: auto` im Flex-Container | E2E-Fund: Grid-Zeilen ohne feste Höhe → Bild ragte heraus; `place-items: center` schnitt gezoomte Bilder links/oben ab |
| F4 | eigener Handler | `FileBrowserStore.openFile` öffentlich (gleiche Rückfrage bei Programmen wie Enter) | kein doppelter Code |

## 8. Review

**Selbstprüfung** (Schwerpunkt Sicherheit):

- Dateiinhalte nur über `read_preview` mit harten Grenzen (`take`), nie geloggt; Fehlertexte ohne Inhalt.
- FIFO/Gerät: `metadata` prüft „reguläre Datei“, Öffnen mit `O_NONBLOCK` und erneute Prüfung am Handle – ein nach der
  Prüfung eingetauschter FIFO blockiert nicht (`links_fifos`).
- Bild-Schema: nur Token aus `read_preview` (32 Hex-Zeichen, sonst 404 ohne Dateizugriff), Abruf prüft erneut
  (Datei, Größe, Magic Bytes), `nosniff`; SVG nur im `<img>` (keine Skripte, kein Nachladen) und mit eigener CSP.
  Restrisiko: ein Skript in der WebView könnte ohnehin `read_preview` für beliebige Pfade aufrufen (wie
  `list_directory`) – das Schema öffnet darüber hinaus nichts.
- DOM: Text, Hex, Namen, Pfade nur per `textContent`/Interpolation; Test „the text view builds lines with
  textContent only“ prüft `<img onerror>`/`<b>` im Text.
- Eigentümernamen über `getpwuid_r`/`getgrgid_r` (reentrant, 16-KiB-Puffer, Null-Zeiger geprüft).

### Review (separater Agent) – Ergebnis

| # | Fund | Stand |
|---|---|---|

## 9. Fortschritt

- [x] Phase 1: dieses Dokument · [x] Freigabe (Empfehlungen übernommen)
- [x] Phase 2 Rust: `preview/` (`encoding.rs`, `detect.rs`, `mod.rs` mit `read_preview`, `ImageTokens`,
  `serve_image`), `properties.rs`, `platform::{user_name, group_name, file_attributes}`, Commands `read_preview`,
  `get_properties`, Schema `fnfpreview` (`commands::preview_response`), CSP `img-src` – 22 neue Rust-Tests
- [x] Phase 3 Frontend: `core/preview/` (PreviewApi + Fake), `features/preview/` (ViewerStore/-Dialog, QuickViewStore
  + QuickView im Ziel-Panel, PropertiesStore/-Dialog, Provider-Liste mit Text/Bild/Hex/Info, reine Helfer),
  Aktion `QUICK_VIEW` + Kürzel, Handler für F3/F4/Alt+Enter, `FileListController.moveCursorTo`, Token
  `--color-search-hit` (light/dark) – 16 neue Frontend-Tests (`preview.spec.ts`, `preview-logic.spec.ts`)
- [x] Phase 4 Ende-zu-Ende (Xvfb :98, Debug-Build, eigenes `HOME`/`XDG_*` unter `/tmp/claude-0/e2e-010`):
  Text UTF-8 mit Umlauten/Emoji, Suche mit Markierung, UTF-16 (BOM), Windows-1252 (€, „“, ä) automatisch erkannt;
  2-GB-Datei (sparse) zeigt „first 1.0 MB of 2.0 GB“, RSS der App ~180 MB; `data.bin` → Hex mit „first 4.0 KB“;
  `bild.txt` (PNG) als Bild mit Hinweis; Foto 4000×3000 eingepasst und gezoomt; ←/→ blättert (Cursor folgt);
  Schnellvorschau rechts folgt dem Cursor (Bild, UTF-16, `.md` mit `<script>` als Text); Eigenschaften für Link
  (Ziel, Rechte 644, root:root) und Ordner (750, Größe per Job). Zwei Funde behoben (s. §7).
  Nicht prüfbar: macOS/Windows (Attribute, ⌃Q), gesperrte Dateien (als root greifen Rechte nicht), Dark-Mode nur
  über Tokens. Langsam im Debug-Build unter Xvfb (Software-Rendering): 1 MiB Text erscheint nach ~3 s.
- [x] Phase 5 Doku · [x] Phase 6 Abschlussprüfung (`pnpm check`, Debug-Build), Selbstprüfung (§8)

## 10. Offen

- Ändern von Rechten/Attributen/Datum (mr Attribute-Dialog) mit Backend-Validierung.
- Weitere Kodierungen (Shift-JIS, GBK, KOI8 …) über `encoding_rs`; „mehr laden“ über das Limit hinaus.
- Provider für PDF, Markdown (sanitisiert im `sandbox`-iframe), Audio/Video (Range-Requests im Schema).
- Ansicht in eigenem Fenster; Bearbeiten im eingebauten Editor.
