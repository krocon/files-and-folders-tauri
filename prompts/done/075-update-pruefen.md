# Prompt 075: Nach Updates suchen – neuere Version auf GitHub erkennen (ohne Updater)

> **Slug:** `update-pruefen` · **Braucht:** 002 (Aktionen), 014/056 (Menüs), 015 (Einstellungen, i18n), 017 (Version,
> About, Release-Ablauf), 057 (Dialog-Tasten) · **Umfang:** S–M (Rust-Command + kleiner Frontend-Teil)
> Lies zuerst `prompts/000-arbeitsweise.md` und `prompts/done/017-release-distribution.design.md` (E1–E9, v. a. E9
> „Updater bewertet, nicht aktiviert“), dann `docs/release.md` (Abschnitte „Ablauf“ und „Updater“),
> `src-tauri/src/about.rs` (`AppInfo`), `commands.rs` (Muster `get_app_info`, Regel `command_rules`), `lib.rs`
> (Registrierung), `src/app/core/about/` (`AboutApi`, `about.models.ts`), `src/app/features/about/` (Dialog, Texte,
> Aktion `OPEN_ABOUT_DLG`), `features/menus/menu-model.ts` (Menü `help`; auf macOS sitzt About im App-Menü),
> `core/settings/settings-schema.json` + `settings.rs`, `src-tauri/Cargo.toml` (vorhandene TLS-Crates: `rustls` mit
> `ring`, `rustls-platform-verifier` aus 034) und `src-tauri/tauri.conf.json` (CSP).
> Design-Dokument: `prompts/done/075-update-pruefen.design.md` (E1 ff.).

## Auftrag (Marc)

Der Nutzer soll prüfen können, ob es eine neuere Version von Files and Folders gibt. **Variante 1**: nur prüfen und
darauf hinweisen – Herunterladen und Installieren macht der Nutzer selbst über die GitHub-Release-Seite. Der echte
Updater (`tauri-plugin-updater`, Signaturschlüssel, Notarisierung) bleibt bewusst außen vor (`docs/release.md`).

## Ist-Zustand

- Eine Version, Quelle `package.json` (017); `get_app_info` liefert `version`, `os`, `arch`, `debug`.
- Releases: Tag `vX.Y.Z` → Workflow legt einen **Entwurf** an, Marc veröffentlicht ihn (`docs/release.md`). Tags bis
  heute: `v1.1.0` … `v1.4.0`. Entwürfe und Pre-Releases liefert `GET /repos/{owner}/{repo}/releases/latest` nicht.
- Kein HTTP-Client im Backend, nichts in der App spricht von sich aus ins Internet (Serververbindungen 034 nur auf
  Nutzerwunsch). CSP: `connect-src ipc: http://ipc.localhost` – das Frontend kann und soll nicht selbst ins Netz.
- About-Dialog zeigt Version, Plattform und `github.com/krocon/files-and-folders-tauri` als Text.

## Aufgaben

### A. Backend (Rust)

1. Neues Modul `src-tauri/src/update_check.rs`, Command `check_for_update` (`async` bzw. `spawn_blocking`, CLAUDE.md
   §4 „Commands nie synchron“). Er fragt **eine feste URL** ab:
   `https://api.github.com/repos/krocon/files-and-folders-tauri/releases/latest` – Owner/Repo als Konstanten im Code,
   **nicht** aus Einstellungen, Frontend oder Konfiguration (kein beliebiger Abruf).
2. HTTP-Client: kleinste saubere Lösung im Design begründen. Vorschlag: `ureq` (synchron, ohne Tokio) mit `rustls` +
   `ring` und `rustls-platform-verifier` – beides ist schon im Baum (034), also kein OpenSSL und kaum neue Crates.
   Alternative prüfen: `reqwest` (schwerer), eigenes HTTP über `rustls` (zu viel Code). Eintrag in
   `docs/architecture.md` (Tabelle „Abhängigkeiten“), `pnpm notices`, `docs/licenses.md`.
3. Anfrage: nur `GET`, `Accept: application/vnd.github+json`, `User-Agent: files-and-folders/<version>` (GitHub
   verlangt einen; **keine** Nutzerdaten, keine Kennung, keine Telemetrie – auch nicht OS/Arch, wenn nicht nötig).
   Timeout gesamt ~10 s, Antwort auf ~256 KiB begrenzen, nur `https`, Weiterleitungen nur zu `api.github.com`/
   `github.com` (oder gar keine – im Design entscheiden). Proxy: Systemproxy/`HTTPS_PROXY` respektieren, wenn der
   Client das ohne Aufwand kann; sonst als offen notieren.
4. Antwort auswerten (feindliche Daten, wie 025): nur `tag_name`, `html_url`, `published_at`, `name` und optional
   `body` (gekürzt, z. B. 4 KiB, reiner Text – wird im UI **nie** als HTML gerendert). `draft`/`prerelease` = true →
   ignorieren. `html_url` muss mit `https://github.com/krocon/files-and-folders-tauri/releases/` beginnen, sonst
   verwerfen und die feste Release-Seite nehmen.
5. Versionsvergleich rein und getestet: `tag_name` ohne führendes `v`, SemVer `X.Y.Z` mit optionalem Pre-Release-Teil
   (`1.5.0-beta.1 < 1.5.0`). Crate `semver` oder 30 Zeilen eigener Code – im Design entscheiden. Ungültige Tags →
   Fehler `update_invalid_response`, kein Absturz. Debug-Build: vergleichen wie Release, aber im Ergebnis markieren.
6. DTO (serde camelCase, Rust ↔ `core/update/update.models.ts` von Hand synchron):
   `UpdateInfo { current, latest, newer: bool, releaseUrl, publishedAt?, notes? , checkedAt }`.
   Fehler als `FsError` mit neuen Codes, z. B. `update_offline` (keine Verbindung/DNS/Timeout), `update_rate_limited`
   (HTTP 403/429 mit Rate-Limit-Headern), `update_invalid_response`, `update_http` (sonstiger Status) – in beiden
   Dateien und in `describeFsError()`. Keine vollständigen Antworten loggen.
7. Öffnen der Release-Seite: vorhandenen Weg zum Öffnen von URLs prüfen (`opener.rs` öffnet Dateien). Falls nötig ein
   schmaler Command `open_release_page`, der **nur** die geprüfte Release-URL bzw. die feste Releases-Seite öffnet –
   keine beliebige URL aus dem Frontend.

### B. Wann geprüft wird

8. **Manuell**: Aktion `CHECK_FOR_UPDATES` („Check for updates…“, Gruppe `config`, Prompt `075`) im Aktionskatalog,
   im Menü `help` (auf macOS im App-Menü neben „About…“ – wie es das Menümodell für About löst), in der
   Befehlspalette; **kein** Default-Kürzel. Außerdem ein Knopf „Check for updates“ im About-Dialog.
9. **Automatisch (optional, aus per Default)**: Einstellung `general.checkForUpdates` (`bool`, Default `false`) im
   Schema (Rust + TS teilen die Datei) und im Einstellungsdialog mit Satz „Sends one request to GitHub, no personal
   data“. Wenn an: höchstens **einmal pro 24 h**, frühestens ~30 s nach dem Start, im Hintergrund, nie blockierend.
   Zeitpunkt der letzten Prüfung und eine **übersprungene Version** (`general.skippedUpdate`) merken – Ort im Design
   (Einstellungen oder eigene kleine Datei, atomar wie 015). Begründen, warum Default aus (keine ungefragten
   Netzwerkzugriffe, passt zu 034 „nichts verbindet ohne Zutun des Nutzers“). Falls Marc Default an möchte: im
   Design als Frage an Marc vor der Umsetzung.
10. Fehler bei der automatischen Prüfung bleiben **still** (höchstens im Log ohne Details); nur die manuelle Prüfung
    zeigt Fehler an.

### C. Anzeige

11. Manuelle Prüfung: kleiner Dialog (über `DialogService`, `Modal`, Tasten nach 057) mit den Zuständen „Prüfe…“
    (abbrechbar per Esc, veraltete Antwort verwerfen), „Du hast die neueste Version (1.4.0)“, „Version 1.5.0 ist
    verfügbar (veröffentlicht am …)“ mit Release-Notes als reinem Text (scrollbar, gekürzt) und Knöpfen
    **„Open release page“** (Enter), „Skip this version“, „Close“ (Esc), Fehler über `describeFsError()`.
    Alternativ den Inhalt in den About-Dialog integrieren – im Design entscheiden (Empfehlung: eigener kleiner Dialog,
    About bekommt nur den Knopf).
12. Automatische Prüfung findet eine neuere, nicht übersprungene Version: **unaufdringlicher Hinweis** (z. B. Zeile/
    Badge in der Statuszeile oder ein Punkt am Menü „Help“, Klick öffnet den Dialog aus 11) – kein Modal beim Start.
    Vorhandene Muster für Hinweise prüfen und wiederverwenden.
13. Texte en/de in `features/update/update-texts.ts` + `.de.ts`, `catalogs.spec.ts` grün. Datum über `localeFor()`.

## Akzeptanzkriterien

1. „Help → Check for updates…“ (macOS: App-Menü) zeigt bei aktueller Version „neueste Version“, bei einer niedrigeren
   eigenen Version (Test: `pnpm version:set 1.0.0` lokal, nicht committen) „1.4.0 ist verfügbar“; „Open release page“
   öffnet die Release-Seite im Standardbrowser.
2. Ohne Netzwerk erscheint eine verständliche Meldung „keine Verbindung“, nach Rate-Limit eine eigene Meldung; die App
   bleibt bedienbar.
3. Mit `general.checkForUpdates = false` (Default) macht die App **keinen** Netzwerkzugriff von sich aus (prüfbar mit
   Little Snitch/`nettop` oder durch Code-Review + Test der Planung).
4. Mit `true`: höchstens eine Anfrage je 24 h, Hinweis ohne Modal; „Skip this version“ unterdrückt den Hinweis bis zur
   nächsten neueren Version.
5. Entwürfe/Pre-Releases auf GitHub lösen keinen Hinweis aus.

## Tests

- Rust (`update_check.rs`): Versionsvergleich (gleich, kleiner, größer, `v`-Präfix, Pre-Release, ungültig), Parsen
  einer echten GitHub-Antwort (Fixture unter `src-tauri/src/update_check/testdata/` oder `include_str!`), `draft`/
  `prerelease`, fremde `html_url`, zu große Antwort, Notes-Kürzung, HTTP-Status → Fehlercode. Netzwerk im Test
  **nicht** gegen GitHub, sondern gegen einen lokalen Testserver (`std::net::TcpListener` mit fester Antwort) oder
  über eine Funktion, die nur den Body auswertet.
- `commands::command_rules` bleibt grün (Command async).
- Frontend: `update.store.spec.ts` mit `FakeUpdateApi` (Zustände, veraltete Antwort verwerfen, übersprungene Version,
  24-h-Planung mit Fake-Uhr, Default aus = kein Aufruf), Dialog-Spec (Zustände, Enter/Esc), Menümodell enthält die
  Aktion an der richtigen Stelle je OS.
- E2E (macOS lokal): Akzeptanzkriterien 1–2 durchklicken, Screenshot des Dialogs im Bericht beschreiben.
  `pnpm check` grün.

## Doku

- `prompts/done/075-update-pruefen.design.md` (E1 ff.), `prompts/README.md` (Zeile 075, „Nächste Prompts“), CLAUDE.md §1
  Stand + §3 Layout (`update_check.rs`, `core/update/`, `features/update/`), `docs/architecture.md` (Entscheidung +
  Abhängigkeit), `docs/release.md` (Abschnitt „Updater“: Variante 1 umgesetzt, Plugin weiter offen; Hinweis, dass
  nur **veröffentlichte** Releases erkannt werden), `docs/features.md` (Zeile „Keine automatischen Updates“
  anpassen), `docs/feature-parity.md` falls betroffen, README-Abschnitt kurz.

## Nicht in diesem Prompt

- Herunterladen, Signaturprüfung, Installieren (`tauri-plugin-updater`) – bleibt bis nach Signierung/Notarisierung.
- Update-Kanäle (Beta), Paketverwaltung (deb/rpm), Telemetrie jeder Art.
