# Prompt 034: Server-Verbindungen – FTP, FTPS, SFTP als Ordner im Panel

> **Slug:** `server-verbindungen` · **Braucht:** 003 (Navigation, Ordnermenü ▾, Favoriten), 004 (Tabs, Sitzung),
> 005 (Job-Engine), 006 (Kopieren/Verschieben/Löschen, Konflikte, `DangerCheck`), 010 (Ansicht F3, Eigenschaften),
> 011 (Laufwerke im Ordnermenü), 015 (Einstellungen, i18n, Export/Import), 016/025 (virtuelle Pfade, App-Cache zum
> Ansehen, Passwörter nur im Speicher), 022 (Konfig-Editoren, `config_file.rs`), 029/030 (langsame Laufwerke,
> `ListingCache`, `expected`) · **Umfang:** L (ggf. in zwei Teile schneiden, s. E0)
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/016-archive-duplikate.design.md` (E1: virtuelle
> Ordner, Vetos), `prompts/done/025-archive-erweitert.design.md` (Passwörter, `secrets.rs`, App-Cache `view.rs`),
> `prompts/done/030-ordner-cache-smb.design.md` (Cache, ungeprüfte Listings, `expected`) und
> `prompts/done/005-job-queue.design.md` (Verträge der Engine). Auftrag von Marc (21.10.2026). Neu – weder die alte
> Version noch mr hatten Server-Verbindungen; in `docs/feature-parity.md` unter A.4 „Nur neu“ eintragen.

## Auftrag (wörtlich)

> Bau bitte eine Möglichkeit ein, sich mit anderen Servern zu binden: ftp, usw. bei ftp sollte es die Möglichkeit
> geben, dass Passwort zu speichern (verschlüsselt!, falls man das sicher machen kann).

Vorlagen (Screenshots von Marc, `prompts/done/034-vorlage-ftp-explorer.png`, `prompts/done/034-vorlage-cloudmounter.png`):

- **FTP Explorer „Connect“** (klassisch): links Profilliste, rechts Formular *Profile Name · Host Address · Port ·
  Use PASV Mode · Use Firewall · Login · Anonymous · Password · Initial Path · Attempts · Retry Delay · Download Path ·
  Description*; Knöpfe *New Profile · Delete · Add · Save · Create Shortcut · Connect · Cancel*.
- **CloudMounter** (modern): links Verbindungen mit Symbol und Typ („FTP with TLS/SSL“, „SFTP“, WebDAV, S3 …), unten
  „Add new connection“; rechts *Name · Type (Auswahl) · Server · Port · Username · Password (maskiert) · Anonymous
  login · Limit simultaneous connections · Mode (Passive) · Remote path*; Knöpfe *Delete* und *Mount/Unmount*.

Übernehmen: Profilliste links + Formular rechts, Typ als Auswahl, die die Felder umschaltet (Port-Default je Typ),
„Anonym“, Passiv-Modus, Startpfad, Beschreibung, max. gleichzeitige Verbindungen, „Verbinden“ direkt aus dem Dialog,
„Als Favorit anlegen“ (= *Create Shortcut*). Nicht übernehmen: „Download Path“ (das Ziel ist bei uns die andere
Seite), „Use Firewall“ (SOCKS/Proxy höchstens als Folgeidee), ein Mount als Laufwerk ins Betriebssystem.

## Ziel

Der Nutzer legt Verbindungsprofile an (FTP, FTPS, SFTP), verbindet sich und arbeitet im Panel mit dem Server wie mit
einem Ordner: Navigieren, Tabs, Verlauf, Filter, Sortieren, Kopieren/Verschieben zwischen lokal und Server in beide
Richtungen (als Job mit Fortschritt, Abbruch, Konflikten), Löschen, Ordner anlegen, Umbenennen, F3 ansehen, Öffnen.
Passwörter (und SSH-Schlüssel-Passphrasen) lassen sich **sicher** speichern – im Schlüsselbund des Betriebssystems,
nie im Klartext in einer Datei, nie im Frontend nach dem Speichern, nie in Logs, Events, Pfaden oder der Sitzung.

## Bestand

- **Virtuelle Ordner** (016 E1): `list_directory` fällt in `archive::list_directory_or_archive` auf Archive zurück;
  `DirectoryListing.archive` markiert das Listing, `ActionService.setVeto` sperrt, was echte Dateien braucht.
  Archivpfade sind aber echte `Path`-Verlängerungen (`…/a.zip/inner`) – Serverpfade sind das **nicht**
  (Schema, Host, `/`-Trenner unabhängig vom OS). Muster für Vetos, Breadcrumbs und Tabs; Pfadmodell neu entscheiden
  (E1).
- **Passwörter** (025): `archive/secrets.rs` – `Secret(Zeroizing<String>)`, nur im Speicher, nie serialisiert;
  Passwortdialog `features/archive/password-dialog.ts`, Fassade `set_archive_password`. Muster für die Sitzungs-
  Passwörter; das **dauerhafte** Speichern ist neu (E3).
- **Ansehen aus einer Nicht-Datei** (025): `archive/view.rs` legt Einträge in einen App-Cache, F3/Enter öffnen von
  dort – gleiches Muster für Serverdateien (herunterladen → Cache → ansehen/öffnen).
- **Langsame Laufwerke** (029/030): `ListingCache` (Netzlaufwerk-Ordner sofort aus dem Cache, „ungeprüft“), Vetos
  `OFF_WHILE_UNCHECKED`, `expected` bei Delete/Move, Listing abbrechbar, `listing_gate.rs` (ein Listing je hängendem
  Ordner), `FNF_TEST_SLOW`. Serverordner sind „langsam“ im Sinne von 030.
- **Jobs** (005/006): `JobSpec` in `jobs/mod.rs`, `manager.rs` (`validate`, `paths::validate_job_path`, `run`),
  `copy.rs` (Planung, `.part` + `rename`, Konflikte, „Platte voll“ pausiert), `delete.rs`; Hilfs-Job `count`.
- **Konfiguration** (022): `config_file.rs` (gemeinsamer Lader, kaputt → `.bad`, atomar), Einstellungs-Export/Import
  `settings.rs` (Bündel aller Teile) – Profile gehören hinein, **Passwörter nicht**.
- **Ordnermenü ▾** (003/011): Laufwerke, Favoriten, zuletzt besucht – Platz für „Verbindungen“.
- **Sitzung** (004): Tabs mit Pfad in `session.json` – ein Serverpfad darf dort stehen, aber ohne Geheimnisse.

## Aufgaben

1. **Verbindungsprofile** (Rust `remote/profiles.rs`, Datei `<app_config_dir>/connections.json`, `version: 1`, über
   `config_file.rs`): Id (stabil, nicht der Name), Name, Typ (`ftp` | `ftps-explicit` | `ftps-implicit` | `sftp`),
   Host, Port (Default je Typ: 21/990/22), Benutzer, Anonym, Authentifizierung (SFTP: Passwort | Schlüsseldatei |
   SSH-Agent), Pfad zur Schlüsseldatei, Startpfad, Passiv-Modus (FTP, Standard an), Zeichensatz der Namen (FTP:
   UTF-8/Latin-1/automatisch per `OPTS UTF8 ON`), Zeitüberschreitung, max. gleichzeitige Verbindungen, Keepalive,
   Beschreibung, „Passwort gespeichert“ (nur Flag – das Geheimnis liegt im Schlüsselbund). `sanitize` wie bei den
   anderen Nutzerdateien (Host/Port/Länge/Steuerzeichen prüfen). Commands `load_connections`, `save_connection`,
   `delete_connection` (löscht auch das Geheimnis), `test_connection`.
2. **Geheimnisse speichern** (Entscheidung E3, Rust `remote/credentials.rs`):
   - Standard: **Schlüsselbund des Betriebssystems** – macOS Keychain, Windows Credential Manager, Linux Secret
     Service (GNOME Keyring/KWallet über D-Bus). Kandidat: Crate `keyring` (aktuelle Version, Features je OS ohne
     breite Abhängigkeiten prüfen); Eintrag `service = "de.krocon.files-and-folders"` (Bundle-Id aus
     `tauri.conf.json` prüfen), `account = <profil-id>` – **nicht** Host/Benutzer im Klartext, damit der Eintrag
     beim Umbenennen stabil bleibt und keine Zugangsdaten verrät.
   - Kein Schlüsselbund verfügbar (Linux ohne Secret Service, Fehler): **nicht** stillschweigend auf eine Datei
     ausweichen. Optionen im Design bewerten: (a) dann nur „für diese Sitzung merken“ (im Speicher wie 025);
     (b) eigene verschlüsselte Datei mit **Master-Passwort** (Argon2id + XChaCha20-Poly1305/AES-GCM, Salt/Nonce je
     Eintrag, Master-Passwort nie gespeichert, nach Leerlauf vergessen); (c) beides. Ein Schlüssel, der neben der
     Datei liegt oder fest im Programm steckt, ist **keine** Verschlüsselung und scheidet aus – im Design so
     benennen.
   - Das Frontend schickt ein Passwort genau einmal (beim Speichern bzw. Verbinden) und bekommt danach nur
     `hasStoredSecret: bool` zurück; es gibt **keinen** Command, der ein gespeichertes Passwort ausliest.
     Felder im Dialog zeigen „gespeichert ••••“ mit „ändern“/„entfernen“.
   - Im Speicher von Rust: `Zeroizing` (Muster `secrets.rs`), nie `Debug`/`Serialize`, nie in Events,
     Fehlermeldungen, Logs, `session.json`, Export-Bündeln, Screenshots-Mock.
   - SSH-Schlüssel: Passphrase wie ein Passwort; den privaten Schlüssel selbst nie kopieren, nur den Pfad merken;
     SSH-Agent (`SSH_AUTH_SOCK`, Windows: OpenSSH-Agent/Pageant prüfen) bevorzugt, wenn vorhanden.
   - Klartext-FTP: Dialog warnt deutlich („Passwort wird unverschlüsselt übertragen“), Speichern bleibt möglich.
3. **Protokolle** (Rust `remote/`, ein Trait mit gleicher Signatur je Protokoll – `list`, `stat`, `read`
   (Strom/Range), `write` (Strom), `mkdir`, `rename`, `remove_file`, `remove_dir`, ggf. `set_mtime`):
   - **FTP/FTPS**: Kandidat `suppaftp` (mit `rustls`, ohne OpenSSL); `MLSD`/`MLST` bevorzugen, `LIST`-Parser
     (Unix/DOS) als Rückfall, Passiv/EPSV, Binärmodus, `REST` zum Fortsetzen (Folgeidee), TLS-Zertifikat **prüfen**;
     selbstsignierte nur nach Anzeige des Fingerabdrucks und ausdrücklicher Bestätigung, gemerkt je Profil (Pin).
   - **SFTP**: Kandidaten `russh` + `russh-sftp` (reines Rust) vs. `ssh2` (libssh2, C-Abhängigkeit, Build auf allen
     drei OS) – im Design abwägen (Build, Wartung, Agent-Unterstützung, Algorithmen). **Host-Key-Prüfung Pflicht**:
     eigene `known_hosts`-Datei der App (oder `~/.ssh/known_hosts` lesend?), beim ersten Mal Fingerabdruck
     (SHA256) zeigen und bestätigen lassen, bei Änderung hart ablehnen mit klarer Warnung.
   - Verbindungspool je Profil (max. gleichzeitige Verbindungen aus dem Profil), Keepalive, automatisches
     Wiederverbinden nach Abbruch (mit gemerktem Geheimnis bzw. erneuter Abfrage), Zeitüberschreitungen; alles auf
     eigenen Threads bzw. `spawn_blocking`, nie auf dem Main- oder Async-Runtime-Thread (029 E11). Abbrechbar.
   - Neue Crates mit Begründung in `docs/architecture.md` („Abhängigkeiten“), Lizenzen in `docs/licenses.md`.
4. **Pfadmodell und Listing** (Entscheidung E1): Serverpfade im Panel, in Tabs, Verlauf, Breadcrumbs, Sitzung.
   Vorschlag: URL-artig mit **Profil-Id statt Zugangsdaten**, z. B. `fnf-remote://<profil-id>/pfad/darunter`
   (Anzeige mit Profilname: „Mein Server: /pub/ftpx“). Rust zerlegt/verbindet diese Pfade (Eltern, Segmente,
   `join`) mit eigener Logik (immer `/`), das Frontend bleibt bei opaken Strings. `list_directory` dispatcht nach
   Präfix auf `remote::list`; `DirectoryListing` bekommt ein Feld (z. B. `remote: { profileId, name, kind }`), das
   wie `archive` Vetos und Anzeige steuert. Listing-Einträge: Name, Art (Datei/Ordner/Link), Größe, mtime, Rechte
   (soweit geliefert); Links auf dem Server: Ziel per `stat` auflösen, Zyklen vermeiden. `ListingCache` und
   „ungeprüft“ wie bei Netzlaufwerken (030); Ordner-Überwachung aus (höchstens manuelles Auffrischen, Ctrl+R).
   Pfade mit Leerzeichen, Umlauten, Emoji, `#`, `%`, `?` müssen funktionieren (Kodierung im Design festlegen).
5. **Dateioperationen als Jobs** (Erweiterung von `copy`/`delete` oder eigene Job-Arten `upload`/`download`/
   `remoteCopy` – Entscheidung E4):
   - lokal → Server, Server → lokal, Server → anderer/derselbe Server (über einen Strom durch die App; serverseitig
     `RNFR/RNTO`/`rename` für Verschieben auf demselben Server), rekursiv mit Planung und Zählen vorab.
   - Konflikte wie 006 (Größe/Datum beider Seiten in der Frage), nie eine halbe Datei unter dem echten Namen
     (`.fnf-<job>.part` + `rename` auf dem Server, wenn der Server das kann; sonst begründet abweichen),
     Zeitstempel übernehmen, wo möglich (`MFMT`/`SETSTAT`). Abbruch räumt `.part`-Reste auf.
   - Löschen auf dem Server: **kein Papierkorb** → Dialog sagt „endgültig“ (wie Shift+F8), `DangerCheck`-Gegenstück
     für Server (Wurzel `/`, Home des Benutzers, Startpfad) mit zweiter Bestätigung; `expected` aus dem Listing.
   - Ordner anlegen (F7), Umbenennen (F2 in der Liste, Dialog), Multi-Rename (über `rename`, falls sinnvoll –
     sonst Veto), Datei anlegen.
   - Fortschritt (Bytes, Dateien, Rate), Pause, Abbruch über die bestehende Engine; parallele Übertragungen bis
     zum Limit des Profils.
6. **Ansehen und Öffnen**: F3/Schnellvorschau/Enter auf Serverdateien laden in den App-Cache (Muster 025 `view.rs`,
   Größenlimit, Abbruch, Hinweis bei großen Dateien) und zeigen bzw. öffnen von dort. F4 (Tool `edit`): herunterladen,
   öffnen, Rückschreiben **nur** als Folgeidee (Änderung erkennen und nachfragen) – im Design entscheiden, ob schon
   jetzt. Eigenschaften (010) mit den Daten vom Server.
7. **Vetos / Grenzen**: im Server-Panel gesperrt bzw. mit Hinweis: Attribute ändern (024; FTP `SITE CHMOD`/SFTP
   `setstat` höchstens Folgeidee), Shell-Zeile (021: `cd` in Serverpfad sinnlos), Terminal/Finder hier öffnen,
   Speicherbelegung (033), Ziehen ins System (028; Folgeidee: erst herunterladen), Verknüpfungen (031), Archive
   packen/entpacken direkt auf dem Server, Gruppieren/Aufräumen (008), Suche (009: nur Namen? – im Design
   entscheiden, Standard gesperrt), Ordnergröße (rekursives `LIST` – erlaubt, aber abbrechbar und mit Hinweis).
   Drag & Drop zwischen lokal und Server **innerhalb** der App erlaubt (= Kopieren/Verschieben-Dialog).
8. **Verbindungsdialog** „Verbindungen…“ (Muster der Screenshots, Konfig-Dialog wie 022): Liste links (Name, Typ-
   Icon aus Font Awesome 4.5.0, z. B. `fa-server`/`fa-lock` für TLS/SFTP), Formular rechts mit typabhängigen Feldern,
   Knöpfe Neu · Duplizieren · Löschen · Testen · Speichern · Verbinden · Als Favorit. „Testen“ verbindet, listet den
   Startpfad und meldet Ergebnis/Fehler (ohne Geheimnis im Text). Schnellverbindung: Feld für eine URL
   (`ftp://user@host:21/pfad`, `sftp://…`) → temporäres Profil, optional speichern (Passwort aus der URL nie
   übernehmen/anzeigen – abfragen). Tastatur/ARIA wie die anderen Dialoge (Fokusfalle, Liste als `listbox`).
9. **Verbinden/Trennen im Panel**: Aktionen (Ids im Design, z. B. `OPEN_CONNECTIONS_DLG`, `QUICK_CONNECT`,
   `DISCONNECT`) mit Kürzeln je OS (TC: Strg+F = FTP verbinden, Strg+N = neue FTP-Verbindung, Strg+Shift+F =
   trennen – gegen alle Keymaps prüfen; `Mod+F` ist bei uns die Suche!), Befehlspalette, Menü (Befehle bzw. neues
   Menü „Netz“), Ordnermenü ▾ Abschnitt „Verbindungen“ (Profile, verbundene zuerst), Favoriten mit Serverpfad.
   Statuszeile/Header zeigen Profilname, Verschlüsselung (Schloss / „unverschlüsselt“), Verbindungszustand.
   Passwortabfrage beim Verbinden ohne gespeichertes Passwort (Dialog mit „im Schlüsselbund speichern“ und „für
   diese Sitzung merken“). Trennen schließt Pool und Cache-Einträge des Profils; Tabs mit Serverpfad bleiben stehen
   und zeigen „nicht verbunden – Verbinden“.
10. **Sitzung**: Tabs mit Serverpfad werden gespeichert (nur Profil-Id + Pfad); nach dem Neustart **nicht**
    automatisch verbinden (kein Netzverkehr ohne Zutun, keine Schlüsselbund-Abfrage beim Start) – Platzhalter mit
    Knopf „Verbinden“; gelöschtes Profil → Hinweis, Tab bleibt bis zum Schließen.
11. **Einstellungen** (015, Schema in Rust + TS): Standard-Zeitüberschreitung, Keepalive-Intervall, max.
    Verbindungen je Profil, Größenlimit fürs Ansehen, „Passwörter im Schlüsselbund speichern anbieten“, Verhalten
    bei unbekanntem Host-Key/Zertifikat (immer fragen – kein „immer akzeptieren“). Export/Import der Einstellungen
    nimmt `connections.json` **ohne** Geheimnisse mit (Flag `hasStoredSecret` beim Import auf false). Texte en/de.

## Entscheidungsfragen (im Design mit Optionen, Empfehlung, Begründung)

- **E0 Schnitt:** alles in einem Prompt oder Teil 1 (Profile, Geheimnisse, SFTP + FTP/FTPS lesen, Download/Upload,
  Löschen/Anlegen/Umbenennen) und Teil 2 (Server ↔ Server, F4-Rückschreiben, Fortsetzen, weitere Protokolle)?
  Welches Protokoll zuerst (SFTP ist heute verbreiteter und sicherer, FTP war Marcs Beispiel)?
- **E1 Pfadmodell:** (a) URL-artige Pfade mit Profil-Id (Vorschlag); (b) eigener Panel-Modus mit getrenntem
  Zustand; (c) virtueller Ordner unter einer lokalen Wurzel (wie Archive). Kriterien: CLAUDE.md-Regel „Pfade sind
  opak, Rust rechnet“, Tabs/Sitzung/Verlauf unverändert, Windows-Pfade, Kopier-Ziel, Sicherheit (keine Zugangsdaten
  im Pfad), Aufwand der Vetos.
- **E2 Crates:** `suppaftp` (Features, TLS über `rustls`), SFTP `russh`/`russh-sftp` vs. `ssh2`, oder eine
  Sammel-Crate wie `opendal` (viele Dienste, aber großer Baum und eigene Abstraktion). Build auf macOS (universal),
  Windows, Linux; Lizenz; Wartungsstand; Größe des Binarys messen.
- **E3 Geheimnisse:** Schlüsselbund (Crate, Verhalten bei gesperrtem/fehlendem Schlüsselbund, macOS-Abfrage
  „Zugriff erlauben“ und signierte vs. unsignierte Builds – 017: Signierung nur vorbereitet!), Rückfall (nur
  Sitzung / Master-Passwort-Datei / beides), Lebensdauer im Speicher, was beim Löschen/Umbenennen eines Profils
  passiert. Bedrohungsmodell kurz aufschreiben (gestohlene Konfigdatei, anderer Nutzer, Malware als derselbe
  Nutzer – was schützt der Schlüsselbund, was nicht).
- **E4 Jobs:** bestehenden `copy`-Job um eine Quell-/Ziel-Abstraktion („Dateisystem“-Trait lokal/remote)
  erweitern oder eigene Job-Arten. Wie werden Konflikte, `.part`, Zeitstempel und „Platte voll“ auf dem Server
  abgebildet?
- **E5 Vertrauen:** Host-Keys (eigene `known_hosts` vs. die des Nutzers), FTPS-Zertifikate (Systemspeicher via
  `rustls-native-certs`/`rustls-platform-verifier`, Pinning selbstsignierter), Klartext-FTP erlauben mit Warnung.
- **E6 Kodierung und Listing-Formate:** `MLSD` vs. `LIST`-Parser, Zeitzonen von `LIST` (keine!), Latin-1-Server,
  Namen mit Zeilenumbruch/Steuerzeichen.
- **E7 Weitere Typen:** WebDAV (Nextcloud), S3, SMB direkt? Empfehlung: Trait so schneiden, dass sie später
  passen, aber nicht in diesem Prompt bauen (SMB ist über das OS gemountet bereits nutzbar, 030).

## Akzeptanzkriterien

1. Profil „Test SFTP“ anlegen, Passwort mit „speichern“ → `connections.json` enthält **kein** Passwort (auch nicht
   kodiert), der Schlüsselbund einen Eintrag; nach Neustart verbindet „Verbinden“ ohne Abfrage.
2. Profil ohne gespeichertes Passwort → Abfrage beim Verbinden; „nur für diese Sitzung“ → nach Neustart erneut
   gefragt.
3. Erster SFTP-Kontakt zeigt den Host-Key-Fingerabdruck; nach Bestätigung kein erneuter Dialog; geänderter
   Host-Key → Verbindung abgelehnt mit Warnung.
4. FTPS mit selbstsigniertem Zertifikat → Fingerabdruck-Dialog; Klartext-FTP → sichtbarer Hinweis
   „unverschlüsselt“ im Dialog und im Panel-Header.
5. Im Server-Panel: Navigieren, „..“, Zurück/Vor, Tabs, Filter, Sortierung, Breadcrumbs, Ordnermenü funktionieren;
   Namen mit Umlauten, Leerzeichen, Emoji und `#`/`%` werden korrekt angezeigt und bearbeitet.
6. F5 lokal → Server und Server → lokal (Ordner rekursiv, 100 Dateien, eine ≥ 100 MB) mit Fortschritt; Abbruch
   lässt keine `.part`-Datei und keine halbe Datei unter echtem Namen zurück; Konflikt fragt mit Größe/Datum.
7. F6 auf demselben Server verschiebt per Rename (ohne Datenübertragung); F7, F2 und F8 (endgültig, mit Warnung)
   funktionieren; `/` bzw. Home auf dem Server löschen verlangt die zweite Bestätigung.
8. F3 auf einer Textdatei des Servers zeigt sie (Cache), Enter auf einem Bild öffnet es.
9. Verbindung bricht ab (Server neu starten / Netz weg) → klare Meldung, Panel bleibt bedienbar, „Wiederholen“
   verbindet neu; nichts friert ein (hängender Server simuliert, s. Tests).
10. Gesperrte Aktionen (Attribute, Shell, Speicherbelegung, Ziehen ins System …) sind im Server-Panel gedimmt mit
    Hinweis.
11. Neustart mit Server-Tab → Platzhalter „nicht verbunden – Verbinden“, kein automatischer Verbindungsaufbau.
12. Export der Einstellungen enthält die Profile ohne Geheimnisse; Logs/Events enthalten weder Passwörter noch
    Passphrasen (Test mit Suchmuster).
13. Deutsch/Englisch vollständig; light, dark und zwei alte Designs lesbar; alles per Tastatur bedienbar.

## Tests

- **Rust:** Profil-`sanitize` (kaputte Datei → `.bad`, Grenzen), Pfadmodell (Eltern/Join/Segmente, Kodierung,
  `..`-Ablehnung, keine Zugangsdaten im Pfad), `LIST`-Parser (Unix/DOS/Sonderfälle, Latin-1) und `MLSD`,
  Geheimnisse (Schlüsselbund hinter einem Trait mit Fake im Test; nie in `Debug`/`Serialize` – Test, der die
  Formatierung prüft), Jobs gegen **lokale Testserver** im Container: FTP/FTPS (z. B. `vsftpd`/`pure-ftpd` oder ein
  Rust-Testserver wie `libunftp` als Dev-Dependency) und SFTP (`openssh-server` mit eigenem Port/Host-Key, Benutzer
  mit Passwort und mit Schlüssel); Host-Key-Wechsel, abgelaufene/selbstsignierte Zertifikate, Abbruch mitten in der
  Übertragung, Verbindungsabbruch, hängender Server (Port, der nie antwortet → Zeitüberschreitung, kein Hänger),
  Unicode-Namen, große Datei, Konflikte, `.part`-Aufräumen, `expected`.
- **Frontend** (Vitest, `FakeRemoteApi`/erweiterte `FakeFsApi`): Profil-Formular (Typwechsel setzt Port, Felder je
  Typ, Validierung), kein Passwort nach dem Speichern im Zustand des Stores, Passwortabfrage-Ablauf, Vetos im
  Server-Panel, Sitzung mit Server-Tab (Platzhalter), Ordnermenü-Abschnitt, Schnellverbindung (URL-Parser ohne
  Passwortübernahme), Texte en/de (`catalogs.spec.ts`).
- **E2E** unter Xvfb gegen die lokalen Testserver: Akzeptanzkriterien 1–11 (Schlüsselbund unter Linux: `gnome-
  keyring-daemon` im Container mit D-Bus starten oder begründet nur den Rückfall prüfen); Screenshots des Dialogs und
  eines Server-Panels; neue Szene in `scripts/screenshots/scenes.json` (Mock-Backend um Profile/Serverlisting
  erweitern). macOS Keychain und Windows Credential Manager bei Marc bzw. in der CI – im Bericht ausdrücklich nennen.
- **Review** durch einen separaten Agenten, Schwerpunkte: Geheimnisse (Speicherung, Lebensdauer, keine Lecks in
  Logs/Events/Fehlern/Export/Sitzung/Screenshots), Host-Key- und Zertifikatsprüfung (kein stilles Akzeptieren),
  Pfad-Injektion (Serverpfade mit `..`, CR/LF in FTP-Befehlen!, Namen vom Server als Nutzerdaten – nie unescaped
  in HTML), destruktive Operationen auf dem Server (endgültig, `expected`, Gefahrenprüfung), Hänger/Threads.

## Nicht im Umfang

- Einbinden als Laufwerk ins Betriebssystem (FUSE/WinFsp/File Provider) – das machen Tools wie CloudMounter.
- Cloud-Dienste mit OAuth (Google Drive, Dropbox, OneDrive), S3, WebDAV, SMB direkt (E7: höchstens vorbereiten).
- Synchronisieren/Vergleichen von Ordnern, FXP (Server-zu-Server direkt), Proxy/SOCKS/Jump-Hosts, Fortsetzen
  abgebrochener Übertragungen (Folgeidee, falls nicht in E0 anders entschieden).
- Bearbeiten und automatisches Zurückladen (F4) – Folgeidee, außer E0 nimmt es auf.
