# Prompt 000: Gemeinsame Arbeitsweise für alle Feature-Prompts

> Gilt für alle Prompts in `prompts/` (Index und Reihenfolge: `prompts/README.md`). Jeder Feature-Prompt verweist
> hierher und beschreibt nur, was für sein Feature dazukommt. **Zuerst diese Datei lesen, dann den Feature-Prompt.**
> Bei Widersprüchen gilt diese Datei, außer der Feature-Prompt weicht ausdrücklich ab.

---

## 1. Vor dem Start

- `CLAUDE.md` vollständig lesen, dazu `docs/architecture.md`, `docs/roadmap.md`, `docs/ui-layout.md` (Fensteraufbau)
  und die im Feature-Prompt genannten Abschnitte aus `docs/legacy-analysis.md` (AngularJS/Node 2016, „legacy §“) bzw.
  `docs/legacy-analysis-mr.md` (Angular/NestJS 2025, „mr §“). Bei Abweichungen zwischen den beiden alten Versionen gilt
  die neuere (mr), sofern der Prompt nichts anderes sagt; ihr Quellcode liegt lokal unter
  `~/WebstormProjects/files-and-folders-mr` (nur lesen).
- **Abhängigkeiten prüfen:** Jeder Prompt nennt oben, welche Prompts vorher umgesetzt sein sollten
  (`prompts/README.md` → Status). Fehlt etwas: anhalten und fragen.
- Prüfen, ob es schon einen Stand gibt (Branch `feat/<slug>`, Design-Dokument, abgehakte Definition of Done).
- Toolchain prüfen (`node -v` ≥ 22.22.3, `pnpm -v`, `cargo -V`), `pnpm install`, einmal `pnpm check` – rote Checks
  vor dem Start sind ein eigener Befund, nicht stillschweigend „mitreparieren“.
- Branch **`feat/<slug>`** von `main`. Commits nach jeder grünen Phase (Conventional Commits). **Kein Push, kein
  Release, kein Force-Push** ohne ausdrückliche Anweisung.
- Taskliste mit einem Eintrag je Phase führen.

## 2. Phasen

| Phase | Ergebnis | Haltepunkt |
|---|---|---|
| 1 | Design-Dokument `prompts/NNN-<slug>.design.md` | 🛑 Freigabe abwarten |
| 2 | Rust: Specs zuerst (rot), dann Implementierung (grün) | Commit |
| 3 | Frontend: Specs zuerst, dann Implementierung | Commit |
| 4 | Ende-zu-Ende in der echten App | |
| 5 | Doku | Commit |
| 6 | Abschlussprüfung + Bericht | |

Kleine Features dürfen Phasen zusammenlegen (in Phase 1 entscheiden und im Design-Dokument festhalten). Reine
Frontend-Features lassen Phase 2 aus.

### Phase 1 – Bestand prüfen und entwerfen 🛑

- Die im Prompt genannten Code-Stellen lesen (eigenes Repo **und** – bei Tabellen-Themen – die GuiExpert Table im
  Mono-Repo, `CLAUDE.md` §5). Tabelle „Baustein → wofür → passt / fehlt / muss erweitert werden“.
- Verhalten des alten Programms aus `docs/legacy-analysis.md` übernehmen oder **begründet** abweichen (Desktop statt
  Browser, moderne Plattform-Konventionen, Sicherheit). Abweichungen im Design-Dokument und in
  `docs/feature-parity.md` festhalten.
- Für jede Entscheidungsfrage im Prompt: Optionen, Empfehlung, Begründung.
- **Verträge zuerst:** Rust-Commands (Name, Parameter, Rückgabe, Fehlercodes, Events/Channels) und die passenden
  TS-Typen; Tastenkürzel je OS; UI-Skizze (ASCII reicht) mit Fokus-Reihenfolge und ARIA-Rollen.
- Tests planen: welche Fälle in Rust, welche im Frontend, welche nur Ende-zu-Ende.
- Ergebnis als `prompts/NNN-<slug>.design.md` (Kopf: Status, Datum, Entscheidungen; unten Abschnitt „Fortschritt“
  für Sitzungswechsel). **Danach anhalten** und bestätigen lassen.

### Phase 2 – Rust

- Logik in reinen Modulen ohne Tauri (testbar), Command-Schicht dünn (`commands.rs` bzw. `commands/<bereich>.rs`).
- Tests mit `tempfile`: Normalfall, Unicode/Leerzeichen/Umlaute, Symlinks (auch auf Ordner, dangling), fehlende
  Rechte (als root nicht prüfbar → bedingt testen), Konflikte, Abbruch mitten in der Operation, große Mengen.
  Plattformspezifisches mit `#[cfg(...)]`; Windows-Pfade (Laufwerk, UNC) über `std::path` – keine Separator-Annahmen.
- Lange Arbeit: Job mit Fortschritt (`tauri::ipc::Channel`), Abbruch-Token, nie auf dem Async-Runtime-Thread
  blockieren. Destruktives wird im Backend validiert (Quelle ≠ Ziel, Ziel nicht innerhalb der Quelle, …).
- `cargo fmt`, `cargo clippy --all-targets -D warnings`, `cargo test` grün → Commit.

### Phase 3 – Frontend

- Backend nur über die typisierte Fassade (`app/core/...Api`), Fake-Implementierung für Tests in `src/testing/`.
- Zustand mit Signals; Stores je Panel (kein `providedIn: 'root'`), Globales in Root-Services. `OnPush`, zoneless.
- Tastatur und Aktionen über das Aktionssystem (ab Prompt 002), nicht über verstreute `keydown`-Handler.
- **Barrierefreiheit:** sichtbarer Fokus, jede Funktion per Tastatur, Dialoge mit `role="dialog"`/`aria-modal`,
  Fokusfalle und Rückgabe des Fokus, Menüs nach APG-Muster, Live-Region für Statusmeldungen, Kontraste in light und
  dark.
- Texte zentral (i18n-fähig, ab Prompt 015 übersetzt). Dateinamen sind Nutzerdaten: nie unescaped in `innerHTML`.
- Styling nur über Tokens aus `src/styles.scss` (neue Tokens dort für light **und** dark ergänzen).
- `pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm build` grün → Commit.

### Phase 4 – Ende-zu-Ende

- Die App wirklich starten (`pnpm tauri dev`; im Container `pnpm tauri build --debug --no-bundle` + Xvfb, s.
  `CLAUDE.md` §2) und jedes Akzeptanzkriterium des Prompts durchspielen – mit Testordnern, die Umlaute,
  Leerzeichen, Emoji, versteckte Dateien, Symlinks und einen nicht lesbaren Ordner enthalten.
- Bei Dateioperationen nur in eigens angelegten Testordnern arbeiten, nie in echten Nutzerdaten.
- Nicht Prüfbares (z. B. macOS-Papierkorb aus dem Linux-Container) im Bericht ausdrücklich nennen.

### Phase 5 – Doku

- `docs/architecture.md` (Entscheidungen, neue Abhängigkeiten mit Begründung), `docs/roadmap.md` (Status),
  `docs/feature-parity.md` (Matrix-Zeilen auf ✅/🟡 mit Testverweis), README („Was funktioniert“, Tastenkürzel).
- `CLAUDE.md`, wenn sich Regeln, Befehle oder Layout geändert haben.
- Im Prompt-Index `prompts/README.md` den Status abhaken; Design-Dokument „Fortschritt“ abschließen.

### Phase 6 – Abschlussprüfung

```bash
pnpm check
pnpm tauri build --debug --no-bundle
```

Danach Ende-zu-Ende-Durchlauf (Phase 4) wiederholen. Bei Dateioperationen, Suche und allem Sicherheitsrelevanten:
Review durch einen separaten Agenten, der den Code nicht geschrieben hat (Schwerpunkte nennt der Feature-Prompt).

**Abschlussbericht** (kurz, konkret): Was wurde geändert? Welche Dateien? Welche Befehle liefen tatsächlich? Welche
Checks grün? Welche Probleme/Einschränkungen (inkl. nicht getesteter Plattformen)? Nächster Schritt? Commits (Hash +
Titel). Gefundene Lücken in der GuiExpert Table mit Vorschlag für das Mono-Repo.

## 3. Definition of Done (zusätzlich zu der des Feature-Prompts)

- [ ] Design-Dokument freigegeben 🛑
- [ ] Rust- und Frontend-Specs grün, `pnpm check` grün, Debug-Build der App gebaut
- [ ] Akzeptanzkriterien Ende-zu-Ende geprüft (Testordner mit Unicode, Symlinks, gesperrtem Ordner)
- [ ] Tastaturbedienung und Fokus geprüft, light und dark angesehen
- [ ] Doku und `docs/feature-parity.md` aktuell, Prompt-Status abgehakt
- [ ] Commits auf `feat/<slug>`, kein Push/Release ohne Anweisung
