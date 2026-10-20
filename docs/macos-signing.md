# macOS: Signieren und Notarisieren (Direktvertrieb)

> Prompt 031 (`prompts/031-apple.md`). Ziel: `.app`/`.dmg` außerhalb des App Stores, die Gatekeeper ohne Warnung
> öffnet – **Developer ID Application** + Notarisierung über `notarytool`. Überblick über alle Plattformen:
> [release.md](release.md). Stand Okt. 2026, Tauri 2 (Quelle: <https://v2.tauri.app/distribute/sign/macos/>).

Ausgangslage im Repo: `identifier` `io.github.krocon.filesandfolders`, `bundle.macOS.hardenedRuntime: true`,
`signingIdentity: null` (die Identität kommt per Umgebungsvariable, nichts Geheimes im Repo), Ziele `app` + `dmg`,
`minimumSystemVersion` 12.0. Die CI-Vorlage `docs/ci/release.yml` exportiert die Secrets schon.

## 1. Apple Developer Account

| Frage | Antwort |
|---|---|
| Programm | **Apple Developer Program** (99 USD/Jahr). Ein kostenloser Account kann nicht notarisieren. Für die GUI Expert GmbH: Organisations-Mitgliedschaft (D-U-N-S-Nummer), sonst Einzelperson – der Name steht später im Zertifikat und im Gatekeeper-Dialog. |
| Zertifikat | **Developer ID Application** – signiert Apps für den Vertrieb außerhalb des App Stores. *Apple Distribution* ist nur für App Store/TestFlight, *Developer ID Installer* nur für `.pkg` (brauchen wir nicht). Nur der **Account Holder** darf Developer-ID-Zertifikate anlegen. Gültig 5 Jahre; bereits ausgelieferte, notarisierte Builds bleiben danach gültig. |
| Team-ID | 10 Zeichen, unter developer.apple.com → Account → Membership details. |

### Zertifikat anlegen

1. Auf dem Mac: **Schlüsselbundverwaltung** → Menü *Schlüsselbundverwaltung → Zertifikatsassistent → Zertifikat
   einer Zertifizierungsinstanz anfordern…* → E-Mail + Name, „Auf der Festplatte sichern“ → `CertificateSigningRequest.certSigningRequest`.
   (Der private Schlüssel entsteht dabei im Schlüsselbund „Anmeldung“ und verlässt den Mac nie.)
2. developer.apple.com → *Certificates, Identifiers & Profiles* → *Certificates* → **+** → *Developer ID Application*
   → Profiltyp **G2 Sub-CA** → CSR hochladen → `.cer` laden.
3. `.cer` doppelklicken, Schlüsselbund **„Anmeldung“** wählen.
4. Prüfen – die Zeile ist zugleich der Wert für `APPLE_SIGNING_IDENTITY`:
   ```sh
   security find-identity -v -p codesigning
   #  1) ABC123…  "Developer ID Application: GUI Expert GmbH (TEAMID1234)"
   ```
   Erscheint sie nicht, fehlt der private Schlüssel (CSR auf einem anderen Mac erzeugt) oder das Zwischenzertifikat
   *Developer ID – G2* (bei apple.com/certificateauthority laden).

### Zugang für die Notarisierung – zwei Varianten

**A. App-Store-Connect-API-Schlüssel (empfohlen):** unabhängig von Marcs Apple-ID und 2FA, einzeln widerrufbar,
für CI am besten.
1. appstoreconnect.apple.com → *Benutzer und Zugriff* → *Integrationen* → *App Store Connect API* →
   **Team-Schlüssel** (falls nötig erst „Zugriff anfordern“) → **+**, Name `notarytool`, Rolle **Developer**.
2. **Issuer-ID** (über der Tabelle) und **Schlüssel-ID** notieren, `AuthKey_<SCHLÜSSEL-ID>.p8` herunterladen –
   **geht nur einmal** (Button erscheint nach Neuladen der Seite). Ablegen unter
   `~/.appstoreconnect/private_keys/` (Rechte `600`), sicher sichern (z. B. Passwortmanager).

**B. App-spezifisches Passwort:** account.apple.com → *Anmelden und Sicherheit* → *App-spezifische Passwörter* →
Name `notarytool`. Bindet die Notarisierung an Marcs Apple-ID; ändert er das Hauptpasswort, werden alle
app-spezifischen Passwörter ungültig.

## 2. Lokales Setup und Tauri-Konfiguration

Variablen, die `pnpm tauri build` liest (z. B. in `~/.zshrc` oder besser einer nicht eingecheckten Datei
`~/.config/fnf-signing.env`, vor dem Build `source`n):

| Variable | Wann | Inhalt |
|---|---|---|
| `APPLE_SIGNING_IDENTITY` | immer | exakt der Name aus `security find-identity` (oder nur der SHA-1-Hash) |
| `APPLE_API_ISSUER` | Variante A | Issuer-ID (UUID) |
| `APPLE_API_KEY` | Variante A | Schlüssel-ID (10 Zeichen) |
| `APPLE_API_KEY_PATH` | Variante A | Pfad zur `.p8` |
| `APPLE_ID` | Variante B | Apple-ID (E-Mail) |
| `APPLE_PASSWORD` | Variante B | app-spezifisches Passwort |
| `APPLE_TEAM_ID` | Variante B | Team-ID |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | nur CI | `.p12` base64 + Passwort; lokal liegt das Zertifikat im Schlüsselbund |

Sind keine Notarisierungs-Variablen gesetzt, signiert Tauri nur (gut zum ersten Test).

**`tauri.conf.json`:** keine Änderung nötig. `hardenedRuntime: true` ist Pflicht für die Notarisierung und schon
gesetzt; `signingIdentity` bleibt `null`, damit kein Name/Team im Repo steht und unsignierte Builds weiter gehen
(Ad-hoc-Signatur für Tests: `"-"`, nicht notarisierbar). Optional später: `bundle.macOS.entitlements`.

**Entitlements – derzeit keine.** Geprüft gegen den Code (Okt. 2026):

| Funktion | Hardened Runtime betroffen? |
|---|---|
| Dateioperationen, Papierkorb, Archive, Watcher | nein – ohne App Sandbox gibt es keine Datei-Entitlements; macOS fragt per TCC (Schreibtisch, Dokumente, Netzlaufwerke, Wechseldatenträger) |
| Unterprozesse: Shell-Leiste, externe Tools, `open`, Terminal/Finder (`platform/desktop.rs`) | nein – Kindprozesse sind eigene, von Apple signierte Programme |
| WebView (WKWebView) | nein – JIT läuft in Apples eigenem WebContent-Prozess |
| AppleScript/Apple Events | würde `com.apple.security.automation.apple-events` + `NSAppleEventsUsageDescription` brauchen – der Code nutzt keine (Terminal/Finder über `open`) |

Nebeneffekt der Signatur: TCC-Freigaben bleiben über Updates erhalten (vorher hängt die Freigabe am Hash der
unsignierten Binary).

## 3. Build, Notarisierung, Prüfung

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin   # einmal, für universal
source ~/.config/fnf-signing.env
pnpm tauri build --target universal-apple-darwin
# Ergebnis: src-tauri/target/universal-apple-darwin/release/bundle/{macos,dmg}/
```

Tauri signiert die `.app` (inkl. Hardened Runtime und sicherem Zeitstempel), reicht sie über `notarytool` ein,
wartet auf das Ergebnis, **heftet das Ticket an (stapling)** und baut dann die `.dmg`. Ohne Stapling (z. B. wenn
Apple lange braucht): `--skip-stapling`, später `xcrun stapler staple`.

Die `.dmg` selbst wird nicht in jeder Tauri-Version mit notarisiert. Für einen Download, der auch ohne Netz sofort
geht, die `.dmg` zusätzlich einreichen:

```sh
DMG="src-tauri/target/universal-apple-darwin/release/bundle/dmg/Files and Folders_X.Y.Z_universal.dmg"
codesign --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$DMG"        # falls noch unsigniert
xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" \
      --issuer "$APPLE_API_ISSUER" --wait                            # Variante B: --apple-id/--password/--team-id
xcrun stapler staple "$DMG"
```

Prüfen (Erwartung jeweils in der Zeile darunter):

```sh
APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/Files and Folders.app"
codesign --verify --deep --strict --verbose=2 "$APP"
#  valid on disk / satisfies its Designated Requirement
codesign -dvv "$APP" 2>&1 | grep -E "Authority|flags|Timestamp"
#  Authority=Developer ID Application: …, flags=0x10000(runtime), Timestamp=…
xcrun stapler validate "$APP"; xcrun stapler validate "$DMG"
#  The validate action worked!
spctl -a -vvv -t exec "$APP"
#  accepted  source=Notarized Developer ID
spctl -a -vvv -t open --context context:primary-signature "$DMG"
#  accepted  source=Notarized Developer ID
```

Ablehnung durch Apple: `xcrun notarytool log <submission-id> --key … --key-id … --issuer …` zeigt die Gründe
(meist fehlender Zeitstempel, Hardened Runtime aus oder eine unsignierte eingebettete Binary).

Echter Test: `.dmg` über einen Browser herunterladen (setzt das Quarantäne-Attribut), öffnen, App nach Programme
ziehen, starten – es darf nur der normale Dialog „aus dem Internet geladen“ erscheinen, nicht „kann nicht geprüft
werden“.

## 4. GitHub Actions (optional)

Die Vorlage `docs/ci/release.yml` (von Marc nach `.github/workflows/` zu kopieren) kann beide Varianten.
`tauri-action` legt bei gesetztem `APPLE_CERTIFICATE` einen temporären Schlüsselbund an. Secrets
(*Settings → Secrets and variables → Actions*):

| Secret | Inhalt |
|---|---|
| `APPLE_CERTIFICATE` | Developer-ID-Zertifikat **mit privatem Schlüssel** aus der Schlüsselbundverwaltung als `.p12` exportiert, dann `openssl base64 -A -in fnf.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | Passwort des `.p12` |
| `APPLE_SIGNING_IDENTITY` | wie lokal |
| `APPLE_API_ISSUER`, `APPLE_API_KEY` | Variante A |
| `APPLE_API_PRIVATE_KEY` | Variante A: **Inhalt** der `.p8`; der Workflow schreibt ihn nach `$RUNNER_TEMP` und setzt `APPLE_API_KEY_PATH` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Variante B |

Ohne Secrets baut der Workflow weiter unsigniert.

## 5. Browser-Prompt: Apple-Seiten mit Claude durchgehen

Für Claude im Browser (Claude in Chrome oder den Browser der Desktop-App), angemeldet bei Apple:

```text
Hilf mir, im Apple Developer Account alles für den Direktvertrieb meiner macOS-App vorzubereiten
(Developer ID Application + Notarisierung). App: "Files and Folders", Bundle-ID io.github.krocon.filesandfolders.

Regeln: Ich bin selbst angemeldet. Gib nie Passwörter, 2FA-Codes oder Zahlungsdaten ein, kaufe nichts, akzeptiere
keine Vereinbarungen und lösche/widerrufe nichts – an solchen Stellen hältst du an und sagst mir, was ich klicken soll.
Lade keine Datei hoch und herunter, ohne mich vorher zu fragen. Schreib nie den Inhalt eines Schlüssels in den Chat.

1. developer.apple.com/account: Ist meine Mitgliedschaft im Apple Developer Program aktiv (Ablaufdatum)? Bin ich
   Account Holder? Notiere Team-ID und Team-Namen (Einzelperson oder Organisation).
2. Certificates, Identifiers & Profiles → Certificates: Gibt es schon ein gültiges "Developer ID Application"-
   Zertifikat? Nenne Name, Ablaufdatum und Sub-CA (G2?). Falls keins: führe mich bis zum Upload der CSR – die CSR
   erzeuge ich selbst in der Schlüsselbundverwaltung und lade sie hoch, wenn du mich dazu aufforderst.
3. Identifiers: Prüfe, ob io.github.krocon.filesandfolders als App-ID existiert. Für Developer ID ist das NICHT
   nötig – lege nichts an, sag mir nur den Stand.
4. appstoreconnect.apple.com → Benutzer und Zugriff → Integrationen → App Store Connect API → Team-Schlüssel:
   Gibt es einen Schlüssel für die Notarisierung? Wenn nicht, führe mich durch das Anlegen (Name "notarytool",
   Rolle "Developer"). Notiere Issuer-ID und Schlüssel-ID. Vor dem Download erinnere mich, dass er nur EINMAL geht
   und wohin ich ihn lege (~/.appstoreconnect/private_keys/).
5. Zum Schluss: eine Tabelle mit Team-ID, Zertifikatsname (= Wert für APPLE_SIGNING_IDENTITY), Ablaufdaten,
   Issuer-ID, Schlüssel-ID und was noch fehlt.
```

## Abnahme (offen, braucht Marcs Mac)

- [ ] Zertifikat im Schlüsselbund, `security find-identity` zeigt es
- [ ] `pnpm tauri build --target universal-apple-darwin` mit Variante A signiert + notarisiert
- [ ] alle Prüfbefehle aus Abschnitt 3 grün, Download-Test ohne Gatekeeper-Warnung
- [ ] README „Installation“: Hinweis auf unsignierte Pakete für macOS anpassen
