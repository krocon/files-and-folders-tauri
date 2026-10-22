# TODO – Stand Mittwoch, 21.10.2026

Fertig und in `main`: **001–022, 024–026, 028–031** (023 verworfen); **032 Startermenü** im Branch `feat/starter-menue` (Details: `prompts/README.md`, Design-Dokumente
`prompts/NNN-*.design.md` mit Abschnitten „Review“ und „Offen“). `pnpm check` auf `main` grün (Linux).

## 0. SCSS → CSS

- [x] Umstellung übernommen (auch in 015: `settings-dialog.css`; CLAUDE.md §4: kein SCSS mehr).

## 1. Laufende Prompts

- [x] **022, 024, 025, 026, 031** (20./21.10., alle in `main`, PRs #19/#20): Konfigurations-Editoren, Attribute ändern,
      Archive erweitert (7z/RAR/Passwörter/ansehen), Import alter Konfiguration, Tabs ziehen + Verknüpfungen. Je ein
      **externes Review** (separater Agent), alle Befunde behoben – Tabellen „Externes Review“ in den Designs
      (`prompts/done/`). Wichtigste Korrekturen: Jobs arbeiten mit dem geprüften Pfad, `..` abgelehnt, Gefahrenprüfung
      physisch (alle Job-Arten); Attribute über Ordner-Deskriptoren ohne Link-Folgen; 7z-Header fail-closed geprüft
      (Bomben-Testdaten, Mutations-Fuzzing ohne Befund); Tools aus dem Import einzeln sichtbar/gewählt + Digest.
- [x] **034 Server-Verbindungen** (21.10., Branch `feat/server-verbindungen`): FTP/FTPS/SFTP als Ordner, Profile,
      Passwörter nur im Schlüsselbund, Host-Key/Zertifikat bestätigen, Jobs in beide Richtungen. Getestet gegen
      In-Process-Server, vsftpd (auch FTPS mit `require_ssl_reuse`) und sshd im Container, Secret Service unter Linux.
      Folgeideen (Design 034 E0): F4 mit Zurückladen, Fortsetzen abgebrochener Übertragungen (`REST`/Offset),
      `~/.ssh/config`-Aliasse, Jump-Host/Proxy, chmod auf Servern, Suche auf Servern, WebDAV/S3, parallele
      Übertragungen je Job, Master-Passwort-Datei für Linux ohne Schlüsselbund (nur auf Wunsch).
- [ ] **023 eingebauter Editor** – verworfen (Marc, 20.10.).
- [x] **027 Persistenz je Ordner** (21.10., in `main`): `folder-memory.json` je Tab, `dialogs.recent`.
- [ ] **035 Archive bearbeiten** – Prompt `prompts/035-archive-bearbeiten.md`: in ZIP/TAR (dann 7z) kopieren und darin
      löschen – Temp-Datei + atomar ersetzen, als Job (025 E9).
- [ ] **Neue Prompts 036–041** (21.10.): Ordner synchronisieren, Dateien vergleichen, Flache Ansicht, Prüfsummen,
      Panel-Aktionen, Spalten/Ansichten – Reihenfolge in `prompts/README.md` „Nächste Prompts“.

- [x] **030 Ordner-Cache + schnelleres Listing (SMB)** (20.10., in `main`). `getattrlistbulk` auf dem Mac geprüft (gleich
      auf APFS/SMB), an der SMB-Freigabe gemessen – kein Gewinn, ausgebaut (Branch `chore/ohne-getattrlistbulk`).
      **Bei Marc:** in der App in einen SMB-Ordner, Unterordner, zurück → sofort da, „Stand … · wird geprüft …“.
- [x] **029 Bedienbar bei langen Jobs** (20.10., in `main`):
      Anlass Marcs Screenshot (Ziel-Panel beim Kopieren aufs langsame Laufwerk gesperrt). Auffrischen ohne Overlay,
      Drossel, Hinweis „antwortet langsam“ + Esc, Tab-Wechsel sofort aus dem letzten Listing, Watcher hält Rescans von
      Job-Zielen zurück, ein Listing je hängendem Ordner, 1-MiB-Blöcke + `F_NOCACHE`, Commands async. E2E unter Xvfb
      mit `FNF_TEST_SLOW`. **Bei Marc prüfen:** Kopie auf das echte langsame Laufwerk (USB/NAS) auf macOS – Panel
      bedienbar? `F_NOCACHE` messbar (Aktivitätsanzeige → Speicher)? Menüs/Fenster nach der async-Umstellung normal?
- [x] **015 Einstellungen/i18n** – in `main` (19.10.): `main` eingemergt (About aus 017 bleibt, Texte von
      016/017/019 übersetzt), E2E unter Xvfb, Review (16 Befunde, Tabelle in Design §6), Doku. Offen (Design §9):
      ~~Button-Editor~~ (022), Spaltenauswahl, Dialog-Optionen 008/010 dauerhaft, weitere Sprachen; Leertaste/Start-Ordner/
      Netzlaufwerk-Polling nur E2E bzw. ohne eigenen Store-Test.
- [x] **018 Feature-Parität + 020 Actions-Menü** (19.10.): Matrix gegen `old_project/` in `docs/feature-parity.md`
      (192 ✅, 26 🟡, 11 ⬜, 24 ✖), kleine Lücken geschlossen, E2E Linux. Nächstes: Folge-Prompts **021–028** schreiben
      (Vorschläge in `docs/feature-parity.md` „Folge-Prompts“: Shell-Leiste, Konfig-Editoren, Editor, Attribute,
      Archive, Import alter Konfiguration, Persistenz je Ordner, Drag & Drop).

## 2. Auf dem Mac prüfen (Marc – im Container nicht möglich)

`pnpm tauri dev` baut auf macOS (nur 2 Warnungen, behoben in `d4ca3f3`). Bitte durchklicken:

- [ ] Natives Menü (014): ⌘-Kürzel in Textfeldern (F2-Editor, Filter) lösen **keine** Aktion aus; Kürzel-Badges.
- [ ] Papierkorb (006): Finder-Erlaubnis, „Zurücklegen“.
- [ ] Multi-Rename (007): nur Groß/klein (`a.txt` → `A.txt`) und NFD-Namen auf APFS; Tausch `a↔b`; Undo.
- [ ] Überwachung (012): Änderungen im Finder erscheinen sofort; Drop aus dem Finder öffnet den Kopieren-Dialog.
- [ ] OS-Integration (011): Laufwerke (`/Volumes`), „Im Finder zeigen“ (⌘⇧F), Terminal (⌘⇧C), F4.
- [ ] Vorschau (010): Schnellvorschau ⌃Q, Bilder, ⌘I Eigenschaften.
- [ ] Themes (013/019): System-Hell/Dunkel live; die acht alten Designs ansehen.
- [ ] Einstellungen (015): App-Menü „Einstellungen…“ (⌘,), Sprache umschalten (auch natives Menü), Zeilenhöhe.
- [ ] Arbeitstag (018) auf macOS und Windows: markieren, F5 mit Konflikt, Multi-Rename, Gruppieren, Suchen, Tabs,
      Neustart; alte Kürzel ⌃⌘D (abwählen), ⌃⌥D (Pfad), ⌃⌘C/M/R/A, ⌃⌥G/N/M, ⇧Leertaste.
- [ ] Actions-Menü (020): ⌃K ⌃M öffnet es (macOS), Badges `^ ⌘ alt ⇧` lesbar in hellen und dunklen Designs.
- [ ] Konfig-Editoren (022): Vollbild über die Palette (macOS) und F11 (Windows); Button-/Dateityp-Editor.
- [ ] Attribute (024): macOS „versteckt“ im Finder, Erstellzeit; Windows R/H/S/A im Explorer, Zeiten auf Ordnern,
      lange Pfade (> 260).
- [ ] Archive (025): 7z/RAR auf macOS/Windows öffnen und entpacken, Passwortdialog; aus einem heruntergeladenen Archiv
      Entpacktes trägt die Quarantäne (macOS) bzw. Zone.Identifier (Windows) – Datei öffnen zeigt die Warnung.
- [ ] Import (026): echte alte mr-Installation (macOS) importieren, Kürzel/Buttons/Tools prüfen.
- [ ] Server (034): Profil anlegen, Passwort „im Schlüsselbund speichern“ → Eintrag in der Schlüsselbundverwaltung
      (Dienst `io.github.krocon.filesandfolders`, Konto `remote:<id>:password`), Neustart → Verbinden ohne Frage.
      Unsignierter Build: macOS fragt nach jedem neuen Build einmal „Zugriff erlauben“ (erwartet, s. `docs/release.md`).
      SSH-Agent (1Password/ssh-agent) mit Anmeldung „SSH-Agent“; FTPS gegen einen echten Server mit Zertifikat einer CA.
      Windows (CI/Marc): Anmeldeinformationsverwaltung, Pageant/OpenSSH-Agent, Build von `ring`/`russh`.
      Heruntergeladene Server-Datei (F5 oder Enter) trägt Quarantäne (macOS, `xattr -p com.apple.quarantine`) bzw.
      `Zone.Identifier` (Windows, ZoneId=3) – Öffnen zeigt die Warnung (Review 034).
- [ ] Server (034, offen aus dem Review): rekursives Löschen auf FTP-Servern, die Links per MLSD als `type=dir` melden
      (Pure-FTPd, IIS) – Link-Erkennung über FTP ist unzuverlässig; Idee: auf MLSD-Servern vor dem Absteigen `LIST -ld`
      prüfen oder rekursives Löschen dort nur nach Rückfrage. Zwei Profile für denselben Server (SFTP + FTP): Move mit
      „Überschreiben“ kann Quelle = Ziel treffen. `Pool.killers` wächst bis zum Trennen.
- [ ] Panel-Aktionen (040): `⌘U`/`⌘⇧U` tauschen, `⌘⌥O` Ziel = Quelle, `⌘⌥←/→` öffnet den Cursor-Ordner links/rechts;
      im Pfad-/Filterfeld bleiben `⌘←/→` Zeilenanfang/-ende; Einträge im nativen Fenster-Menü.
- [ ] Startermenü (032): natives Menü „Start“ (macOS), `⌥S` in der Liste öffnet das Popup (in Textfeldern tippt es
      weiter „ß“), Eintrag mit einer `.app` (`/Applications/Preview.app`, Parameter `%P%N`), Ordner-Eintrag `~/…`;
      Windows: `.bat`/`.cmd` als Kommando, `notepad.exe "%P%N"`.
- [ ] Tabs/Links (031): Tab mit ⌥ ziehen (Kopie), ⌃⇧Bild↑/↓; Datei mit ⌘⌥ ziehen = Link; Windows ohne Entwicklermodus
      → Meldung `link_not_permitted`.

## 3. CI und Plattformen

- [ ] **Actions auf GitHub einschalten**: Stand 22.10.2026 gibt es trotz `.github/workflows/ci.yml` auf `main` keinen
      einzigen Lauf und keinen registrierten Workflow (Settings → Actions → General → „Allow all actions“). Danach die
      Vorlagen aus `docs/ci/` übernehmen (`docs/ci/README.md`).
- [x] `#[cfg]`-Code für Windows/macOS kompiliert: Cross-Check `pnpm rust:cross` (clippy, Lib + Tests) für
      x86_64-pc-windows-msvc, aarch64-apple-darwin, x86_64-apple-darwin grün (22.10.2026). Offen bleibt das
      **Verhalten** auf echten Systemen (Tests laufen nur in der CI bzw. auf Marcs Mac).
- [x] Erster CI-Lauf auf macOS/Windows (22.10.2026, nach Merge von #30): Frontend und Linux grün; macOS 3, Windows 17
      rote Tests. Behoben auf `fix/ci-macos-windows`: Testannahmen aus Linux (`/`-Pfade, JSON ohne Escaping, `pwd` mit
      `/private/var`, `choose_posix`, FILETIME-Raster), dazu echt: Windows-Watcher meldete gelöschte Ordner nicht
      (`watch::self_check`), Umbenennen nur der Schreibweise auf Servern ohne Groß/klein-Unterscheidung, Attribute nie
      an einem Link (macOS kann `lchmod`).
- [ ] 7-Zip für Windows öffnet unsere AES-ZIPs mit Nicht-ASCII-Passwort nicht (Schlüssel aus anderer Kodierung als
      UTF-8; 7z-Archive gehen). Prüfen: WinZip/Explorer, ggf. Hinweis im Pack-Dialog bei Nicht-ASCII + ZIP.
- [x] Windows (22.10.2026, `fix/windows-details`): Papierkorb nur auf festen Laufwerken (`platform::has_trash`, Code
      `no_trash` statt Windows-Dialog/endgültig, 006 #5); `rename_noreplace` atomar über `MoveFileExW` ohne REPLACE
      auch für Ordner/Links (007 #6); Pause der Watcher beim Verschieben des Elternordners Ende-zu-Ende getestet
      (`moving_the_parent_of_a_watched_folder_works_with_the_guard`, 012 #3) – alles in der CI auf Windows.
- [x] `THIRD-PARTY-NOTICES.txt` (22.10.2026): `pnpm notices`, in jedem Paket, geprüft in `pnpm check` (`docs/release.md`).
- [ ] About-Dialog: Link „Drittlizenzen“ auf die mitgelieferte `THIRD-PARTY-NOTICES.txt` (Ressourcenpfad über Tauri).
- [ ] CI: Tests von `platform/attributes.rs` (`setattrlistat`, `SetFileInformationByHandle`), `entry_id`,
      `make_symlink`, `platform/origin_mark.rs`, Papierkorb/Hardlinks (042) auf macOS/Windows **ausführen**; der
      UnRAR-C++-Build (Xcode/MSVC, Feature `rar`) wird vom Cross-Check nicht gebaut (Platzhalter-Compiler).

## 4. Kleinere offene Punkte

- [ ] 022: doppelte Kategorienamen nur in der gespeicherten Form verglichen („Filme“ neben `movies`); `aria-invalid` an
      `role=option`; Buttons für Tools aus `tools.json`.
- [ ] 024: Eigentümer/Gruppe ändern (`getgroups` + `fchownat`); Windows: Zwischenordner werden per Pfad aufgelöst.
- [ ] 025: Passwort-Banner im Panel zeigt den Text doppelt; mehrteilige Archive; 7z-Passwörter mit 1024 Zeichen und
      2²² Runden ≈ 45 s (Längengrenze?); UnRAR formal Data Race (blake2s/ErrHandler, upstream); Upstream-Issue an
      `sevenz-rust2`: Grenzen in `Archive::read`, keine Header-Suche ohne CRC.
- [ ] 026: Fokus nach der Rückfrage ins Pfadfeld statt auf „Importieren“; kein Timeout beim Scan auf hängendem NAS.
- [ ] 031: „Verknüpfung anlegen“ im Kontextmenü der Liste.
- [ ] Flackernd unter Last: `watch::tests::a_busy_target_holds_its_reload_until_the_job_ends` (wie der Rescan-Test).

- [ ] Flackernder Test (22.10., vor 042 gefunden): `jobs::tests_remote::sftp_up_down_conflicts_move_delete` und
      `ftp_up_down_conflicts_move_delete` – Kopie Server → Server endet als `DoneWithErrors` statt `Done` (Zeile
      124), etwa jeder 3. Lauf von `cargo test --lib tests_remote`, allein nie. Verdacht: Testserver/Pool unter
      gleichzeitigen Tests.
- [ ] 042: HEIC/AVIF für ähnliche Bilder (bräuchte libheif/dav1d); Fortschritt während der Gruppierung (nur Bilder
      zählen); Windows: `FileIdInfo` (128-Bit-Ids auf ReFS) statt `nFileIndex`; Bildersuche auf macOS/Windows
      messen (Release, 4 Worker). **Bei Marc prüfen:** Papierkorb unter macOS/Windows aus dem Job `dedupe`, Hardlinks
      unter Windows (NTFS) als „gleiche Datei“.
- [ ] Flackernder Test: `watch::tests::a_mass_change_becomes_a_rescan` scheiterte einmal im Gesamtlauf (timing).
- [ ] Bundle-Budget auf 1,5 MB angehoben (Merge 009) – Dialoge per `@defer` nachladen, dann zurücksetzen.
- [ ] 019: Kontrast-Korrekturen in `docs/legacy-themes-contrast.md` durchsehen; Fehlertext in Dialogen hat kein
      eigenes Token (Norton 1,9:1).
- [x] 016: 7z/RAR, Dateien im Archiv ansehen, ZIP-Zeiten, Konfliktdialog „Cancel copying“ – erledigt mit 025.
- [x] 012: Ziehen aus der App ins System – **028** (20.10., Branch `feat/drag-ins-system`). **Bei Marc prüfen:**
      Datei/Ordner/mehrere markierte aus der Liste in den Finder, auf den Schreibtisch und in Mail ziehen (macOS);
      Explorer/Desktop unter Windows (erst die CI kompiliert den Code – `drag`-Crate). Verknüpfung per Drag und
      Tabs ziehen: erledigt mit 031; Verschieben ins System bewusst nicht (031 E11).
- [x] Drop aus dem Finder landete auf dem Mac immer links (Position doppelt skaliert) + Tabs als Drop-Ziele – Branch
      `feat/drop-ziele-tabs` (auf 028). **Bei Marc prüfen:** Finder → rechte Seite, Finder → nicht offener Tab.
- [ ] Spalte „Modified“ ist für das US-Format (`10/19/2026, 08:48 AM`) zu schmal – wird abgeschnitten (E2E 015).
- [ ] 015: `loadingText` der Table folgt keinem Sprachwechsel (Overlay-Texte nur beim Erzeugen, `TODO(guiexpert)`).
- [ ] GuiExpert-Table-Lücken G15–G19 an `mono/TODO.md` melden (Details in den Design-Dokumenten 009, 012).

## 5. Logo

- [x] Nutze als App-Logo das Logo in 'docs/logo' (erledigt in `0ab9a54`: `ff-green` als `app-icon.svg`, Icons + favicon)
