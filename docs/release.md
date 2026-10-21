# Release und Distribution

> Stand: Prompt 017 (Design: `prompts/done/017-release-distribution.design.md`). **Releases, Tags, Signierung und
> Veröffentlichung nur mit Marcs ausdrücklicher Freigabe.** Lizenz: **MIT** (`LICENSE`, `license` in
> `Cargo.toml`/`package.json`, `bundle.license` in `tauri.conf.json`).

## Version – eine Quelle

| Datei | Version |
|---|---|
| `package.json` | **Quelle** (`"version"`) |
| `src-tauri/tauri.conf.json` | `"version": "../package.json"` – Tauri liest sie dort (App, Pakete, About) |
| `src-tauri/Cargo.toml`, `Cargo.lock` | Kopie, gesetzt von `scripts/version.mjs` |

```bash
pnpm version:set 0.2.0      # schreibt package.json, Cargo.toml, Cargo.lock (kein Commit, kein Tag)
pnpm version:check          # Teil von `pnpm check` und der CI; Rust-Test `about::tests` prüft dasselbe
```

Sichtbar ist die Version im Dialog **About** (Aktion `OPEN_ABOUT_DLG`, Menü Hilfe bzw. unter macOS das native
„Über …“) inkl. Build-Art, Plattform und Tauri-Version; „Copy“ legt den Text für Fehlerberichte in die
Zwischenablage.

## Ablauf eines Releases (Checkliste)

1. `main` ist grün (CI auf allen drei OS).
2. `pnpm version:set X.Y.Z`, `pnpm check`, Commit `chore: release X.Y.Z`.
3. Release Notes: `pnpm release:notes` (Conventional Commits seit dem letzten Tag, gruppiert: Breaking, Features,
   Fixes, Performance, Doku; `chore`/`test`/`ci` ausgeblendet).
4. Tag `vX.Y.Z` pushen **oder** Actions → Release → Run workflow. Der Workflow legt einen **Entwurf** an.
5. Pakete aus dem Entwurf auf je einem Rechner pro OS-Familie installieren und starten (s. „Prüfen“), Notes
   einfügen, Entwurf veröffentlichen.

## Pakete je OS (`tauri.conf.json` → `bundle`)

| OS | Pakete | Einstellungen |
|---|---|---|
| macOS | `.app`, `.dmg` (universal: Apple Silicon + Intel) | `minimumSystemVersion` **12.0** (WKWebView ≥ Safari 17 für Angular 22), `hardenedRuntime`, Kategorie `Utility` (→ `public.app-category.utilities`), DMG-Fenster 660×400 |
| Windows | `.msi` (WiX), `-setup.exe` (NSIS) | NSIS `installMode: currentUser` (keine Admin-Rechte), Sprachen Englisch/Deutsch; WebView2 per Bootstrapper; feste WiX-`upgradeCode` (Updates ersetzen die alte Version); SHA-256 + Zeitstempel beim Signieren |
| Linux | `.deb`, `.rpm`, `.AppImage` | Abhängigkeiten (`libwebkit2gtk-4.1-0`, `libgtk-3-0`) ergänzt Tauri; Abschnitt `utils`; AppImage ohne GStreamer (keine Medienwiedergabe nötig) |

Gebaut im Container (Linux x86_64, 2026-10-18): siehe Design 017 „Fortschritt“ (Größen, Prüfung).

## Signierung und Notarisierung (vorbereitet, nicht eingerichtet)

Ohne Secrets baut `release.yml` **unsignierte** Pakete. Folgen für Nutzer: README „Installation“.

### macOS – Developer ID + Notarisierung

Voraussetzung: Apple Developer Program (Team), Zertifikat **Developer ID Application**.

Schritt-für-Schritt (Zertifikat, API-Schlüssel, lokaler Build, Prüfung mit `spctl`/`stapler`, Browser-Prompt):
**[macos-signing.md](macos-signing.md)** (Prompt 031).

| Secret | Inhalt |
|---|---|
| `APPLE_CERTIFICATE` | `.p12` des Developer-ID-Zertifikats, base64 (`base64 -i cert.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | Passwort des `.p12` |
| `APPLE_SIGNING_IDENTITY` | z. B. `Developer ID Application: GUI Expert GmbH (TEAMID)` |
| `APPLE_ID` | Apple-ID für die Notarisierung |
| `APPLE_PASSWORD` | app-spezifisches Passwort dieser Apple-ID |
| `APPLE_TEAM_ID` | Team-ID |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_PRIVATE_KEY` | statt Apple-ID (empfohlen): App-Store-Connect-API-Schlüssel – Issuer-ID, Schlüssel-ID, Inhalt der `.p8` |

Tauri signiert mit Hardened Runtime und reicht bei gesetzten `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` zur
Notarisierung ein (statt Apple-ID geht auch ein App-Store-Connect-API-Schlüssel: `APPLE_API_KEY`,
`APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`). Entitlements braucht die App derzeit nicht (keine Sandbox, kein JIT
außer dem der WebView). **Hinweis:** Volle Festplattenzugriffe (`~/Library/…`, andere Volumes) fragt macOS je
Ordner ab; das ist unabhängig von der Signatur.

### Windows – Code Signing

Variante A (klassisch, in `release.yml` vorbereitet): OV-/EV-Zertifikat als `.pfx`.

| Secret | Inhalt |
|---|---|
| `WINDOWS_CERTIFICATE` | `.pfx`, base64 |
| `WINDOWS_CERTIFICATE_PASSWORD` | Passwort des `.pfx` |

Der Workflow importiert es und setzt `bundle.windows.certificateThumbprint`; Tauri signiert `.exe`, `.msi` und
den NSIS-Installer (SHA-256, Zeitstempel `http://timestamp.digicert.com`). Seit 2023 liegen neue OV/EV-Schlüssel
meist auf Hardware/HSM – dann **Variante B**: Azure Trusted Signing o. ä. über `bundle.windows.signCommand`
(Befehl als Argument-Array, z. B. `trusted-signing-cli`); Secrets dann `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
`AZURE_TENANT_ID`. Entscheidung offen (Kosten, Firma).

### Linux

Keine Signatur nötig. Optional: Prüfsummen (`SHA256SUMS`) zum Release, GPG-Signatur der Datei.

### Schlüsselbund und Signatur (Server-Verbindungen, 034)

Gespeicherte Server-Passwörter liegen im Schlüsselbund des Systems (Dienst `io.github.krocon.filesandfolders`). Die
macOS-Keychain bindet den Zugriff an die **Code-Signatur**: ein unsignierter oder ad-hoc signierter Build fragt nach
jedem neuen Build einmal „… möchte auf den Schlüsselbund zugreifen“ („Immer erlauben“ gilt nur bis zum nächsten
Build). Mit Developer-ID-Signatur bleibt die Erlaubnis über Updates erhalten. Windows (Credential Manager) und Linux
(Secret Service) prüfen keine Signatur.

## Updater (`tauri-plugin-updater`) – bewertet, **nicht aktiviert**

| Punkt | Bewertung |
|---|---|
| Nutzen | Updates ohne erneuten Download; Windows/macOS/AppImage (deb/rpm nicht – dort Paketverwaltung) |
| Voraussetzung | eigenes Schlüsselpaar (`pnpm tauri signer generate`), öffentlicher Schlüssel in `tauri.conf.json` (`plugins.updater.pubkey`), privater als Secret `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`); `bundle.createUpdaterArtifacts: true`; Endpunkt (`latest.json` der GitHub-Releases, von `tauri-action` erzeugt) |
| Sicherheit | Signaturprüfung im Plugin; neue Capability `updater:default` – schmal, passt zu CLAUDE.md §4. **Schlüsselverlust = keine Updates mehr** für installierte Versionen (Schlüssel sicher verwahren) |
| macOS | Updates nur sinnvoll mit signierter + notarisierter App |
| Empfehlung | erst nach Lizenz, Signierung und dem ersten öffentlichen Release; bis dahin GitHub-Releases manuell. Keine Schlüssel erzeugt. |

## Prüfen (Akzeptanz)

| OS | Was | Stand 017 |
|---|---|---|
| Linux | `.deb` installieren (`apt install ./…deb`), starten, About zeigt die Version; AppImage starten | im Container gebaut, s. Design 017 |
| macOS | `.dmg` öffnen, App nach Programme ziehen, starten (unsigniert: Rechtsklick → Öffnen) | **offen** (kein macOS im Container) |
| Windows | `-setup.exe` ohne Admin installieren, starten; `.msi` installieren/deinstallieren | **offen** (kein Windows im Container) |

## Lizenzen der Abhängigkeiten

Bericht: [`licenses.md`](licenses.md) (`pnpm licenses:report > docs/licenses.md`). Stand 017: alle npm-Laufzeit-
abhängigkeiten permissiv (MIT, Apache-2.0, 0BSD); Rust: fast alles MIT/Apache/BSD/ISC/Zlib/Unicode, dazu
**MPL-2.0** in 5 Crates (`cssparser`, `cssparser-macros`, `dtoa-short`, `selectors` – über Tauris HTML-Verarbeitung
zur Build-Zeit; `option-ext` – über `dirs`). MPL-2.0 ist eine Copyleft-Lizenz auf Dateiebene: bei unveränderter
Nutzung genügt der Hinweis samt Bezugsquelle; sie verträgt sich mit jeder eigenen Lizenz (auch proprietär).
Für Releases: Drittlizenz-Hinweise (`THIRD-PARTY-NOTICES`) beilegen – Werkzeug-Vorschlag `cargo about`
(Vorlage) bzw. aus diesem Bericht; offen.
