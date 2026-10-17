# Prompt 017: CI, Builds und Distribution

> **Slug:** `release-distribution` · **Braucht:** – (jederzeit; spätestens vor dem ersten Release) · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`. **Releases, Tags, Pushes und Signierung nur nach ausdrücklicher
> Freigabe.**

## Ziel

Reproduzierbare Builds für macOS, Windows und Linux, eine CI, die bei jedem Push prüft, und ein vorbereiteter
Release-Ablauf (Versionen, Release Notes, Icons, Signierung/Notarisierung, Pakete).

## Aufgaben

1. **CI** (`.github/workflows/ci.yml` – Entwurf existiert und muss ggf. von Marc ins Repo gelegt werden, weil die
   Remote-Sitzung `.github/workflows/` nicht schreiben darf): Frontend (format, lint, test, build) + Rust (fmt,
   clippy, test) auf ubuntu/macos/windows, Caches.
2. **Build-Workflow** mit `tauri-apps/tauri-action`: Artefakte je OS (macOS `.dmg`/`.app` universal oder je
   Architektur, Windows `.msi`/NSIS, Linux `.AppImage`/`.deb`/`.rpm`), ausgelöst durch Tag oder manuell.
3. **Version** an einer Stelle (package.json ↔ `tauri.conf.json` ↔ `Cargo.toml` synchron, Skript wie
   `scripts/version.mjs` im Mono-Repo), Changelog/Release Notes (Conventional Commits).
4. **Icons**: eigenes App-Icon statt Tauri-Default (`pnpm tauri icon <quelle.png>`), Datei-Quelle im Repo.
5. **Signierung**: macOS Developer ID + Notarisierung, Windows Code Signing – nur vorbereiten (Secrets-Namen,
   Doku); ohne Zertifikate unsignierte Builds mit Hinweis.
6. **Updater** (`tauri-plugin-updater`) bewerten – nur mit Signaturschlüssel, Doku, keine Aktivierung ohne
   Freigabe.
7. **Lizenz** des Projekts klären (offen, `CLAUDE.md` §8) – Marc fragen, nicht selbst festlegen; Lizenzen der
   Abhängigkeiten prüfen (`cargo deny`/`cargo about`, `pnpm licenses list`) und Bericht.
8. README: Installation für Nutzer, bekannte Einschränkungen je Plattform.

## Akzeptanzkriterien

- CI grün auf allen drei Plattformen (Workflow-Dateien an Marc übergeben bzw. von ihm eingecheckt).
- Manuell ausgelöster Build erzeugt installierbare Pakete je OS; Installation und Start auf mindestens einer
  Plattform je OS-Familie geprüft (nicht Prüfbares nennen).
- Lizenzbericht der Abhängigkeiten liegt vor.
