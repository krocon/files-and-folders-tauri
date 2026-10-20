# Design 024: Attribute ändern

> Status: **in Arbeit** · Branch `feat/attribute-aendern` · Prompt: [024-attribute-aendern.md](024-attribute-aendern.md)
> · Marc hat am 20.10.2026 Umfang und Ablauf („selbständig umsetzen“) freigegeben – kein Haltepunkt nach Phase 1,
> die Entscheidungen stehen hier.

## 1. Bestand → wofür → passt/fehlt

| Baustein | wofür | Stand |
|---|---|---|
| `properties.rs` / `get_properties` (010 E5) | Ausgangswerte im Dialog (Modus, Attribute, Zeiten) | passt; `UnixPerms` bekommt `flagsHidden` (macOS) |
| `PropertiesDialog` / `PropertiesStore` | Anzeige | erweitert: Knopf „Ändern…“ statt Hinweis „später“ |
| Job-Engine (`JobSpec`, `validate`, `Reporter`, `ItemError`) | Ausführung, Fortschritt, Abbruch, Protokoll | neue Job-Art `attributes` |
| `fileops::check_danger` | Wurzel/Home/System | für rekursive Änderungen |
| `platform.rs` (Unix/Windows) | Plattformcode | neu `platform/attributes.rs` |
| `ops-logic.selectionForAction` | markiert oder Cursor | passt |
| `OFF_IN_ARCHIVE`, `OFF_WHILE_UNCHECKED` | Sperren | neue Aktion eintragen |
| `JobsStore`, `job-format.ts` | Start, Titel in der Task-Liste | Titel für `attributes` |
| `libc` (Unix), `windows-sys` (Windows) | Systemaufrufe | vorhanden; `windows-sys` bekommt das Feature `Win32_Storage_FileSystem` (keine neue Crate) |

## 2. Entscheidungen

**E1 Eigene Aktion `OPEN_CHANGE_ATTRIBUTES_DLG`, Eigenschaften bleiben `OPEN_ATTRIBUTE_DLG`.** In mr hieß der
Änderungs-Dialog `OPEN_ATTRIBUTE_DLG`; bei uns trägt die Id seit 010 die Eigenschaften mit den OS-üblichen Kürzeln
`Alt+Enter` (Windows „Eigenschaften“) und `⌘I` (Finder „Informationen“). Umbenennen hieße: Keymaps, Menüs,
gespeicherte Kürzel-Overrides und Specs anfassen, und `Alt+Enter` würde plötzlich einen schreibenden Dialog öffnen.
Daher: Ansehen und Ändern getrennt, neue Id `OPEN_CHANGE_ATTRIBUTES_DLG` („Change attributes…“, Gruppe `files`) mit
`Mod+Shift+F2` auf allen OS (frei; nah an mr `cmd+ctrl+shift+f2`†, das nie feuerte). Einstiege: Kürzel, Palette,
Menü „Datei“ und Kontextmenü neben „Eigenschaften…“, Actions-Menü (mr), Knopf „Ändern…“ im Eigenschaften-Dialog
(ändert genau diesen Eintrag).

**E2 Job-Art `attributes`** (serielle Warteschlange wie Umbenennen): `paths` (markiert oder Cursor, höchstens
10 000), `change`, `recursive`, `applyTo` (`all` | `files` | `dirs`). Der Filter gilt für **alle** Einträge, auch die
markierten (Beispiel: Ordner markiert, rekursiv, „nur Dateien“, `644` → der Ordner selbst behält sein `x`).
`changed_paths()` bleibt leer (nichts wird verschoben/gelöscht), `target_dirs()` = die Elternordner der Pfade: der
Watcher hält deren Reloads bis zum Ende zurück (029 E8), der Job meldet `dirsChanged` (Elternordner jedes geänderten
Eintrags) – die Panels frischen dann einmal auf.

**E3 Änderung als Differenz, nie als Absolutwert.** `modeSet`/`modeClear` (Masken ⊆ `0o7777`, disjunkt), Flags
`readonly`/`hidden`/`system`/`archive` als `Option<bool>` (`null` = unverändert), Zeiten als
`Option<TimeValue>` (`now` | `at { ms }`). So bleibt bei Mehrfachauswahl alles Unberührte je Eintrag erhalten
(Dreifach-Zustand), und rekursive Änderungen verhalten sich wie `chmod -R g+w`. „Jetzt“ löst Rust einmal beim
Start auf – alle Einträge bekommen dieselbe Zeit. Leere Änderung → `invalid_path` („Nothing to change“).

**E4 Links nie folgen.** Ein **markierter** Link wird nicht geändert und als Fehler `symlink_skipped` gemeldet
(neuer Code; Rechte eines Links sind unter Linux nicht änderbar, und Ändern des Ziels wäre überraschend). Links im
Ordnerinhalt werden nicht betreten und nicht geändert, aber als „übersprungen“ gezählt (`itemsSkipped`, wie
`chmod -R`). Systemaufrufe ohne Folgen: `fchmodat(…, AT_SYMLINK_NOFOLLOW)` (glibc ≥ 2.32; liefert für einen Link
`EOPNOTSUPP` – alte glibc: Rückfall auf `chmod`, nachdem `lstat` „kein Link“ sagte), `utimensat(…,
AT_SYMLINK_NOFOLLOW)`, `lchflags`, `setattrlist(…, FSOPT_NOFOLLOW)`; Windows öffnet mit
`FILE_FLAG_OPEN_REPARSE_POINT`. Kein Öffnen von Dateien unter Unix → auch Dateien ohne Leserecht und FIFOs gehen.

**E5 Eigentümer/Gruppe: nicht in diesem Prompt.** Als normaler Nutzer kann man nur die Gruppe auf eine eigene
Gruppe ändern; das bräuchte einen weiteren Command (Gruppenliste) und Dialogfläche für einen seltenen Fall. Die
Shell-Zeile (021) kann `chgrp`. Offen in §7.

**E6 Plattformfelder.** Unix (Linux/macOS): 9 rwx-Bits + setuid/setgid/sticky (Warnhinweis, sobald eines gesetzt
wird), Oktalfeld. macOS zusätzlich „versteckt“ (`UF_HIDDEN`; der Name mit Punkt bleibt unter Linux die einzige Art
„versteckt“ – kein Feld). Windows: Schreibgeschützt, Versteckt, System, Archiv (`SetFileAttributesW` mit den
bisherigen setzbaren Bits; Ergebnis 0 → `FILE_ATTRIBUTE_NORMAL`). Zeiten: Änderung und Zugriff überall; Erstellzeit
unter Windows (`FileTimesExt::set_created`) und macOS (`setattrlist` `ATTR_CMN_CRTIME`) – Linux kann die
Geburtszeit nicht setzen (kein Feld). Rust lehnt Felder ab, die das OS nicht kennt (`invalid_path`). Das Frontend
wählt die Felder über `detectPlatform()`.

**E7 Reihenfolge bei Rekursion.** Ordner werden nach ihrem Inhalt geändert (`chmod -R a-x` sperrt sich nicht selbst
aus) – außer die Änderung gibt dem Eigentümer Lese- oder Ausführrecht, das er noch nicht hat: dann zuerst der
Ordner, danach der Inhalt (`u+rx` auf einem gesperrten Ordner). Iterativ mit eigenem Stapel (keine Rekursion im
Stack), keine Links, Abbruch und Pause je Eintrag. Fortschritt: Anzahl ohne Gesamtzahl (kein Vorab-Zählen).

**E8 Gefahr.** Rekursiv auf Wurzel/Home/Systemordnern → `dangerous_path` ohne Zweitbestätigung (ein `chmod -R` auf
`~` kann SSH-Schlüssel und Login brechen). Nicht rekursiv ist es erlaubt (ein Eintrag, bewusst gewählt).

**E9 Ausgangswerte.** Der Dialog lädt `get_properties` für höchstens 100 markierte Einträge (Links ausgenommen,
Request-Sequenz gegen veraltete Antworten). Je Bit/Flag: alle gleich → an/aus, sonst „gemischt“
(`indeterminate`). Mehr als 100 Einträge oder ein Fehler → alles „gemischt“. Ein Kästchen schaltet an → aus → (nur
wenn es gemischt begann) gemischt. Gesendet werden nur **angefasste** Felder, die nicht „gemischt“ sind – das gilt
auch, wenn ihr Wert dem Ausgangswert gleicht (wichtig für rekursiv). Oktalfeld: zeigt den Modus, wenn kein Bit
gemischt ist; 3 Ziffern fassen die 9 rwx-Bits an, 4 Ziffern alle 12. Zeiten: Kästchen „ändern“ + „jetzt“ oder
Datum/Zeit (`datetime-local`, Sekunden; Vorgabe = Wert des ersten Eintrags, sonst jetzt).

**E10 Sperren.** `OPEN_CHANGE_ATTRIBUTES_DLG` in `OFF_IN_ARCHIVE` und `OFF_WHILE_UNCHECKED`; Rust lehnt virtuelle
Archivpfade ohnehin ab (`lstat` scheitert → Fehler je Eintrag). `expected` (030 E5) wird nicht mitgeschickt:
Attribute ändern löscht und verschiebt nichts.

## 3. Verträge

Rust (`jobs/mod.rs`, `attributes.rs`):
```rust
JobSpec::Attributes { paths: Vec<String>, change: AttrChange,
                      #[serde(default)] recursive: bool, #[serde(default)] apply_to: ApplyTo }
pub struct AttrChange { mode_set: u32, mode_clear: u32,              // #[serde(default)] überall
                        readonly/hidden/system/archive: Option<bool>,
                        modified/accessed/created: Option<TimeValue> }
#[serde(tag = "type")] pub enum TimeValue { Now, At { ms: i64 } }   // ms: Jahr 1601 … 9999
pub enum ApplyTo { All /*default*/, Files, Dirs }
```
Fehlercodes: `invalid_path` (leer, relativ, Masken, Plattform, Zeitbereich, zu viele), `dangerous_path` (rekursiv),
je Eintrag `symlink_skipped` (neu), `not_found`, `permission_denied`, `io`. Summary: `itemsDone` = geänderte
Einträge, `itemsSkipped` = Links im Inhalt, `itemsFailed` + `errors`.

`properties.rs`: `UnixPerms.flags_hidden: Option<bool>` (macOS `UF_HIDDEN`, sonst `null`).

TS: `core/attributes/attributes.models.ts` (`AttrChange`, `TimeValue`, `ApplyTo`), `JobSpec` um `attributes`,
`FsErrorCode` um `symlink_skipped`, `UnixPerms.flagsHidden`.

UI-Skizze (Fokus von oben nach unten, alles per Tab erreichbar):
```
Change attributes – 3 entries                         role=dialog, aria-modal
┌ Permissions (fieldset) ─────────────────────────┐   Unix
│           Read  Write  Execute                  │   Tabelle, Kästchen mit aria-label
│ Owner     [x]   [x]    [–]                       │   „–“ = gemischt (indeterminate)
│ Group     [x]   [ ]    [ ]                       │
│ Others    [x]   [ ]    [ ]                       │
│ [ ] Set user ID  [ ] Set group ID  [ ] Sticky    │   Warnhinweis, wenn gesetzt
│ Octal [0644]                                     │
└──────────────────────────────────────────────────┘
┌ Attributes ┐ Windows: Read-only Hidden System Archive · macOS: Hidden
┌ Times ┐ [ ] Modified ( ) now (•) [2026-10-20 12:00:00] · [ ] Accessed … · [ ] Created (Win/macOS)
[ ] Also change the contents of folders   Apply to: (•) files and folders ( ) files ( ) folders
3 entries · 2 changes (2 links stay unchanged)          aria-live=polite
Fehlerzeile (role=alert)                      [Cancel] [Change] (Strg/⌘+Enter)
```

## 4. Tests

- Rust `attributes.rs`: Validierung (Masken, disjunkt, leer, Plattformfelder, Zeitbereich), `new_mode`,
  `owner_gains_access`, Zeitumrechnung (negativ, Nanosekunden).
- Rust `jobs/tests_attributes.rs` (über den `JobManager`): Bits setzen/löschen an Datei/Ordner mit Umlaut/Leerzeichen,
  Mehrfachauswahl mit verschiedenen Modi, rekursiv mit `files`/`dirs`/`all`, Link markiert/im Inhalt/dangling (Ziel
  unverändert), Zeiten (Datum, nur Zugriff, „jetzt“, Ordner), fehlender Eintrag, Abbruch, `dirsChanged`, Gefahr
  rekursiv auf Home, gesperrter Ordner `u+rx` (nur ohne root), setuid.
- Frontend: `attributes-logic.spec.ts` (Ausgangszustand, Zyklus, Oktal, `buildChange`, Zählen, Beschreibung),
  `attributes.spec.ts` (Store + Dialog: Auswahl, Laden, Start, Meldungen, Felder je Plattform, Strg+Enter, Sperren,
  Eigenschaften → Ändern), `job-format`-Titel, Kataloge.
- E2E (Xvfb, Linux): Akzeptanzkriterien aus dem Prompt.

## 5. Fortschritt

- [x] Prompt + Design
- [ ] Rust
- [ ] Frontend
- [ ] E2E unter Xvfb
- [ ] Doku
- [ ] Abschluss + Review

## 6. Review

(folgt)

## 7. Offen

- Eigentümer/Gruppe ändern (E5).
- macOS- und Windows-Code nur in der CI kompiliert, bei Marc zu prüfen.
