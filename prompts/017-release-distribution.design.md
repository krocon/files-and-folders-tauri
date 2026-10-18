# Design 017: CI, Builds und Distribution

> **Status:** ✅ freigegeben (Marc: Go für alle Empfehlungen, 2026-10-17), umgesetzt · **Datum:** 2026-10-18 ·
> **Branch:** `feat/release-distribution` (von `main`)
> **Grundlage:** Prompt 017, CLAUDE.md §4 (Sicherheit, neue Abhängigkeiten), §7 (Workflows nur als Vorlage), §8
> (Lizenz offen). **Keine Releases, Tags, Schlüssel oder Veröffentlichung.**
> **Phasen:** zusammengelegt – Werkzeuge/Konfiguration, kleines Rust-/Frontend-Stück (About), Linux-Pakete, Doku.

---

## 1. Bestand

| Baustein | heute | Bewertung |
|---|---|---|
| `.github/workflows/ci.yml` (Marc) | Frontend auf ubuntu; Rust fmt/clippy/test auf ubuntu/macOS/Windows, Caches | **passt** im Kern; Vorschlag `docs/ci/ci.yml`: Versions-/Skript-Checks, `--locked`, Abbruch überholter Läufe, wöchentlich, manuell |
| Release-Workflow | fehlt | **neu** als Vorlage `docs/ci/release.yml` (tauri-action, Entwurf) |
| Version | `0.1.0` dreifach (package.json, tauri.conf.json, Cargo.toml) | **eine Quelle**: tauri.conf.json → `"../package.json"`, Cargo per Skript + Test |
| Icons | Tauri-Default (gelb/türkis) | **ersetzt** durch eigenes SVG → `pnpm tauri icon` |
| Bundle-Konfiguration | `targets: all`, nur Icons | **erweitert**: Ziele, Metadaten, macOS/Windows/Linux-Abschnitte |
| About | Aktion `OPEN_ABOUT_DLG` ohne Handler („015“); macOS natives „Über“ (014) | **minimaler Dialog** (Version, Build, Plattform, Tauri, Kopieren) |
| Signierung, Updater | – | **nur Doku** (`docs/release.md`), Secrets-Namen in der Vorlage |

## 2. Entscheidungen (Empfehlungen, alle übernommen)

- **E1 CI:** Vorlage statt Datei unter `.github/workflows/` (Remote darf dort nicht schreiben). Die Rust-Matrix
  über drei OS bleibt Pflicht: der `#[cfg]`-Code aus 006–016 ist unter macOS/Windows **nie kompiliert** worden.
  Debug-Builds laufen im Tauri-Dev-Modus (`devUrl`, geprüft in `tauri-codegen` 2.7.3) → kein Frontend-Build im
  Rust-Job nötig.
- **E2 Release-Workflow:** `tauri-apps/tauri-action@v0`, Matrix macOS (universal, `--target
  universal-apple-darwin`), ubuntu-22.04 (älteres glibc für AppImage/deb), windows-latest. Auslöser Tag `v*` oder
  manuell; Ergebnis **immer Entwurf** (manuell abwählbar), `prerelease` solange `0.x`. Tag ≠ Version → Abbruch.
  Signatur-Secrets optional: leere Apple-Secrets werden gar nicht erst exportiert (sonst versucht der Bundler einen
  leeren Import), Windows-Zertifikat nur bei vorhandenem Secret importiert.
- **E3 Version:** Quelle `package.json`; `tauri.conf.json` verweist darauf (`"version": "../package.json"`, offizielle
  Tauri-2-Option); `scripts/version.mjs check|set` hält `Cargo.toml` und den eigenen `Cargo.lock`-Eintrag gleich.
  Geprüft dreifach: `pnpm version:check` (Teil von `pnpm check`), Rust-Test `about::tests::crate_version_matches_package_json`,
  Spec im Frontend. Kein `npm version` (würde taggen/committen).
- **E4 Release Notes:** `scripts/release-notes.mjs` gruppiert Conventional Commits seit dem letzten Tag (Breaking,
  Features, Fixes, Performance, Doku; chore/test/ci/build/style ausgeblendet) – keine neue Abhängigkeit, kein
  CHANGELOG-Automat (das wäre `release-please`/`changesets`, lohnt erst mit regelmäßigen Releases).
- **E5 Icon:** eigenes, schlichtes Motiv (zwei Seiten: Ordner links, Liste mit Cursorzeile rechts), Blau/Gelb,
  macOS-Raster (824 px Körper, 100 px Rand). Quelle `src-tauri/icons/source/app-icon.svg`; `pnpm tauri icon`
  erzeugt PNG/ICO/ICNS (Tauri-CLI rendert SVG selbst). `android/`, `ios/`, `64x64.png` nicht übernommen.
  `public/favicon.ico` aus demselben Motiv (16/32/48).
- **E6 Pakete:** `targets` explizit (`deb, rpm, appimage, dmg, app, msi, nsis`); Kategorie `Utility`; macOS
  `minimumSystemVersion 12.0` (WKWebView = Safari 17+ für Angular 22), `hardenedRuntime`; Windows NSIS
  `currentUser` (keine Admin-Rechte), Sprachen Englisch/Deutsch, WebView2-Bootstrapper, feste WiX-`upgradeCode`
  (UUIDv5 aus der Bundle-Id), SHA-256 + Zeitstempel; Linux deb `utils`, AppImage ohne GStreamer.
  `bundle.license` bleibt leer (§8).
- **E7 About:** Rust `about.rs` (`AppInfo`: Name, Version aus der Tauri-Konfiguration, Crate-Version, Tauri-Version,
  OS, Arch, Debug) + Command `get_app_info`; Fassade `AboutApi`; Dialog `features/about/` (Kopieren für
  Fehlerberichte). Abweichende Crate-Version wird angezeigt. Auf macOS bleibt zusätzlich das native „Über“.
  Annahme: 015 (parallel) baut keinen eigenen About-Dialog – sonst beim Merge zusammenführen (Dateien isoliert in
  `features/about/`, nur `OPEN_ABOUT_DLG` im Katalog von „015“ auf „017“).
- **E8 Lizenzbericht:** `scripts/licenses.mjs` aus `cargo metadata` (alle Plattformen) und `pnpm licenses list` →
  `docs/licenses.md`; kein `cargo-deny`/`cargo-about` (Installation dauert, Bericht reicht vorerst; Vorschlag
  `cargo about` für `THIRD-PARTY-NOTICES` in `docs/release.md`).
- **E9 Updater:** bewertet, nicht aktiviert (Schlüssel, Endpunkt, Capability – `docs/release.md`).
- **E10 Signierung:** nur vorbereitet; macOS Developer ID + Notarisierung (Apple-ID oder API-Key), Windows `.pfx`
  oder Azure Trusted Signing (`signCommand`) – Entscheidung offen.

## 3. Verträge

```rust
#[tauri::command] fn get_app_info(app) -> AppInfo
struct AppInfo { name, version, crate_version, tauri_version, os, arch, debug }   // camelCase
```

```ts
abstract class AboutApi { getAppInfo(): Promise<AppInfo> }   // rejects FsError (no_backend)
```

Skripte: `pnpm version:check`, `pnpm version:set X.Y.Z`, `pnpm release:notes [from] [to]`,
`pnpm licenses:report`, `pnpm scripts:test` (`node --test`).

## 4. Annahmen

- Keine neue Laufzeitabhängigkeit; `tauri-action`, `dtolnay/rust-toolchain`, `Swatinem/rust-cache`,
  `pnpm/action-setup`, `actions/setup-node` nur in den Workflow-Vorlagen.
- macOS 12 als Mindestversion (anpassbar); universal statt zwei Pakete (ein Download, doppelte Größe).
- Publisher/Copyright „Marc Kronberg“ (Repo-Besitzer); bei Firmenvertrieb ggf. „GUI Expert GmbH“.

## 5. Offen

- CI auf macOS/Windows tatsächlich laufen lassen (Marc übernimmt `docs/ci/ci.yml`), Fehler beheben.
- Installation/Start auf macOS und Windows (kein Gerät im Container).
- Lizenz des Projekts (Voraussetzung für Releases), `THIRD-PARTY-NOTICES`.
- Zertifikate/Notarisierung, Updater-Schlüssel.
- Windows: Papierkorb-Prüfung je Laufwerk (Design 006 E1, nicht Teil von 017).

## 6. Review (separater Agent) – Ergebnis

| # | Befund | Bewertung | Umgang |
|---|---|---|---|
| | | | |

## 7. Fortschritt

- [x] Design (dieses Dokument)
- [x] Version: Skript + Tests, tauri.conf.json → package.json
- [x] Release Notes, Lizenzbericht (Skripte + Tests, `docs/licenses.md`)
- [x] Icon (SVG-Quelle, alle Größen, Favicon)
- [x] Bundle-Konfiguration je OS
- [x] About: Rust `about.rs` + Command, `AboutApi`, Dialog, Aktion
- [x] CI-/Release-Vorlagen `docs/ci/`, `docs/release.md`, README
- [x] Linux-Pakete gebaut (`pnpm tauri build --bundles deb,rpm,appimage`, Release, 12 min Kompilieren):
  `.deb` 4,8 MiB, `.rpm` 4,8 MiB, `.AppImage` 79,6 MiB (bringt WebKitGTK mit); Binary 17 MiB. `.deb` mit `dpkg -i`
  installiert (Depends `libwebkit2gtk-4.1-0, libgtk-3-0`, Desktop-Datei Kategorie `Utility`, Icons hicolor 32/128/256),
  `/usr/bin/files-and-folders-tauri` unter Xvfb gestartet, About über die Befehlspalette: „Version 0.1.0 · release ·
  Linux · x86_64 · Tauri 2.12.4“, neues Icon sichtbar; danach `dpkg -r`. AppImage mit `--appimage-extract-and-run`
  gestartet (kein FUSE im Container) – Fenster erscheint. `target/release` danach gelöscht.
- [x] `pnpm check` grün (inkl. `version:check`, `scripts:test` 10, Vitest 587, Rust 269), Debug-Build `--no-bundle` grün
- Hinweis: `Maintainer` im `.deb` kommt aus `authors` in `Cargo.toml` (`krocon`) – bei Bedarf mit Name/E-Mail füllen.
