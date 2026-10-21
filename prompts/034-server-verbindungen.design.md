# Design 034: Server-Verbindungen (FTP, FTPS, SFTP)

> **Status:** freigegeben (Marc, 21.10.2026: „entscheide du, was sicherer ist … Go!“ → E3 = nur Schlüsselbund) · **Datum:** 21.10.2026 · **Branch:** `feat/server-verbindungen`
> **Prompt:** `prompts/034-server-verbindungen.md` · Vorlagen: `prompts/034-vorlage-*.png`

## Entscheidungen auf einen Blick

| Nr. | Frage | Empfehlung |
|---|---|---|
| E0 | Schnitt | **ein Prompt, alle drei Protokolle** (FTP, FTPS, SFTP); Folgethemen (F4-Rückschreiben, Fortsetzen, `~/.ssh/config`, WebDAV, Master-Passwort-Datei, chmod) in `TODO.md` |
| E1 | Pfadmodell | **URL-artige Pfade mit Profil-Id**: `remote://<profil-id>/<serverpfad>` – nie Host/Benutzer/Passwort im Pfad; Rust rechnet Eltern/Segmente/Join |
| E2 | Crates | `suppaftp` 12 (sync, `rustls-ring`), `russh` 0.64 + `russh-sftp` 3 (reines Rust, `ring`), `rustls-platform-verifier` (Systemzertifikate), `keyring-core` + Store je OS; **kein** `ssh2`/OpenSSL, **kein** `opendal` |
| E3 | Geheimnisse | **nur Schlüsselbund des OS** dauerhaft; ohne Schlüsselbund „nur für diese Sitzung“; **keine** eigene verschlüsselte Datei in diesem Prompt |
| E4 | Jobs | bestehende Job-Arten `copy`/`move`/`delete` **dispatchen** nach Pfadart auf neue Läufer (`jobs/transfer.rs`, `jobs/remote_delete.rs`); `copy.rs` bleibt unangetastet |
| E5 | Vertrauen | SSH: `~/.ssh/known_hosts` nur lesen + eigene `known_hosts` der App; FTPS: Systemspeicher, selbstsigniert nur per Pin (SHA-256) nach Bestätigung; Klartext-FTP erlaubt mit Warnung |
| E6 | Listing | `MLSD` (UTC, Fakten) bevorzugt, sonst `LIST` (Parser von `suppaftp`, Unix/DOS); Namen UTF-8, sonst `lossyName` |
| E7 | Weitere Typen | Trait `RemoteFs` so schneiden, dass WebDAV/S3 passen; nicht bauen |
| E8 | Einstieg/Kürzel | `Mod+K` = „Mit Server verbinden…“ (wie Finder ⌘K), Menü „Gehe zu“, Ordnermenü ▾ Abschnitt „Server“, Pfadfeld nimmt `sftp://…`/`ftp://…` |

---

## 1. Bestand → wofür → passt / fehlt

| Baustein | wofür | Befund |
|---|---|---|
| `commands::list_directory` → `listing_gate` → `list_dir` | Listing jeder Art | **passt**, Dispatch nach Präfix `remote://` **vor** `resolve_input` (der verlangt absolute OS-Pfade) |
| `DirectoryListing` (`archive`, `network`) | Kennzeichen eines Listings | **erweitern**: `remote: Option<RemoteInfo>`; `network = true` für Server (→ `ListingCache`, `expected`, kein Watcher) |
| `ListingCache` + `OFF_WHILE_UNCHECKED` (030) | sofort zeigen, Ändern erst nach Prüfung | **passt** unverändert |
| `listing_gate` (029 E6) | ein Listing je hängendem Ordner | **passt** (Schlüssel ist der Pfad-String) |
| `paths::validate_input_path`/`validate_job_path` | OS-Pfade prüfen | **passt nicht** für Serverpfade → eigenes `remote::path::RemotePath::parse` (gleiche Regeln: kein NUL, kein `..`, zusätzlich kein CR/LF) |
| `JobManager::validate` / `run` | Job-Pfade, Läufer | **erweitern**: Copy/Move/Delete mit `remote://` → Remote-Läufer |
| `jobs/ask.rs` (`Asker`) | Konfliktfrage außerhalb von `copy.rs` | **passt** (Ziel-Metadaten als `FileMeta` statt `fs::Metadata` → kleine Überladung `ask_meta`) |
| `jobs/expect.rs` | `expected` (Größe/mtime) | **erweitern** um Vergleich mit Server-`stat` |
| `archive/secrets.rs` (`Secret`) | Passwort im Speicher | **passt**, wird nach `crate::secret` verschoben (gemeinsam für Archive und Server) |
| `archive/view.rs` | App-Cache für F3/Enter | **Buchhaltung herauslösen** nach `view_cache.rs` (LRU, Grenzen, Aufräumen) – Archive und Server nutzen sie |
| `session::resolve_missing_paths` | Tab-Pfade beim Start prüfen | **erweitern**: Serverpfade bleiben unverändert (keine Netzanfrage beim Start) |
| `resolve_location` (Pfadfeld) | getippter Pfad → Ordner | **erweitern**: `sftp://`, `ftp://`, `ftps://` → Schnellverbindung (Frontend öffnet den Dialog vorbefüllt) |
| `settings.rs` Bündel | Export/Import | **erweitern**: Teil `connections` ohne Geheimnisse |
| `config_file.rs` | Nutzerdateien laden/schreiben | **passt** für `connections.json`, `known_hosts` der App ist eigenes Textformat |
| Frontend `OpsStore`, `ArchiveStore.inArchive` + `OFF_IN_ARCHIVE` | Ziele, Vetos | **Muster**: `RemoteStore` + `OFF_ON_SERVER` |
| `FilePanel` Fehleranzeige | Fehlerzustand | **erweitern**: bei `remote_not_connected` Knopf „Verbinden“ |
| `WatchService` | Ordner an Rust | **anpassen**: Serverpfade nicht melden (Rust lehnt sie sonst als ungültig ab) |
| Ordnermenü ▾ (Tab-Leiste) | Laufwerke/Favoriten/zuletzt | **erweitern**: Abschnitt „Server“ |
| Favoriten, „zuletzt besucht“, Verlauf, Tabs | Pfade merken | **passt** (opake Strings) |
| Crates im Baum | | `dbus` 0.9 ist schon da (→ `dbus-secret-service-keyring-store` statt zbus), `tokio` ist da, **kein** `rustls`/`ring` bisher |

## 2. Entscheidungsfragen

### E0 Schnitt

- (a) alles in einem Prompt; (b) Teil 1 SFTP, Teil 2 FTP/FTPS; (c) Teil 1 Lesen/Herunterladen, Teil 2 Schreiben.
- **Empfehlung (a)**, aber in dieser Reihenfolge gebaut und je grün committet: Profile + Geheimnisse → SFTP lesen →
  FTP/FTPS lesen → Übertragen → Löschen/Anlegen/Umbenennen → Ansehen. Der Trait `RemoteFs` macht beide Protokolle
  gleich teuer im Rest; Marc hat FTP genannt, SFTP ist heute der Normalfall – beide gehören in die erste Fassung.
  Nicht in diesem Prompt (→ `TODO.md`): F4 mit Zurückladen, Fortsetzen (`REST`/Offset), `~/.ssh/config`-Aliasse,
  Jump-Hosts/Proxy, chmod (`SITE CHMOD`/`setstat`), Suche auf dem Server, WebDAV/S3, Master-Passwort-Datei.

### E1 Pfadmodell

| Option | + | − |
|---|---|---|
| **(a) `remote://<id>/<pfad>`** | Tabs, Verlauf, Favoriten, Sitzung, Cache, `listing_gate` unverändert; Pfad bleibt opak; keine Zugangsdaten | jeder Command, der Pfade nimmt, braucht einen Dispatch bzw. lehnt sauber ab |
| (b) eigener Panel-Modus | klare Trennung | doppelte Navigation/Tab-Logik, widerspricht 016 E1 |
| (c) unter lokaler Wurzel (wie Archive) | — | Serverpfade sind keine Pfadverlängerung, Windows-Separatoren, Verwechslung mit echten Ordnern |

**Empfehlung (a).** Regeln:

- Form: `remote://` + Profil-Id (`[a-z0-9-]{1,40}`, beim Anlegen erzeugt, stabil beim Umbenennen) + absoluter
  Serverpfad mit `/` (`remote://k3x9/pub/ftpx`, Wurzel `remote://k3x9/`). **Keine Prozent-Kodierung**: nach der Id
  folgt der rohe Serverpfad (UTF-8) – `#`, `%`, `?`, Leerzeichen bleiben, wie sie sind; wir parsen nie als URL.
- `RemotePath::parse` lehnt ab: NUL, CR, LF (FTP-Befehlsinjektion), `.`/`..`-Segmente, leere Segmente außer der
  Wurzel, > 4096 Bytes. Eltern/Segmente/`join(name)` rechnet nur Rust (`remote/path.rs`, rein, getestet).
- Segment-Anzeige: erste Krume = Profilname (z. B. „Mein Server“), dann die Ordner; der Pfad im Header zeigt
  `Mein Server: /pub/ftpx` (Feld `RemoteInfo.display`), der echte Pfad steht im Tooltip.
- Frontend erkennt Serverpfade nur an `listing.remote` bzw. einer einzigen Funktion `isRemotePath(p)` in
  `core/remote/remote-path.ts` (Präfixprüfung, **kein** Zerlegen) – nötig für das Ziel „andere Seite“ ohne Listing.
- Ein Serverpfad, der in einen lokal-only Command gerät (`watch_dirs`, `open_terminal`, `run_tool`, `start_os_drag`,
  `disk_usage_*` …), scheitert an `validate_input_path` („must be absolute“) – zusätzlich gibt es dort einen
  ausdrücklichen Test „Serverpfad wird abgelehnt“, und das Frontend sperrt die Aktionen vorher (Vetos, §4.6).

### E2 Crates

| Bedarf | Kandidaten | Empfehlung | Begründung |
|---|---|---|---|
| FTP/FTPS | `suppaftp` 12.2 (MIT/Apache), eigene Implementierung | **`suppaftp`**, sync, Feature `rustls-ring` (ohne `native-tls`/OpenSSL) | Jobs laufen auf eigenen Threads → sync passt; MLSD/LIST-Parser, EPSV, NAT-Workaround, `MFMT` vorhanden; `ClientConfig` selbst bestimmbar (Pin-Verifier) |
| SFTP | `russh` 0.64 + `russh-sftp` 3 (Apache-2.0, reines Rust), `ssh2` (libssh2 + OpenSSL, C) | **`russh` + `russh-sftp`**, `default-features = false`, `ring` + `flate2` (+ `rsa`) | kein C-Build auf drei OS, universal-Binary für macOS einfach; Agent-Client und `known_hosts`-Prüfung eingebaut; async → eigene kleine Tokio-Laufzeit im Hub (§3.3) |
| TLS-Vertrauen | `rustls-platform-verifier` 0.7, `webpki-roots` | **`rustls-platform-verifier`** | nutzt die Zertifikatsspeicher des OS (Firmen-CAs!), statt eine Liste einzubacken |
| Schlüsselbund | `keyring` 4 (Meta-Crate), `keyring-core` + Stores | **`keyring-core`** + je OS: `apple-native-keyring-store` (Feature `keychain`), `windows-native-keyring-store`, `dbus-secret-service-keyring-store` (Linux, nutzt das schon vorhandene `dbus`) | nur die nötigen Stores, kein zweiter D-Bus-Stack (zbus); als `target`-Abhängigkeiten |
| Testserver | `libunftp` + `unftp-sbe-fs` (dev), `russh`-Server + `russh-sftp`-Server (dev) | **beide in-process** in den Rust-Tests | CI-fest auf allen OS, kein Daemon; E2E zusätzlich gegen echtes `vsftpd`/`openssh-server` im Container |
| Sammel-Crate | `opendal` 0.59 | **nein** | großer Baum, eigene Abstraktion über unsere Job-Semantik (Konflikte, `.part`, Abbruch) |

Versionen und Feature-Sätze werden in Phase 2 beim ersten Build festgenagelt; die Größe des Release-Binarys vorher/
nachher wird gemessen und in `docs/architecture.md` notiert. Lizenzen (MIT/Apache) → `docs/licenses.md`.
`ring` braucht einen C-Compiler (ist für Tauri ohnehin da), kein CMake (deshalb nicht `aws-lc-rs`).

### E3 Geheimnisse

**Bedrohungsmodell.** Schützen wollen wir: (1) Konfigurationsdatei/Backup/Export landet bei Dritten, (2) andere
Benutzer am Rechner, (3) versehentliches Zeigen (Screenshot, Log, Fehlermeldung, Support-Datei). **Nicht**
schützbar: Schadsoftware, die als derselbe Benutzer läuft (unter Windows/Linux liest sie den Schlüsselbund wie wir;
macOS fragt nach, wenn die App-Signatur nicht passt). Das steht so in der Doku.

| Option | (1) | (2) | (3) | Aufwand/Risiko |
|---|---|---|---|---|
| **Schlüsselbund des OS** | ✅ (liegt nicht in unseren Dateien) | ✅ | ✅ | gering, bewährt |
| eigene Datei, Schlüssel im Programm/daneben | ❌ (Schein) | ❌ | ✅ | **scheidet aus** |
| eigene Datei mit Master-Passwort (Argon2id + XChaCha20-Poly1305) | ✅ | ✅ | ✅ | eigene Kryptografie-Bedienung, Master-Passwort-Dialog, Vergessen nach Leerlauf |

**Empfehlung:** dauerhaft **nur** im Schlüsselbund. Ist keiner verfügbar (Linux ohne Secret Service, gesperrt,
Fehler) → der Dialog bietet nur „für diese Sitzung merken“ und sagt warum (`keychain_unavailable`). Die
Master-Passwort-Datei kommt als Folgeidee in `TODO.md`, falls Marc sie für Linux-Rechner ohne Keyring will.

Details:

- Eintrag: Dienst `io.github.krocon.filesandfolders` (= `identifier` aus `tauri.conf.json`), Konto
  `remote:<profil-id>:password` bzw. `remote:<profil-id>:passphrase` – kein Host/Benutzer im Klartext.
- Ablauf: das Frontend schickt ein Geheimnis **genau einmal** (`remote_connect` mit `password` + `remember`), Rust
  prüft es durch erfolgreiches Anmelden und **speichert erst danach** (falsches Passwort landet nie im
  Schlüsselbund). Antwort und Profile tragen nur `secret: 'none' | 'session' | 'keychain'`. **Kein** Command liest
  ein Geheimnis aus.
- Im Speicher: `Secret` (`Zeroizing`, `Debug` = `***`, kein `Serialize`) in einer Tabelle je Profil, solange die App
  läuft; „Trennen“ behält es (sonst müsste man bei jedem Wiederverbinden tippen), „Passwort vergessen“ im Dialog
  löscht Speicher **und** Schlüsselbund. Profil löschen → Schlüsselbund-Einträge mit löschen.
- Passwort ändern/entfernen im Dialog: Feld zeigt „gespeichert ••••“ (nur Platzhalter, nicht der echte Wert),
  Knöpfe „Ändern“, „Vergessen“.
- **macOS**: Keychain-Einträge hängen an der Code-Signatur. Unsignierte/ad-hoc-signierte Builds (017: Signierung
  nur vorbereitet) fragen nach jedem neuen Build einmal „Zugriff erlauben“; mit Entwickler-ID-Signatur nicht mehr.
  Steht in `docs/release.md`. Kein Data-Protection-Keychain (bräuchte Entitlements).
- **Windows**: Generic Credential (Credential Manager), Blob ≤ 2560 Bytes (Passwörter ≤ 1024 Zeichen wie `Secret`).
- **Linux**: Secret Service über D-Bus (GNOME Keyring, KWallet ≥ 5.97); Sammlung „login“ bzw. Standard. Gesperrte
  Sammlung → der Dienst fragt selbst nach dem Login-Passwort; kein Dienst → Rückfall Sitzung.
- SSH-Schlüssel: nur der **Pfad** steht im Profil; die Passphrase wie ein Passwort. Der private Schlüssel wird nie
  kopiert oder gelesen, außer zum Anmelden.
- Klartext-FTP: Speichern bleibt möglich; Formular und Panel-Header zeigen deutlich „unverschlüsselt – Passwort und
  Daten sind lesbar“.

### E4 Jobs

- (a) `copy.rs` auf einen Dateisystem-Trait umbauen; (b) **bestehende Job-Arten dispatchen** auf neue Läufer;
  (c) neue Job-Arten `upload`/`download`.
- **Empfehlung (b):** `JobSpec` bleibt unverändert (Frontend: `OpsStore`, Dialoge, Drag & Drop, Task-Liste ändern
  sich kaum). `JobManager::validate` erkennt Serverpfade: gemischte Quellen (lokal + Server) → `invalid_path`.
  - `Copy`/`Move` mit Server-Quelle **oder** Server-Ziel → `jobs/transfer.rs` (lokal→Server, Server→lokal,
    Server→Server). `copy.rs` (945 Zeilen, gut getestet) bleibt unberührt – (a) wäre ein Risiko ohne Nutzen für
    lokale Kopien.
  - `Delete` mit Serverpfaden → `jobs/remote_delete.rs`; `mode = trash` wird abgelehnt (`remote_unsupported`), das
    Frontend schickt immer `permanent`.
  - `transfer.rs` nutzt zwei Endpunkte `Endpoint::Local(PathBuf)`/`Endpoint::Remote(RemotePath)` mit kleinem
    gemeinsamen Interface (stat, list, open_read, create_part, place, mkdir, remove, set_mtime) – lokal mit
    denselben Regeln wie `copy.rs` (`.part`, `rename_noreplace`, Links nicht folgen).
- Semantik (wie 006, Unterschiede fett):
  - Planung zuerst (rekursives Listing, Summe), Ziel in Quelle / auf sich selbst abgelehnt (gleiches Profil).
  - Datei → `.fnf-<job>-<n>.part` im Zielordner → umbenennen. **SFTP**: `rename` (v3) scheitert, wenn das Ziel
    existiert = kein Überschreiben; „Überschreiben“ nach Bestätigung = Ziel löschen, dann umbenennen (bzw.
    `posix-rename@openssh.com`, wenn angeboten). **FTP**: vor `RNTO` `stat` aufs Ziel (Rennen dokumentiert, FTP
    kann es nicht atomar); Server, die `RNFR/RNTO` nicht können → direkt unter dem Namen schreiben, bei Abbruch die
    halbe Datei löschen und im Protokoll melden.
  - Konflikte über `Asker` (Größe/Datum beider Seiten), „für alle“, Umbenennen-Vorschlag.
  - Zeitstempel: SFTP `setstat`, FTP `MFMT` (wenn in `FEAT`), lokal `set_modified`.
  - **Server-Links**: Quelle Link → als Link kopieren geht nicht übers Protokoll (FTP gar nicht) → Datei/Ordner
    hinter dem Link wird **nicht** verfolgt, sondern übersprungen und gemeldet (wie unlesbar). Lokale Links beim
    Hochladen ebenso (kein Hochladen von Link-Zielen, keine Zyklen).
  - Move auf **demselben Profil** = `rename` je Quelle (keine Übertragung); sonst Kopie + Quelle löschen je Datei
    nach erfolgreichem Platzieren.
  - Abbruch: laufende Übertragung wird abgebrochen (Socket schließen), `.part` aufräumen.
  - Volle Platte am Server (`552`/`SSH_FX_FAILURE` + Text) → Fehler je Datei (nicht Pause – „voll“ ist am Server
    nicht verlässlich erkennbar).
  - Fortschritt: Bytes, Dateien, Rate (vorhandener `Reporter`, max. 10/s).
  - Parallel: ein Job nutzt **eine** Verbindung je Seite (Folgeidee: mehrere Dateien parallel).
- `expected` (030 E5): vor Löschen/Verschieben `stat` am Server, abweichend → `changed_since_listing`, Eintrag
  bleibt liegen.
- Gefahrenprüfung am Server (`remote::danger_of`): Wurzel `/`, Login-Ordner (PWD nach Anmeldung), Startpfad des
  Profils und deren Vorfahren → `allowDangerous` nach zweiter Bestätigung (wie F8).

### E5 Vertrauen

- **SSH Host-Keys:** Prüfung über `russh::keys::check_known_hosts_path` gegen (1) `~/.ssh/known_hosts` **nur
  lesend** (Server, denen man im Terminal schon vertraut, kennt die App sofort; gehashte Einträge gehen) und (2)
  `<app_config_dir>/known_hosts` (OpenSSH-Format, schreibt nur die App). Unbekannt → Antwort `hostKeyUnknown` mit
  Typ + SHA256-Fingerabdruck → Dialog „Fingerabdruck prüfen“ → `remote_trust_host_key` → Eintrag in (2), dann neu
  verbinden. Geändert (in (1) oder (2)) → `remote_host_key_changed`, **hart abgelehnt**, kein Knopf zum Übernehmen
  (Hinweis: Eintrag in der Datei löschen, wenn der Server bekannt neu aufgesetzt wurde – Pfad wird genannt).
  `~/.ssh` wird nie geschrieben.
- **FTPS:** `rustls` + `rustls-platform-verifier`. Prüfung scheitert → Antwort `certificateUntrusted` mit
  Antragsteller, Aussteller, Gültigkeit, SHA-256 des Blattzertifikats, Grund → Dialog → Pin im Profil
  (`pinnedCert`); ein eigener Verifier akzeptiert dann **genau** dieses Zertifikat (Hostname wird trotzdem
  geprüft, außer der Nutzer bestätigt auch das ausdrücklich). Anderes Zertifikat → erneut fragen (mit Hinweis
  „anders als gemerkt“).
- **FTPS Daten-Kanal:** viele Server (vsftpd `require_ssl_reuse`) verlangen TLS-Session-Resumption auf dem
  Datenkanal – rustls macht Resumption per gemeinsamem `ClientConfig`; in Phase 2 gegen vsftpd geprüft (Risiko R1).
- **Klartext-FTP** erlaubt (alte NAS, Router), überall sichtbar markiert; „Anonym“ verwendet `anonymous` +
  konfigurierbare Kennung (kein Geheimnis).
- Kein „immer akzeptieren“-Schalter, auch nicht in den Einstellungen.

### E6 Listing und Namen

- FTP: `FEAT` lesen; `MLSD` bevorzugt (Art, Größe, `modify` in UTC, `unix.mode`), sonst `LIST -a` → Parser von
  `suppaftp::list::File` (Unix und DOS); nicht parsebare Zeilen zählen in `unreadableEntries`. `LIST`-Zeiten haben
  keine Zeitzone und teils kein Jahr → als Serverzeit angenommen, in den Eigenschaften „ungefähr“.
- `OPTS UTF8 ON`, wenn `UTF8` in `FEAT`; Profil-Einstellung „Zeichensatz: automatisch | UTF-8 | Latin-1“. Namen, die
  nicht dekodieren → `lossyName = true` (vorhandenes Feld: Anzeige ja, Navigation/Operationen nein).
- SFTP: `readdir` liefert Attribute direkt (ein Rundlauf), Links per `stat` auf das Ziel (`targetKind`), Fehler →
  `targetKind = null` (dangling).
- Versteckt = Name beginnt mit `.`.
- Große Ordner: Listing-Limit wie lokal (gleiches Verhalten bei 100 000 Einträgen); Abbruch über `listing_gate`.

### E7 Weitere Typen

Trait `RemoteFs` (sync, §3.3) ist protokollneutral; WebDAV/S3 bekämen eigene Implementierungen und eigene
Profil-Typen. In diesem Prompt nur FTP/FTPS/SFTP. SMB bleibt über das OS gemountet (030).

### E8 Einstiege und Kürzel

| Aktion (Id) | Kürzel (alle OS, gegen alle Keymaps geprüft: frei) | Wo |
|---|---|---|
| `OPEN_CONNECTIONS_DLG` „Mit Server verbinden…“ | `Mod+K` (Finder ⌘K), zusätzlich `Mod+N` (TC Strg+N) | Menü „Gehe zu“, Palette, Ordnermenü ▾, Actions-Menü |
| `REMOTE_DISCONNECT` „Verbindung trennen“ | – (TC Strg+Shift+F ist bei uns `REVEAL_IN_FILE_MANAGER`) | Menü „Gehe zu“, Palette, Header-Knopf im Server-Panel |
| `REMOTE_RECONNECT` „Neu verbinden“ | – | Fehleranzeige, Palette |

- Ordnermenü ▾: neuer Abschnitt „Server“ (alle Profile, verbundene mit Punkt, zuletzt benutzte zuerst, max. 10,
  „Alle Verbindungen…“).
- Pfadfeld/Palette: `sftp://user@host:22/pfad`, `ftp://…`, `ftps://…` → Dialog mit vorbefülltem neuen Profil (Rust
  parst: `remote_parse_url`); ein Passwort in der URL wird **verworfen** und gemeldet, nie angezeigt.
- Favoriten: Serverpfade wie andere Pfade (Name = `Profil: /pfad`).

## 3. Verträge

### 3.1 Profile (`<app_config_dir>/connections.json`, Rust `remote/profiles.rs`)

```jsonc
{
  "version": 1,
  "profiles": [{
    "id": "k3x9a2",                 // [a-z0-9-]{1,40}, von Rust erzeugt
    "name": "Mein Server",          // 1–80 Zeichen, keine Steuerzeichen
    "kind": "sftp",                 // ftp | ftpsExplicit | ftpsImplicit | sftp
    "host": "example.org",          // Hostname/IPv4/[IPv6], ≤ 253, keine Leer-/Steuerzeichen, kein '/', '@'
    "port": 22,                     // 1–65535; Default je Art 21/21/990/22
    "user": "marc",                 // ≤ 256, keine Steuerzeichen (CR/LF!)
    "anonymous": false,             // nur FTP*: Benutzer "anonymous"
    "auth": "password",             // sftp: password | key | agent; ftp*: password
    "keyFile": null,                // sftp + key: absoluter lokaler Pfad
    "startPath": "/home/marc",      // absoluter Serverpfad oder null (= Login-Ordner)
    "passive": true,                // ftp*: true = EPSV/PASV (+ NAT-Workaround); false nicht unterstützt → E0
    "encoding": "auto",             // ftp*: auto | utf8 | latin1
    "timeoutSecs": 20,              // 5–120
    "maxConnections": 2,            // 1–8
    "keepaliveSecs": 60,            // 0 = aus, sonst 15–600
    "description": "",              // ≤ 1000
    "pinnedCert": null,             // ftps: SHA-256 hex des bestätigten Blattzertifikats
    "acceptHostnameMismatch": false,// ftps: nur nach ausdrücklicher Bestätigung
    "secret": "keychain"            // none | keychain – Merker, KEIN Geheimnis (session wird nie gespeichert)
  }]
}
```

`sanitize` wie `tools.json`: kaputt → `.bad`, ungültige Profile werden einzeln verworfen und gemeldet, max. 500.

### 3.2 Commands (alle `async`, dünn, `spawn_blocking` bzw. Hub-Laufzeit)

| Command | Parameter | Rückgabe | Fehler |
|---|---|---|---|
| `load_connections` | – | `{ profiles: RemoteProfile[], status: { [id]: ConnState }, keychain: boolean, warnings }` | – |
| `save_connection` | `profile` (id leer = neu) | `RemoteProfile` | `invalid_profile` |
| `delete_connection` | `id` | – | (trennt, löscht Schlüsselbund-Einträge) |
| `remote_connect` | `id`, `password?: Secret`, `passphrase?: Secret`, `remember: 'none'\|'session'\|'keychain'` | `ConnectOutcome` | `remote_auth_failed`, `remote_timeout`, `remote_unreachable`, `remote_protocol`, `keychain_unavailable` |
| `remote_trust_host_key` | `id`, `fingerprint` | – | Fingerabdruck passt nicht zum zuletzt gesehenen → `remote_host_key_changed` |
| `remote_trust_certificate` | `id`, `sha256`, `acceptHostname` | – | wie oben |
| `remote_disconnect` | `id` | – | – |
| `remote_forget_secret` | `id` | – | – |
| `remote_test` | `profile` (ungespeichert erlaubt), Geheimnisse wie connect | `ConnectOutcome` + Anzahl Einträge im Startpfad | wie connect |
| `remote_parse_url` | `url` | `{ profile: RemoteProfile (Entwurf), droppedPassword: boolean }` | `invalid_url` |

```ts
type ConnectOutcome =
  | { status: 'connected'; home: string /* remote://id/… */; encrypted: boolean; serverInfo: string }
  | { status: 'needsSecret'; what: 'password' | 'passphrase'; keychain: boolean }
  | { status: 'hostKeyUnknown'; keyType: string; fingerprint: string /* SHA256:… */ }
  | { status: 'certificateUntrusted'; subject: string; issuer: string; notBefore: number; notAfter: number;
      sha256: string; reason: string; hostnameMismatch: boolean; pinnedChanged: boolean };
type ConnState = 'disconnected' | 'connecting' | 'connected' | 'lost';
```

Bestehende Commands mit Dispatch für `remote://` (sonst unverändert): `list_directory`, `make_dir`, `create_file`
(leere Datei hochladen, nie überschreiben), `rename_entry`, `read_preview`/`get_properties` (über den View-Cache bzw.
`stat`), `open_file` (Cache + Standard-App, Hinweis „Änderungen werden nicht zurückgeladen“), `resolve_location`
(URL → `{ quickConnect }`), `check_paths`. Verbindungsereignisse (`lost`, `connected`) über **einen** Channel
`subscribe_remote` (wie `subscribe_watch`).

### 3.3 Rust-Module

```
src-tauri/src/secret.rs              Secret (aus archive/secrets.rs verschoben; archive::secrets nutzt es)
src-tauri/src/view_cache.rs          LRU/Grenzen/Aufräumen aus archive/view.rs herausgelöst
src-tauri/src/remote/mod.rs          Hub: Profile → Pool, Geheimnisse im Speicher, Zustände, Ereignisse
                     path.rs         RemotePath (rein): parse/parent/segments/join/display
                     profiles.rs     connections.json, sanitize, Id-Erzeugung, URL-Parser
                     credentials.rs  trait SecretStore { get, set, delete } + KeyringStore + MemoryStore (Tests)
                     trust.rs        known_hosts (lesen/anhängen), Zertifikats-Pin-Verifier
                     fs.rs           trait RemoteFs (sync): list, stat, open_read, create_write, mkdir, rename,
                                     remove_file, remove_dir, set_mtime, cancel_handle
                     ftp.rs          suppaftp-Implementierung (MLSD/LIST, UTF8, EPSV/PASV, MFMT)
                     sftp.rs         russh/russh-sftp-Implementierung (block_on auf der Hub-Laufzeit)
                     danger.rs       Gefahrenprüfung am Server
                     tests/          in-process FTP(S)- und SFTP-Server (dev-dependencies)
src-tauri/src/jobs/transfer.rs       Copy/Move mit Server-Seite
src-tauri/src/jobs/remote_delete.rs  Delete auf dem Server
src-tauri/src/commands/remote.rs     Commands §3.2
```

- **Pool**: je Profil bis `maxConnections` Verbindungen; eine ist fürs Browsen reserviert (Listings, stat), Jobs
  nehmen weitere; voll → warten (abbrechbar, mit Zeitlimit) statt neue Verbindung.
- **Threads**: FTP blockiert auf dem Job-/`spawn_blocking`-Thread (Socket-Timeouts gesetzt). SFTP: der Hub besitzt
  eine eigene Tokio-Laufzeit (2 Worker) und ruft `block_on` mit `timeout` – nie die Tauri-Laufzeit blockieren.
- **Abbruch**: jede Operation bekommt ein Abbruch-Handle; Abbruch schließt den Socket (FTP: `shutdown` der Kopie des
  `TcpStream`, SFTP: Kanal schließen) – die hängende Operation kehrt sofort zurück.
- **Verbindungsverlust**: Fehler der Transportschicht → Zustand `lost`, Ereignis ans Frontend; nächste Operation
  versucht **einmal** neu zu verbinden, wenn ein Geheimnis im Speicher ist (bzw. Agent/Schlüssel ohne Passphrase);
  sonst `remote_not_connected`.
- **Keepalive**: FTP `NOOP`, SSH Keepalive, im Intervall des Profils, nur für verbundene Profile.
- Logs: nur Profil-Id, Art und Fehlercode – kein Host, Benutzer, Pfad, Geheimnis (Test mit Suchmuster).

### 3.4 DTO-Änderungen (`model.rs` ↔ `fs.models.ts`)

```ts
interface RemoteInfo { profileId: string; name: string; kind: RemoteKind; encrypted: boolean; display: string }
// DirectoryListing: + readonly remote?: RemoteInfo | null   (network = true bei Server-Listings)
```

Neue `FsErrorCode`s (beide Seiten + `describeFsError()` en/de): `remote_not_connected`, `remote_auth_failed`,
`remote_unreachable`, `remote_timeout`, `remote_connection_lost`, `remote_host_key_changed`, `remote_protocol`
(Antwort des Servers, Code im Text, nie das Passwort), `remote_unsupported`, `keychain_unavailable`,
`invalid_profile`, `invalid_url`, `unknown_profile`.

### 3.5 Einstellungen (Schema Rust + TS)

`remote.defaultTimeoutSecs` (20), `remote.keepaliveSecs` (60), `remote.maxConnections` (2),
`remote.viewLimitMb` (256, wie Archive), `remote.offerKeychain` (true). Export/Import: Teil `connections` (Profile
ohne `secret`-Zustand → beim Import `none`, `pinnedCert` bleibt), `known_hosts` der App nicht.

## 4. Frontend

### 4.1 Fassaden und Stores

- `core/remote/remote-api.ts` (`RemoteApi`: alle Commands §3.2), `remote.models.ts`, `remote-path.ts`
  (`isRemotePath`); `testing/fake-remote-api.ts`.
- `features/remote/remote.store.ts` (Root): Profile, Zustände (Channel), `connect(id)` mit dem Ablauf
  needsSecret → Passwortdialog → hostKeyUnknown/certificateUntrusted → Vertrauensdialog → erneut; danach Navigation
  des aktiven Panels zu `home` (bzw. Startpfad). Hält **nie** ein Passwort länger als den einen Aufruf (Feldwert
  wird nach dem Senden geleert, kein Signal speichert es).
- `remote-actions.ts`: Aktionen §E8 + Veto-Menge `OFF_ON_SERVER` (§4.6).
- `OpsStore`: Ziel/Quelle Server erlaubt (Copy/Move/Delete/MkDir/Rename); Löschdialog zeigt im Server-Panel nur
  „endgültig löschen“ (Text: „Auf Servern gibt es keinen Papierkorb“), `expected` immer mitschicken.

### 4.2 Dialog „Mit Server verbinden“ (Skizze)

```
┌ Mit Server verbinden ───────────────────────────────────────────────────────┐
│ Adresse: [sftp://marc@example.org/home/marc             ] [Verbinden]      │
│ ┌ Profile ───────────────┐  Name:        [Mein Server                    ]  │
│ │● Mein Server   SFTP 🔒 │  Art:         [SFTP ▾]                            │
│ │  NAS           FTP  ⚠  │  Server:      [example.org          ] Port: [22]  │
│ │  Kunde X       FTPS 🔒 │  Benutzer:    [marc                 ] ☐ Anonym     │
│ │                        │  Anmeldung:   (•) Passwort ( ) Schlüssel ( ) Agent│
│ │                        │  Passwort:    gespeichert •••• [Ändern][Vergessen]│
│ │                        │  Startpfad:   [/home/marc                      ]  │
│ │                        │  ▸ Erweitert (Passiv, Zeichensatz, Zeitlimit,    │
│ │                        │      Verbindungen, Keepalive, Beschreibung)      │
│ │                        │  ⚠ unverschlüsselt (nur bei FTP)                 │
│ └────────────────────────┘                                                  │
│ [Neu][Duplizieren][Löschen]   [Testen][Als Favorit][Speichern][Verbinden][✕]│
└─────────────────────────────────────────────────────────────────────────────┘
```

- `role="dialog"`, Fokusfalle; Profilliste `role="listbox"` (Pfeile, Pos1/Ende, Entf = Löschen mit Rückfrage),
  Formular mit `<label for>`; Typwechsel setzt Port nur, wenn er dem alten Default entsprach. Fokus-Reihenfolge:
  Adresse → Liste → Formular → Knöpfe. Ungespeicherte Änderungen beim Wechsel/Schließen → Rückfrage.
- Icons (Font Awesome 4.5.0): `fa-server` (Profil), `fa-lock` (verschlüsselt), `fa-unlock-alt` + Warnfarbe
  (Klartext), `fa-plug` (verbunden), `fa-key` (Schlüssel/Agent).
- Passwortdialog (Muster `password-dialog.ts` aus 025): Feld, „im Schlüsselbund speichern“ (nur wenn verfügbar,
  Standard aus Einstellung) bzw. „nur für diese Sitzung“; Hinweis bei Klartext-FTP.
- Vertrauensdialog: Fingerabdruck in Monospace, Art des Schlüssels/Zertifikats, „Vertrauen und verbinden“ /
  „Abbrechen“ (Fokus-Default: Abbrechen).

### 4.3 Server im Panel

- Header: `fa-lock`/`fa-unlock-alt` + `Mein Server: /pub/ftpx`, Knopf „Trennen“ (`fa-plug`), Zustand „Verbindung
  verloren – Neu verbinden“.
- Fehlerzustand `remote_not_connected`/`remote_connection_lost`: Text + Knopf „Verbinden“ (→ `RemoteStore.connect`),
  danach Neuladen des Tabs.
- Statuszeile wie bei Netzlaufwerken („Stand … · wird geprüft …“ aus 030).
- `WatchService` meldet nur Panels ohne `remote`.

### 4.4 Sitzung

Tabs mit Serverpfad bleiben stehen (Rust `resolve_missing_paths` überspringt `remote://`); beim Start listet das
Panel → `remote_not_connected` → Platzhalter mit „Verbinden“. Gelöschtes Profil → `unknown_profile`
(„Verbindung gibt es nicht mehr“), Tab bleibt bis zum Schließen.

### 4.5 Ansehen/Öffnen

F3/Schnellvorschau/Enter auf Serverdatei → Rust lädt in den View-Cache (`<app cache>/remote-view/run-…`, Grenzen wie
025: Vorschau 256 MB, Öffnen 4 GB, Schlüssel = Profil + Pfad + Größe + mtime, schreibgeschützt), dann wie bei
Archiven. Download als Hilfs-Job `viewEntry` (vorhandene Art, Dispatch) mit Fortschritt und Abbruch.

### 4.6 Vetos im Server-Panel (`OFF_ON_SERVER`, Text „Auf Servern nicht möglich“)

`OPEN_EDIT_DLG` (F4), `OPEN_ATTRIBUTE_DLG`, `OPEN_CHANGE_ATTRIBUTES_DLG`, `OPEN_TOOLS_DLG`, Tools/Starter mit
Dateiplatzhaltern, `REVEAL_IN_FILE_MANAGER`, `OPEN_TERMINAL_HERE`, `TOGGLE_SHELL`-Befehle im Server-Ordner,
`OPEN_DISK_USAGE*`, `OPEN_PACK_DLG`, `OPEN_UNPACK_DLG`, `OPEN_MULTIRENAME_DLG`, `OPEN_MULTIMKDIR_DLG`,
`OPEN_GROUPFILES_DLG`, `OPEN_DELETE_EMPTY_FOLDERS_DLG`, `OPEN_FIND_DLG`, `OPEN_FOLDER_FINDER_DLG`,
`OPEN_FIND_DUPLICATES_DLG`, Link-Aktionen (031), Ziehen ins System (028). **Erlaubt:** Navigation, Markieren,
Filter, F3, Enter, F5/F6 (beide Richtungen), F7, F2/Inline, F8 (endgültig), Datei anlegen, Ordnergröße
(Leertaste, rekursives Listing, abbrechbar), Pfad kopieren, Drag & Drop **innerhalb** der App, Favoriten.
Archive auf dem Server: Enter öffnet sie **nicht** als Ordner (erst herunterladen) – Hinweis.

## 5. Tests

**Rust** (Phase 2, rot zuerst):

- `remote/path.rs`: parse (Wurzel, Unicode, Leerzeichen, `#%?`, Emoji), Ablehnung (NUL, CR, LF, `..`, `.`, leere
  Segmente, zu lang, fremdes Schema), parent/segments/join, Anzeige.
- `profiles.rs`: sanitize (Grenzen, Steuerzeichen in Host/Benutzer, kaputte Datei → `.bad`, Duplikat-Ids),
  `remote_parse_url` (Port-Defaults, IPv6, Prozent-Kodierung im Benutzer, Passwort verworfen).
- `credentials.rs`: `MemoryStore` im Test, Ablauf „erst nach erfolgreichem Login speichern“, Löschen mit Profil;
  `Secret` taucht in `Debug`/Fehlern/Events nicht auf (Test serialisiert Events eines kompletten Ablaufs und sucht
  das Passwort); echter Keyring nur bedingt (`#[ignore]`, E2E).
- `trust.rs`: known_hosts lesen (gehasht, Ports `[host]:2222`), anhängen, geänderter Schlüssel → Fehler;
  Pin-Verifier (gleiches/anderes Zertifikat, Hostname).
- `ftp.rs` gegen in-process `libunftp` (Klartext + FTPS mit selbstsigniertem Zertifikat): MLSD und `LIST`
  (Parser-Fälle Unix/DOS aus Fixtures), UTF-8-Namen, Upload/Download/Rename/Delete/MkDir, `MFMT`.
- `sftp.rs` gegen in-process `russh`-Server + `russh-sftp`-Server über einem `tempfile`-Ordner: Passwort,
  Schlüssel (mit/ohne Passphrase), Host-Key unbekannt/geändert, Links (Datei, Ordner, dangling), Rechte.
- `jobs/transfer.rs`: beide Richtungen, Server→Server, Ordner rekursiv mit Unicode/Leerzeichen/Emoji, große Datei
  (≥ 64 MB generiert), Konflikte (überspringen/überschreiben/umbenennen/für alle), Abbruch mitten in der Datei →
  kein `.part`, keine halbe Datei, Move auf demselben Profil = Rename, `expected` abweichend, Links übersprungen.
- `jobs/remote_delete.rs`: rekursiv, `expected`, Gefahrenprüfung (`/`, Login-Ordner), `trash` abgelehnt.
- Hänger: Server, der nach dem Verbinden nie antwortet → Zeitüberschreitung, Thread kehrt zurück; Verbindung
  mitten im Listing getrennt → `remote_connection_lost`, Wiederverbinden.
- `commands::command_rules` deckt die neuen Commands ab (async); lokal-only Commands lehnen `remote://` ab.
- Session: `resolve_missing_paths` lässt Serverpfade unverändert.

**Frontend** (Vitest, `FakeRemoteApi`): Formular (Typwechsel/Port, Felder je Art, Validierung), kein Passwort im
Store nach dem Senden, Verbindungsablauf mit allen `ConnectOutcome`-Zweigen, Vetos `OFF_ON_SERVER`, Löschdialog
„endgültig“ im Server-Panel, Ordnermenü-Abschnitt, Pfadfeld `sftp://…` → Dialog, Sitzungs-Platzhalter,
`WatchService` ohne Serverpfade, Texte en/de (`catalogs.spec.ts`), Fehlercodes in `describeFsError`.

**E2E** (Xvfb, Phase 4): im Container `openssh-server` (Port 2222, eigener Host-Key, Benutzer mit Passwort und
Schlüssel) und `vsftpd` (Klartext + FTPS mit `require_ssl_reuse=YES`, selbstsigniert); Linux-Schlüsselbund mit
`dbus-run-session` + `gnome-keyring-daemon --unlock`. Akzeptanzkriterien 1–13 des Prompts; Screenshots Dialog +
Server-Panel (light/dark, `classic-norton`, `classic-paper`); neue Screenshot-Szene `connections` mit Mock.
**Bei Marc/CI:** macOS Keychain (inkl. Abfrage bei unsigniertem Build), Windows Credential Manager, Windows/macOS-Build
von `ring`/`russh`.

**Review** (separater Agent, Phase 6): Geheimnisse (Speicherung, Lebensdauer, Lecks in Logs/Events/Fehlern/Export/
Sitzung/Screenshots), Host-Key/Zertifikat (kein stilles Akzeptieren), CR/LF- und Pfad-Injektion, destruktive
Operationen am Server, Hänger/Threads/Abbruch.

## 6. Risiken

| Nr. | Risiko | Umgang |
|---|---|---|
| R1 | FTPS-Datenkanal ohne TLS-Resumption scheitert an vsftpd & Co. | früh in Phase 2 gegen vsftpd prüfen; sonst eigenen `ClientSessionStore` setzen |
| R2 | `russh` async in sync Jobs | eigene Laufzeit im Hub, `block_on` + `timeout`; Test „hängender Server“ |
| R3 | Keychain-Abfragen bei unsignierten macOS-Builds nerven | dokumentieren; mit Signierung (017) erledigt |
| R4 | Größe des Binarys (rustls, ring, russh) | messen, in `docs/architecture.md` notieren |
| R5 | Windows-Agent (Pageant/OpenSSH-Pipe) in `russh` | in Phase 2 prüfen; fehlt es → „Agent“ unter Windows ausblenden, im Bericht nennen |
| R6 | Aufwand L ist groß | Reihenfolge E0, Commit je grünem Schritt, Fortschritt unten pflegen |

## 7. Abweichungen / Parität

Neu – weder die alte Version noch mr hatten Server-Verbindungen. `docs/feature-parity.md` A.4 „Nur neu“:
„Server-Verbindungen (FTP/FTPS/SFTP), 034“. Abweichung von TC: kein Aktivmodus-FTP, kein Papierkorb am Server,
Kürzel `Mod+K` statt Strg+F (bei uns Suche).

## Umsetzung – Abweichungen vom Entwurf

| Punkt | Entwurf | Umgesetzt | Grund |
|---|---|---|---|
| Testen im Dialog | Command `remote_test` mit ungespeichertem Entwurf | „Testen“ speichert und verbindet (ohne Navigation) | Host-Key/Pin brauchen ein gespeichertes Profil; ein zweiter Ablauf hätte nichts gebracht |
| Vertrauensfrage + Passwort | Frontend schickt nach „Vertrauen“ erneut | Rust hält das getippte Passwort bis zum nächsten Verbinden (`pending_secrets`, `Zeroizing`), Trennen/Abbrechen verwirft es | das Frontend schickt ein Passwort genau einmal |
| Zertifikatsdialog | Antragsteller, Aussteller, Gültigkeit | SHA-256 (in Vierergruppen), Grund, „anderer Servername“ | ohne X.509-Parser keine weiteren Felder; der Fingerabdruck ist das Entscheidende (kein neues Crate) |
| Pool | eine Verbindung fürs Browsen reserviert | gemeinsamer Pool bis `maxConnections`, Warten mit Zeitlimit | einfacher, bei Standard 2 genügt es; Server → Server läuft über eine lokale Temp-Datei |
| Einstellungen §3.5 | `remote.*` im Einstellungsdialog | Werte je Profil (Zeitlimit, Verbindungen, Keepalive) | globale Defaults hätten nur die Profilwerte vorbelegt |
| Server-Links beim Kopieren | Link-Ziele per `stat` | übersprungen (`symlink_skipped`) | kein Kopieren von Link-Zielen, keine Zyklen |
| F4 / Ziehen ins System / Archive auf Servern | Veto | Veto, Hinweis | Folgeideen (TODO.md) |
| Frontend-Pfade | nur `isRemotePath` | zusätzlich `profileOf` (Id für „Verbinden“), `serverPath` (Favorit vor dem ersten Verbinden), `displayPath` (Menüs) | Lesen/Erzeugen des Präfixes, kein Zerlegen von Serverpfaden; Rust prüft jeden Pfad |
| Größe des Binarys (R4) | messen | nicht gemessen | ein Release-Build im Container ist zu teuer; neue Crates: rustls, ring (schon über Tauri? nein), russh, suppaftp – bei Marc/CI messen |

## Fortschritt

- [x] Phase 1: Bestand gelesen, Crates geprüft (crates.io, 21.10.2026), Design geschrieben, freigegeben 21.10.2026.
  E3 entschieden: nur Schlüsselbund – sicherer als eine eigene Datei mit Master-Passwort (keine eigene
  Kryptografie-Bedienung, kein Master-Passwort-Dialog/Leerlauf-Vergessen als Fehlerquelle, das OS härtet den Speicher);
  ohne Schlüsselbund nur „für diese Sitzung“.
- [x] Phase 2: Rust – `remote/` (Pfade, Profile, Schlüsselbund, Vertrauen, FTP/FTPS, SFTP, Hub, View-Cache),
  `jobs/transfer.rs`, `jobs/remote_delete.rs`, Commands; 45 Tests gegen In-Process-Server (libunftp, russh-Server);
  R1 (FTPS-Datenkanal mit Session-Reuse) gegen vsftpd `require_ssl_reuse=YES` grün, R2 (Hänger) mit stummem Server
  getestet (Zeitlimit greift für FTP und SFTP).
- [x] Phase 3: Frontend – Store, Dialoge, Aktionen/Kürzel, Ordnermenü, Panel-Badge/„Verbinden“, Vetos, Löschen
  endgültig, Einstellungs-Export; 14 Specs.
- [x] Phase 4: E2E – siehe unten.
- [x] Phase 5: Doku (architecture, roadmap, feature-parity, features, README, release, CLAUDE.md, TODO.md).
- [ ] Phase 6: Abschlussprüfung, Review – siehe unten.
