Ich entwickle eine Desktop-App mit **Tauri v2** und **Angular** auf macOS:
- **Projekt:** Files and Folders (Zweifenster-Dateimanager)
- **Bundle-Identifier:** io.github.krocon.filesandfolders
- **Build-Targets:** `.app` und `.dmg`
- **Konfiguration:** `hardenedRuntime: true` ist in `tauri.conf.json` bereits aktiv.

Ich möchte die App **außerhalb des Mac App Stores** über Direktvertrieb veröffentlichen, sodass sie von macOS Gatekeeper ohne Warnmeldung geöffnet werden kann (Code Signing mit **Developer ID Application** + **Apple Notarization** via `notarytool`).

Bitte hilf mir Schritt für Schritt bei der Einrichtung:

1. **Voraussetzungen im Apple Developer Account:**
  - Welches Zertifikat genau brauche ich (Developer ID Application vs. Apple Distribution)?
  - Wie erstelle ich den App Store Connect API-Schlüssel (oder ein App-spezifisches Passwort) für die Notarisierung?
  - schreibe mir einen Prompt für CLAUSE im Webbrowser

2. **Lokales Setup & Tauri 2 Konfiguration:**
  - Welche Umgebungsvariablen (`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` bzw. API-Key) erwartet Tauri 2 beim Aufruf von `pnpm tauri build`?
  - Müssen Anpassungen in `src-tauri/tauri.conf.json` vorgenommen werden?
  - Brauche ich eine `Entitlements.plist` für die Hardened Runtime (z. B. für Dateioperationen oder Subprozesse)?

3. **Build & Notarisierungs-Workflow:**
  - Wie sieht der genaue Build-Befehl aus, damit Tauri das Signing, Notarizing und Stapling (`stapler`) automatisch durchführt?
  - Wie kann ich das fertige DMG manuell mit `spctl` und `stapler validate` auf korrekte Notarisierung prüfen?

4. *(Optional)* Falls ich das später automatisieren will: Ein kurzes Beispiel für eine **GitHub Actions Workflow**-Konfiguration für macOS-Releases mit verschlüsselten Secrets.

Erkläre es bitte praxisnah und bezogen auf Tauri v2.
