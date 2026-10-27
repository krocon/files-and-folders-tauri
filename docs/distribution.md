# Distribution – Portale, Paketquellen, Listen

> Stand 27.10.2026. Erstes Release: **v1.0.0** (25.10.2026, GitHub Releases, Pakete für macOS/Windows/Linux,
> **unsigniert**). Seite: https://krocon.de/products/fnf/ · Repo: https://github.com/krocon/files-and-folders-tauri.
> Ablauf eines Releases: [`release.md`](release.md), Signierung: [`macos-signing.md`](macos-signing.md).

Was unsigniert schon geht und was auf die Signierung wartet:

| Gruppe | Wo | Voraussetzung |
|---|---|---|
| Repo-Angaben | GitHub: Beschreibung, Website, Topics, Social-Preview-Bild | – |
| Verzeichnisse mit Formular | AlternativeTo, Softpedia, Uptodown, MacUpdate, FileHorse, MajorGeeks, heise Download, CHIP, SourceForge (Spiegel der Releases), Slant, OpenAlternative | ehrliche Angabe „unsigned“ |
| Kuratierte Listen (Pull Request) | awesome-tauri, open-source-mac-os-apps, awesome-mac, awesome-linux-software, Awesome Rust (Applications) | Projekt öffentlich, README mit Bildern |
| Paketquellen (Pull Request/Account) | winget, Scoop (extras), AUR, AppImageHub | Installer-URLs der Releases; winget/Scoop besser mit Windows-Signatur |
| Paketquellen, die auf Signierung warten | Homebrew Cask (Gatekeeper-Pflicht), Mac App Store (nicht geplant) | Developer ID + Notarisierung |
| Später (eigener Aufwand) | Flathub (Flatpak-Manifest), Snap Store, Chocolatey | Manifest/Account |
| Ankündigungen (nur Entwürfe, Marc postet) | Show HN, r/rust, r/tauri, r/macapps, r/opensource, Product Hunt | Release mit Bildern |

## Browser-Prompt

Für Claude im Browser (Claude in Chrome oder den Browser der Desktop-App), in Marcs Browser mit seinen
Anmeldungen. Vorher: die Seite unter `https://krocon.de/products/fnf/` hochgeladen (`site/README.md`) und – wenn
die Funktionen aus 035/036/043 mit drin sein sollen – ein Release 1.1.0 veröffentlicht.

```text
Du übernimmst die Distribution meiner Desktop-App "Files and Folders" (kurz FnF): eintragen in Software-Portale,
kuratierte Listen und Paketquellen, Stand jeder Stelle in einer Tabelle festhalten. Ich (Marc Kronberg) bin
im Browser angemeldet bzw. melde mich an, wenn du mich bittest.

REGELN
- Passwörter, 2FA-Codes, Zahlungsdaten, Captchas: nie selbst eingeben – anhalten, mir sagen, was zu tun ist.
- Nichts kaufen, keine bezahlten Einträge/"Featured"/Boosts, keine Abos, keine Newsletter-Haken.
- Nutzungsbedingungen, Lizenzvereinbarungen, Entwickler-Verträge: nicht selbst bestätigen – mir die Stelle
  zeigen, ich klicke.
- Konten anlegen: nur nach meinem OK je Portal; E-Mail krocon@gmail.com, Name Marc Kronberg.
- Nichts posten, was wie Werbung in Communities aussieht (Reddit, Hacker News, Foren, Product Hunt): dafür nur
  Entwürfe in die Abschlusstabelle schreiben, ich poste selbst.
- Pull Requests auf GitHub: Fork + Branch + PR über die Weboberfläche ist ok, aber vor dem Klick auf
  "Create pull request" zeigst du mir Titel, Text und Diff. Halte dich an die CONTRIBUTING-Regeln jeder Liste
  (Format, Sortierung, Sterne-Minimum) – wenn FnF die Bedingungen nicht erfüllt, nicht einreichen, sondern notieren.
- Ehrlich bleiben: Pakete sind (noch) nicht signiert/notarisiert – das wo gefragt angeben. Keine erfundenen
  Bewertungen, Downloadzahlen, Auszeichnungen, Testimonials. Keine Kategorie wählen, die nicht passt.
- Keine Dateien von meinem Rechner hochladen, ohne vorher zu fragen. Bilder lieber per URL angeben.
- Keine bestehenden Einträge anderer Leute ändern oder melden.
- Wenn eine Seite nicht lädt oder sich anders verhält als erwartet: nach 2–3 Versuchen notieren und weiter.

FAKTEN (nur diese verwenden)
- Name: Files and Folders · Kurzname: FnF · Version: 1.0.0 (neueste: siehe Releases-Seite) · Lizenz: MIT, kostenlos,
  Open Source, keine Werbung, keine Telemetrie, kein Konto nötig
- Entwickler/Herausgeber: Marc Kronberg (Einzelentwickler, Königstein im Taunus, Deutschland) · Kontakt: krocon@gmail.com
- Website: https://krocon.de/products/fnf/ · Quellcode: https://github.com/krocon/files-and-folders-tauri
- Downloads (immer die Releases-Seite verlinken, nicht einzelne Dateien, wo das geht):
  https://github.com/krocon/files-and-folders-tauri/releases/latest
  Pakete v1.0.0: Files.and.Folders_1.0.0_universal.dmg (macOS 12+, Apple Silicon + Intel),
  Files.and.Folders_1.0.0_x64-setup.exe (Windows 10/11, ohne Admin), Files.and.Folders_1.0.0_x64_en-US.msi,
  Files.and.Folders_1.0.0_amd64.deb, Files.and.Folders-1.0.0-1.x86_64.rpm, Files.and.Folders_1.0.0_amd64.AppImage
  (Linux x86_64, WebKitGTK 4.1: Ubuntu 22.04+, Debian 12+, Fedora 36+)
- Bundle-ID / App-ID: io.github.krocon.filesandfolders
- Technik: Tauri 2, Rust, Angular · Sprachen der Oberfläche: Englisch, Deutsch
- Kategorie: Dateimanager / File Manager (Utilities); Alternativen zu: Total Commander, Double Commander,
  Norton Commander, Midnight Commander, ForkLift, Marta, Commander One, Finder, Windows Explorer
- Tags: file manager, two-panel, dual-pane, orthodox file manager, total commander alternative, keyboard,
  open source, tauri, rust, macos, windows, linux
- Kurzbeschreibung (EN, ≤ 80 Zeichen): Fast, keyboard-first two-panel file manager for macOS, Windows and Linux.
- Kurzbeschreibung (DE): Schneller Zwei-Fenster-Dateimanager für macOS, Windows und Linux – mit der Tastatur bedienbar.
- Beschreibung (EN):
  Files and Folders is a free, open-source two-panel file manager in the spirit of Norton Commander and Total
  Commander, for macOS, Windows and Linux. Every function is an action with a shortcut; the Command Palette finds
  actions, folders and files from all your folders (type "invoice 2025"). Copy, move, delete and search run as
  background jobs with progress, pause and conflict handling; deletes go to the trash. Highlights: tabs on both
  sides, multi-rename with preview and undo, search into a tab, flat view, duplicates and similar images, disk
  usage, compare and synchronise folders, ZIP/TAR/7z/RAR archives as folders (ZIP and TAR also editable),
  FTP/FTPS/SFTP servers, viewer and quick view, file compare, checksums, a shell line, a starter menu and eleven
  colour schemes including the classic Norton look. MIT licence, no ads, no telemetry.
- Beschreibung (DE): sinngemäß wie EN; für deutsche Portale (heise, CHIP) auf Deutsch.
- Bilder (1280×760 PNG, per URL):
  https://raw.githubusercontent.com/krocon/files-and-folders-tauri/main/site/img/main.png (Hauptbild)
  …/site/img/palette-files.png, …/command-palette.png, …/task-list.png, …/multi-rename-dialog.png,
  …/search-results.png, …/sync-folders.png, …/disk-usage.png, …/archive-folder.png, …/colour-schemes-overview.png
  Icon (1024×1024): https://raw.githubusercontent.com/krocon/files-and-folders-tauri/main/docs/icons/icon-new.png

ABLAUF (in dieser Reihenfolge; nach jedem Schritt die Tabelle aktualisieren)
0. Prüfen: Lädt https://krocon.de/products/fnf/ (Bilder sichtbar)? Hat
   https://github.com/krocon/files-and-folders-tauri/releases/latest alle sechs Pakete? Wenn nicht: anhalten, melden.
1. GitHub-Repo: About-Feld setzen (Beschreibung = Kurzbeschreibung EN, Website = krocon.de/products/fnf, Topics aus
   den Tags), unter Settings → Social preview main.png hochladen (frag vorher). Releases/Packages/Deployments-Anzeige
   so lassen.
2. Verzeichnisse mit Formular – je Portal: suchen, ob FnF schon gelistet ist; sonst Eintrag/Einreichung vorbereiten,
   mir das ausgefüllte Formular zeigen, nach meinem OK absenden:
   AlternativeTo (als Alternative zu Total Commander, Double Commander, ForkLift, Marta eintragen),
   Softpedia (Windows, Mac, Linux getrennt), Uptodown (Developer-Konsole), MacUpdate, FileHorse, MajorGeeks,
   heise Download (deutsch), CHIP Download (deutsch), SourceForge (Projekt anlegen und GitHub-Releases spiegeln
   lassen, wenn das ohne Bezahlung geht), Slant ("best two-panel file manager"-Fragen), OpenAlternative.
3. Kuratierte Listen auf GitHub (Pull Requests, Regeln oben): tauri-apps/awesome-tauri (Applications),
   serhii-londar/open-source-mac-os-apps, jaywcjlove/awesome-mac, luong-komorebi/Awesome-Linux-Software,
   rust-unofficial/awesome-rust (Applications/System tools). Erst die Aufnahmebedingungen prüfen.
4. Paketquellen – nur vorbereiten und mir zeigen, nichts einreichen:
   winget (Manifest für microsoft/winget-pkgs mit der setup.exe, Silent-Switch /S, Scope user),
   Scoop extras (Manifest mit der .msi oder setup.exe), AUR (PKGBUILD für das AppImage oder .deb – braucht meinen
   SSH-Schlüssel, nur Text erzeugen), AppImageHub (PR an AppImage/appimage.github.io). Prüfe jeweils, ob unsignierte
   Installer akzeptiert werden. Homebrew Cask NICHT einreichen (braucht signierte/notarisierte App) – nur notieren.
5. Ankündigungen: Entwürfe (Titel + Text, ehrlich, ohne Superlative) für Show HN, r/rust, r/tauri, r/macapps,
   r/opensource und Product Hunt in die Tabelle – nicht posten.

ABSCHLUSS
Eine Tabelle: Portal · Status (gelistet / eingereicht / vorbereitet / abgelehnt / übersprungen + Grund) · Link zum
Eintrag oder PR · Konto (ja/nein, welche E-Mail) · was ich noch tun muss (z. B. E-Mail bestätigen, Moderation
abwarten) · wann nachsehen. Darunter die Entwürfe aus Schritt 4 und 5 als Codeblöcke.
```

## Nach der Signierung

- Homebrew Cask (`files-and-folders`, Gatekeeper-Prüfung), Softpedia/MacUpdate-Einträge auf „signed“ ändern,
  README „Installation“ und die Seite anpassen.
- Mit Windows-Signatur: winget/Scoop/Chocolatey ohne SmartScreen-Warnung.
