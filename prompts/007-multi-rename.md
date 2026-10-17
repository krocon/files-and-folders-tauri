# Prompt 007: Multi-Rename

> **Slug:** `multi-rename` · **Braucht:** 005, 006 · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: `docs/legacy-analysis.md` §3.1 (vollständig),
> §9 (Fehler).

## Ziel

Das Mehrfach-Umbenennen des alten Programms – Muster, Bereiche, Zähler, Groß-/Kleinschreibung, Ersetzungen mit
Regex und „nur wenn“, Makros, Live-Vorschau – neu und **korrekt**: Prüfung gegen vorhandene Dateien, Ordner und
Namen ohne Endung, sichere Ausführung als Job und Rückgängig.

## Funktionsumfang (aus dem alten Programm, Details legacy §3.1)

- Muster `[N]`, `[E]`, `[P]`, Bereiche `[N2-5]`, `[N2-]`, `[N-5]` (0-basiert, Ende exklusiv), Zähler `[C]` mit
  Start/Schritt/Stellen; Default `[N].[E]`.
- Schreibweise: unverändert, GROSS, klein, Erster Buchstabe, Wörter, Chicago Manual of Style.
- Optionen (Reihenfolge!): Umlaute ersetzen, riskante Zeichen entfernen, Leerzeichen → `_`, Elternordner-Namen
  entfernen.
- 4 Ersetzungszeilen: an/aus, Suchen, Ersetzen, Regex (`/re/flags`), „nur wenn passt“ (Regex oder Teilstring);
  Makro-Vorlagen „Wörter umstellen“ (3 Stück).
- Vorschau: Nr., alt, Info (OK / unverändert / Fehler), neu; Fehler bei Dubletten innerhalb der Auswahl.

## Zu behebende Fehler bzw. Erweiterungen

- `README` (ohne Punkt) wurde zu `.README`; Ordner wurden wie Dateien zerlegt → Regeln für Namen ohne Endung,
  Ordner (keine Endung), Dateien mit führendem Punkt (`.gitignore`) und Mehrfachendungen (`.tar.gz` – Option).
- Zähler-Option „50“ hatte Wert 30; Panel-Refresh lief nie.
- Neu: Prüfung gegen das Dateisystem (Ziel existiert und ist nicht Teil der Umbenennung), Ketten und Tausch
  (`a→b`, `b→a`) über Zwischennamen, Groß-/Kleinschreibungs-Wechsel auf case-insensitiven Dateisystemen,
  ungültige Zeichen je OS, Länge; Token `[D]`/`[T]` (Datum/Uhrzeit der Datei, Format im Design) optional;
  **Rückgängig** der letzten Umbenennung (Protokoll im Speicher, optional als Datei).

## Aufgaben

1. **Regel-Engine** als reine, gut getestete Funktion. Entscheiden: im Frontend (TypeScript, schnelle Vorschau)
   **und** Validierung/Ausführung im Rust-Backend, oder Engine nur in Rust mit Vorschau-Command. Empfehlung
   begründen; doppelte Logik vermeiden (eine Quelle der Wahrheit).
2. **Rust**: `plan_rename(items, rules) -> Plan` (Vorschau + Konflikte gegen Platte) und Ausführung als Job (005)
   mit Zwischennamen bei Zyklen, Abbruch und Bericht; `undo_rename(planId)`.
3. **Dialog** (Alt+F6 bzw. Strg+M wie TC): großer Dialog, Vorschau-Tabelle (GuiExpert Table, virtuell, 10 000
   Einträge flüssig), Fehlerzeilen hervorgehoben, Filter „nur geänderte/Fehler“. Einstellungen werden als Vorlage
   speicherbar (benannt) und die letzte wird gemerkt.
4. **Tests**: Tabellengetriebene Tests für jede Regel (aus den alten Hilfetexten/Beispielen ableiten), Unicode
   (NFC/NFD auf macOS!), Chicago-Style-Grenzfälle, Regex-Fehler (ungültiger Ausdruck → Meldung, kein Absturz),
   Zyklen, Konflikte, Undo.

## Ergänzungen aus files-and-folders-mr (mr §5)

- Zusätzliche Makros `[Q]` (Großelternordner) und `[R]` (Urgroßelternordner), Option „Endung ignorieren“, `strategy`.
- **KI-Modus** (mr: `POST /api/ai/convertnames` mit OpenAI oder lokalem Llama, Prompts in `prompt/defaults/*.yaml`):
  im Design entscheiden, ob/wann – nur optional, Schlüssel im OS-Schlüsselbund, nie im Klartext; Vorschau bleibt
  Pflicht.
- Bekannter Fehler: Zähler-Schritt „50“ hatte auch in mr den Wert 30.

## Entscheidungsfragen

- Engine in TS, Rust oder beiden (mit gemeinsamem Testkatalog als JSON)?
- Unicode-Normalisierung bei Vergleich und Ergebnis (macOS speichert NFD)?
- Undo-Protokoll persistent?

## Akzeptanzkriterien

- Alle Funktionen des alten Dialogs vorhanden und getestet; die genannten Fehler behoben (je ein Test).
- Vorschau zeigt Konflikte mit vorhandenen Dateien; „Umbenennen“ ist bei Fehlern gesperrt.
- Tausch `a↔b` funktioniert; Undo stellt den Ausgangszustand her.
- 10 000 Dateien: Vorschau < 300 ms nach Eingabe (gemessen).
