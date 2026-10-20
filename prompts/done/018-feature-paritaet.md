# Prompt 018: Abgleich mit dem alten Programm (Feature-Parität)

> **Slug:** `feature-paritaet` · **Braucht:** 001–017, 019 · **Zusammen mit:** 020 (Actions-Menü) · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`.

## Vorlage (SOLL-Zustand)

Maßgeblich ist die **letzte alte Version `files-and-folders-mr`** (Angular 20 + NestJS + Electron, 2025). Ihr
Quellcode liegt lokal unter **`old_project/`** (nicht im Git, `.gitignore`): `old_project/apps/fnf` (Frontend),
`old_project/apps/fnf-api` (NestJS-Backend), `old_project/libs/fnf-data` (gemeinsame Modelle, Aktions-Ids, Defaults).
In einer Remote-Sitzung liegt der Ordner nur auf Marcs Mac: per `device_bash` als `tar` packen (ohne Bilder/Fonts)
und in den Container holen. Lizenz: Custom Source-Available (CLAUDE.md §8) – **Verhalten, Texte, Konfigurationen und
Formate dürfen als Vorlage dienen, Code wird nicht kopiert.**

Zusammenfassung des alten Codes: `docs/legacy-analysis-mr.md` (§1 Fensteraufbau … §11 Fehler); die ältere
AngularJS-Version (`docs/legacy-analysis.md`) nur, wo mr nichts sagt. Bei Widersprüchen gilt der Code in
`old_project/`.

## Ziel

Belegen, dass die Neuauflage den Funktionsumfang von `files-and-folders-mr` abdeckt – oder bewusst und begründet
abweicht. „Funktionsgleich“ darf erst behauptet werden, wenn jede Zeile der Matrix durch Implementierung **und**
Test belegt ist.

## Aufgaben

1. **Inventur aus `old_project/`**: alle Aktions-Ids (`libs/fnf-data`, `action-execution.service.ts`,
   `file-table.component.ts`), Default-Kürzel je OS, Button-Leiste (Default/Shift/Ctrl/Alt), Menüs, Dialoge mit ihren
   Optionen, Listenverhalten (Spalten, Sortierung, Markierung, Typ-Ahead, Darstellung), Panels/Tabs/Persistenz,
   Operationen und Jobs, Konfigurationsdateien (`setup`, `tools`, `buttons`, Dateitypen, Suchvorlagen, Prompts),
   Themes, API-Endpunkte (was davon Funktion ist und was nur Transport).
2. **`docs/feature-parity.md` neu aufbauen**: eine Zeile je Funktion mit Spalten *Referenz* (Datei in `old_project/`
   bzw. legacy-mr §), *Umsetzung* (Datei/Prompt), *Status* (✅ umgesetzt + getestet / 🟡 teilweise / ⬜ offen /
   ✖ bewusst nicht), *Tests* (Datei/Testname bzw. E2E), *Abweichung + Grund*.
3. **Lücken schließen**, die klein sind (Aktion fehlt, aber die Funktion existiert schon; fehlender Alias; falsches
   Default-Kürzel; fehlende Option). Größere Lücken als ⬜ mit Vorschlag für einen Folge-Prompt. Obsoletes
   (Server-Port, Socket.IO, Upload/Download über HTTP, Server-Shell im Browser, Electron-Fensteroptionen) als ✖ mit
   Grund.
4. **Fehler der alten Version** (legacy-mr §11, legacy §9) einzeln prüfen: in der Neuauflage nicht vorhanden → Verweis
   auf Test oder Begründung („entfällt“).
5. **Prompt 020 (Actions-Menü)** gehört dazu: das Menü ▴ der Button-Leiste wie im Soll-Screenshot
   (`prompts/done/020-soll.png`) – ist zugleich die sichtbarste Paritäts-Zeile.
6. **Ende-zu-Ende-Durchlauf eines Arbeitstags** (Navigieren, Markieren, Kopieren mit Konflikt, Multi-Rename,
   Gruppieren, Suchen, Tabs, Actions-Menü, Neustart) unter Linux (Xvfb) im Container; macOS/Windows als Checkliste in
   `TODO.md` für Marc.
7. `docs/roadmap.md`, README und `prompts/README.md` aktualisieren; nächste Ausbaustufen (Folge-Prompts) vorschlagen.

## Akzeptanzkriterien

- Matrix vollständig gegen `old_project/`, jede ✅-Zeile mit Testverweis; Abweichungen begründet.
- Alle Fehler aus legacy-mr §11 / legacy §9 sind behoben oder als „entfällt“ begründet.
- Kleine Lücken geschlossen (mit Tests), große als Folge-Prompt vorgeschlagen.
- `pnpm check` grün.
