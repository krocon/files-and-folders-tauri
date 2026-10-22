# CI- und Release-Workflows (Vorlagen)

Remote-Sitzungen dürfen `.github/workflows/` nicht schreiben. Deshalb liegen neue bzw. geänderte Workflows hier
als Vorlagen; Marc übernimmt sie von Hand (Design 017).

| Vorlage | Ziel im Repo | Zweck |
|---|---|---|
| [`ci.yml`](ci.yml) | `.github/workflows/ci.yml` (ersetzt den heutigen) | Frontend (Versionen, Skript-Tests, format, lint, test, build) + Rust (fmt, clippy, test) auf **ubuntu, macOS, Windows** |
| [`release.yml`](release.yml) | `.github/workflows/release.yml` (neu) | Pakete je OS mit `tauri-apps/tauri-action`, als **Entwurf** eines GitHub-Releases; manuell oder per Tag `v*` |

## Übernehmen

```bash
cp docs/ci/ci.yml .github/workflows/ci.yml
cp docs/ci/release.yml .github/workflows/release.yml
git add .github/workflows && git commit -m "ci: CI on three OSes, release workflow (from docs/ci)"
git push
```

Danach in GitHub:

1. **Actions → CI** abwarten. Rechne beim ersten Lauf mit **Fehlern unter macOS/Windows**: der `#[cfg(target_os =
   …)]`-Code aus 006–016 (Umbenennen ohne Ersetzen, Laufwerke, Finder/Explorer, Terminal, Windows-Attribute,
   Papierkorb-Prüfung, Netzlaufwerke) wurde im Linux-Container nie kompiliert. Die Logs der `rust`-Matrix sind
   die To-do-Liste – Fixes am besten in einer Sitzung mit diesen Logs.
2. **Actions → Release → Run workflow** (Branch `main`, „draft“ angehakt). Ergebnis: ein Release-**Entwurf** mit
   `.dmg`/`.app.tar.gz` (macOS universal), `.msi` + `-setup.exe` (Windows), `.deb`, `.rpm`, `.AppImage` (Linux).
   Nichts wird veröffentlicht, bis der Entwurf von Hand freigegeben wird.
3. Ohne Signatur-Secrets sind die Pakete **unsigniert** (Hinweise für Nutzer: README „Installation“). Secrets
   und Ablauf: [`../release.md`](../release.md).

## Was die Vorlagen bewusst nicht tun

- keine Tags, keine automatische Veröffentlichung (Entwurf; Tag-Build prüft nur, dass Tag = `package.json`-Version)
- keinen Updater (bewertet in `docs/release.md`, nicht aktiviert)
- keine Release-Builds in der normalen CI (zu langsam; Pakete baut nur `release.yml`)

## Vor dem ersten Lauf: Cross-Check aus Linux

`pnpm rust:cross` (`scripts/cross-check.sh`) prüft den Rust-Code für **Windows x64, macOS arm64 und x64** mit
`clippy -D warnings` (Bibliothek + Tests), ohne Windows/macOS: die Standardbibliothek wird aus den Rust-Quellen
gebaut (`-Zbuild-std`), C/C++-Build-Skripte bekommen einen Platzhalter-Compiler. Es wird nichts gelinkt und nichts
ausgeführt – der Check findet Kompilierfehler und Lints im `#[cfg]`-Code, kein Verhalten. Stand 22.10.2026: alle drei
Ziele grün (vorher 8 Lints unter Windows, 2 Kompilierfehler in einem Linux-Test unter macOS).

## Lokal nachstellen

```bash
pnpm version:check          # package.json ↔ tauri.conf.json ↔ Cargo.toml/Cargo.lock
pnpm scripts:test           # Tests der Skripte unter scripts/
pnpm check                  # wie die CI unter Linux (enthält beides)
pnpm tauri build            # Pakete für das eigene OS (Linux: deb, rpm, AppImage)
```
