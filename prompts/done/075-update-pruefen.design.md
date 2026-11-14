# Design 075: Nach Updates suchen (ohne Updater)

> **Status:** umgesetzt · **Datum:** 2026-11-14 · Auftrag: [075-update-pruefen.md](075-update-pruefen.md)
> Marc hat die selbständige Umsetzung ohne Haltepunkt nach dem Design freigegeben („setze den neuen Prompt selbständig
> um“). Kleines Feature: Phasen 2–5 zusammengelegt.

## Bestand

| Baustein | wofür | passt / fehlt |
|---|---|---|
| `about.rs`, `get_app_info` | eigene Version (aus `package.json`) | passt – `package_info().version` |
| `reqwest 0.13` | HTTP | **schon im Baum** (über `tauri`, ohne TLS) – nur TLS-Feature fehlt |
| `rustls` + `ring`, `rustls-platform-verifier` (034) | TLS mit OS-Zertifikaten | passt, `remote::trust::provider()` |
| `open` (`opener.rs`) | Datei mit Standard-App | passt auch für eine `https`-URL |
| `config_file::read_config`, `fs_atomic::write_atomic` | kleine Zustandsdatei | passt |
| Einstellungen (015) | Schalter „automatisch prüfen“ | neuer Schlüssel; `json` geht nur als Array → Zustand nicht dort |
| Menümodell (014/056) | Menüpunkt | macOS: About ist nativ im App-Menü → neuer Punkt dort; sonst Menü „Help“ |
| About-Dialog (017) | Knopf | passt |

## Entscheidungen

- **E1 Nur Rust spricht ins Netz, feste URL.** `update_check::LATEST_URL` =
  `https://api.github.com/repos/krocon/files-and-folders-tauri/releases/latest`. Das Frontend schickt **keine** URL.
  CSP bleibt unverändert.
- **E2 HTTP-Client `reqwest`** (`default-features = false`, `rustls-no-provider`, `system-proxy`): steckt schon über
  Tauri im Lockfile (0.13.5, gleiche Version), dazu kommen nur `hyper-rustls`/`tokio-rustls` und der System-Proxy von
  `hyper-util`. TLS-Konfiguration bauen wir selbst (`ring` + `rustls-platform-verifier`, wie 034) und geben sie per
  `tls_backend_preconfigured` – kein globaler Crypto-Provider, kein aws-lc, kein OpenSSL. `ureq` wäre ein zweiter
  HTTP-Stack, eigenes HTTP über `rustls` zu viel Code. Proxy: `HTTPS_PROXY` und System-Proxy (macOS/Windows) über
  `system-proxy`.
- **E3 Anfrage.** Nur `GET`, `Accept: application/vnd.github+json`, `User-Agent: files-and-folders/<version>`, keine
  weiteren Daten. Timeout 10 s (Verbindung 5 s), `https_only`, Antwort ≤ 256 KiB (gestreamt gezählt), höchstens 3
  Weiterleitungen und nur zu `api.github.com` (GitHub leitet bei umbenannten Repos um).
- **E4 Antwort ist feindlich.** Nur `tag_name`, `html_url`, `name`, `published_at`, `body`, `draft`, `prerelease`.
  `draft`/`prerelease` → `update_no_release`. `html_url` muss mit `https://github.com/krocon/files-and-folders-tauri/
  releases/` beginnen und nur harmlose Zeichen enthalten, sonst die feste Release-Seite. Notes ≤ 4 KiB (an
  Zeichengrenze gekürzt, Steuerzeichen außer `\n`/`\t` entfernt), im UI nur als Text.
- **E5 Versionsvergleich selbst** (≈ 60 Zeilen, SemVer 2.0.0-Rangfolge: `X.Y.Z`, optional `-pre`, `+build` ignoriert,
  `v`-Präfix erlaubt). Das Crate `semver` steckt nur als Build-Abhängigkeit von Tauri im Baum; für so wenig Code keine
  neue Laufzeit-Abhängigkeit.
- **E6 Fehlercodes** (Rust `FsErrorCode` + TS + Texte): `update_offline` (Verbindung/DNS/Timeout/TLS),
  `update_rate_limited` (403/429 mit `x-ratelimit-remaining: 0` oder 429), `update_no_release` (404, Entwurf,
  Pre-Release), `update_invalid_response` (kein JSON, ungültiger Tag, zu groß), `update_http` (sonstiger Status).
- **E7 Zustand in `update-check.json`** (`{ version: 1, lastCheck: <ms>, skipped: "1.5.0" }`, Rust-eigen, gelesen über
  `read_config`, atomar geschrieben). `lastCheck` wird bei **jedem** Versuch gesetzt (auch bei Fehlern – kein
  Dauerfeuer bei Rate-Limit). Begründung gegen Einstellungen: `json`-Werte sind dort Listen, und jeder Schlüssel muss
  im Dialog erscheinen.
- **E8 Automatisch nur auf Wunsch.** Einstellung `general.checkForUpdates` (`bool`, Default **false**, Abschnitt
  „Allgemein“). Begründung: keine ungefragten Netzwerkzugriffe (wie 034 „nichts verbindet ohne Zutun“). Wenn an:
  30 s nach dem Start und danach stündlich prüft der Store, ob `lastCheck` ≥ 24 h zurückliegt; Fehler bleiben still.
- **E9 Anzeige.** Manuell: eigener Dialog `update` (Zustände Prüfen / aktuell / neuer / Fehler; Knöpfe „Open release
  page“ = Enter, „Skip this version“, „Close“ = Esc; Esc während der Prüfung schließt, die späte Antwort wird
  verworfen). Automatisch: **kein Modal** – ein Hinweis im vorhandenen Hinweisbereich des Fensters (`.notices`,
  `role="status"`, unten rechts) „Version 1.5.0 is available.“ mit „Details…“ (öffnet den Dialog) und „Dismiss“. Er
  verfällt nicht nach einer Minute wie andere Hinweise, sondern bleibt bis „Dismiss“; „Skip this version“ im Dialog
  unterdrückt ihn bis zur nächsten neueren Version.
- **E10 Öffnen der Release-Seite** über Command `open_release_page(url?)`: nur die geprüfte URL aus E4 oder die feste
  Releases-Seite, sonst wird die feste Seite geöffnet.
- **E11 Aktion** `CHECK_FOR_UPDATES` („Check for updates…“, Gruppe `config`, ohne Kürzel), Menü: macOS App-Menü
  unter About, sonst Menü „Help“ vor About; Befehlspalette automatisch; Knopf im About-Dialog.

## Verträge

```text
check_for_update() -> UpdateInfo | FsError
  UpdateInfo { current, latest, newer, releaseUrl, name?, publishedAt?, notes?, notesTruncated, checkedAt }
load_update_state() -> UpdateState { lastCheck?: number(ms), skipped?: string }
skip_update_version(version: string | null) -> ()      // null = nichts überspringen; keine Version → update_invalid_response
open_release_page(url: string | null) -> ()
```

## Tests

- Rust: Versionsvergleich (Präfix, Pre-Release-Rangfolge, Build, ungültig), Auswertung echter Antworten (Fixture),
  Entwurf/Pre-Release, fremde URL, Notes-Kürzung, Status → Code, Zustandsdatei (fehlt/kaputt/Round-Trip),
  `fetch` gegen lokalen `TcpListener` (200, 404, 403 Rate-Limit, zu groß, Timeout-frei), `command_rules`.
- Frontend: `UpdateStore` mit `FakeUpdateApi` (Default aus = kein Aufruf, 24-h-Planung mit Fake-Uhr, übersprungene
  Version, veraltete Antwort verworfen, Fehler still/laut), Dialog-Zustände, Menümodell je OS.

## Fortschritt

- [x] Design
- [x] Rust
- [x] Frontend
- [x] Doku
