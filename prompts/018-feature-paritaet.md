# Prompt 018: Abgleich mit dem alten Programm (Feature-Parität)

> **Slug:** `feature-paritaet` · **Braucht:** 001–015 (016/017 optional) · **Umfang:** S–M
> Lies zuerst `prompts/000-arbeitsweise.md`.

## Ziel

Belegen, dass die Neuauflage den Funktionsumfang von `node-files-and-folders-client/-server` (npm
`files-and-folders`) abdeckt – oder bewusst und begründet abweicht. „Funktionsgleich“ darf erst behauptet werden,
wenn jede Zeile der Matrix durch Implementierung **und** Test belegt ist.

## Aufgaben

1. `docs/feature-parity.md` neu aufbauen: jede Funktion aus `docs/legacy-analysis.md` §2–§8 als Zeile (Action-Ids,
   Dialoge und deren Optionen, Listenverhalten, Panels/Tabs, Operationen, Konfiguration, Farbschemata) mit Spalten
   Referenz (legacy §), Umsetzung (Datei/Prompt), Status (✅/🟡/⬜/✖), Tests (Datei/Testname), Abweichung + Grund.
2. Lücken schließen oder als bewusst abweichend begründen (z. B. Auth, Server-Port, Upload-Dialog = obsolet).
3. Die im alten Code gefundenen Fehler (legacy §9) einzeln prüfen: in der Neuauflage nicht vorhanden → Verweis auf
   Test.
4. Ende-zu-Ende-Durchlauf eines typischen Arbeitstags (Navigieren, Markieren, Kopieren mit Konflikt, Multi-Rename,
   Gruppieren, Suchen, Tabs, Neustart) auf macOS und mindestens einer weiteren Plattform; Ergebnisse im Bericht.
5. `docs/roadmap.md` und README aktualisieren; nächste Ausbaustufen vorschlagen.

## Akzeptanzkriterien

- Matrix vollständig, jede ✅-Zeile mit Testverweis; Abweichungen begründet.
- Alle Fehler aus legacy §9 sind behoben oder als „entfällt“ begründet.
