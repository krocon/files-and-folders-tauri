# Prompt 058: Löschdialog – Anzahl Dateien und Gesamtgröße zuverlässig anzeigen

> **Slug:** `loeschdialog-zaehler` · **Braucht:** 005 (Job-Engine), 006 (Löschen, `liveCount`), 034 (Server), 016/025 (Archive) · **Umfang:** S (Fehlersuche + Frontend; Rust nur, falls die Ursache dort liegt)
> Lies zuerst `prompts/000-arbeitsweise.md`, `features/ops/delete-dialog.ts`, `features/ops/live-count.ts`,
> `features/ops/copy-move-dialog.ts` (zweiter Verwender) und in Rust `jobs/manager.rs` (`JobSpec::Count`, Entfernen von
> Hilfs-Jobs nach dem Ende) sowie `dirsize.rs` (`count_paths`). Kein eigenes Design-Dokument; Ursache und Entscheidung
> im Bericht.
> Screenshot von Marc (01.11.2026, aus 057): [`057-dialog-tasten-beispiel.png`](057-dialog-tasten-beispiel.png) –
> Löschdialog mit 5 Einträgen, **ohne** Größen-Zeile.

## Auftrag (Marc)

Im Dialog „Delete permanently“ (und „Delete“) soll ein Zähler stehen: wie viele Dateien es betrifft und die Summe der
Größe – wie in anderen Dialogen schon.

## Befund (Code gelesen, 01.11.2026)

**Die Funktion ist schon gebaut** – sie erscheint bei Marc aber nicht:

- `DeleteDialog` zählt per `liveCount(paths)` (Hilfs-Job `count`, Rust `dirsize::count_paths`) und zeigt eine Zeile
  `data-testid="delete-size"`: „Size: **4,2 GB** · 123 files, 4 folders“, während des Zählens „at least … · n counted
  so far“ mit Spinner. Gilt für Papierkorb **und** endgültig; nur in Archiven bewusst nicht. `dialogs.spec.ts` testet
  das (Z. ~312–381). Der Kopieren/Verschieben-Dialog nutzt dieselbe Funktion.
- Auf Marcs Screenshot (5 Einträge, Papierkorb-Modus) fehlt die Zeile komplett. Die Zeile verschwindet, sobald
  `count()` `null` liefert – laut `live-count.ts` in diesen Fällen:
  1. der `count`-Job wurde (noch) nicht gestartet bzw. `jobs.start` schlug fehl (`.catch(() => undefined)` – Fehler
     wird verschluckt),
  2. der Job ist beendet, aber ohne `summary.dirSize` („failed“, abgebrochen ohne Summe),
  3. **der Job ist nicht mehr im `JobsStore`** (`jobs.find(id)` = `undefined`) – Kommentar: „a helper job that Rust
     removes right after its end“. Endet das Zählen sehr schnell (kleine Ordner, < 100 ms), könnte die Entfernung
     beim Frontend ankommen, bevor oder während die Summe gelesen wird → Zeile weg. **Wahrscheinlichster Kandidat**,
     erst belegen.
  4. der Job wartet in der Warteschlange hinter einem laufenden Job (prüfen: `is_parallel()` für `Count`) – dann
     müsste aber „counting…“ erscheinen, sobald die Id da ist.
- **Marcs Fall (Rückfrage 01.11.2026):** normaler Ordner-Tab, 5 Unterordner, **kaum befüllt** (inzwischen gelöscht,
  nicht mehr nachstellbar). Das Zählen war also in Millisekunden fertig – passt zu Kandidat 3 (oder 2). Nachstellen mit
  ein paar fast leeren Ordnern; Netzlaufwerk/Server/Ergebnis-Tabs nur als zusätzliche Fälle prüfen.
- **Zweiter Fall (Marc, 01.11.2026, Screenshot [`059-warntext-rot-beispiel.png`](done/059-warntext-rot-beispiel.png)):**
  endgültiger Löschdialog mit `bak`, `Mac Mini M1 Model – 5242156`, `pelikan_eraser_stls` – **auch hier keine
  Größen-Zeile**, obwohl `bak` mehrere GB groß ist (vermutlich aus dem Belegungs-Tab, 033/047). Damit ist „schnell
  fertig“ (Kandidat 3) allein unwahrscheinlicher: Kandidaten 1 (Start schlägt still fehl / Job startet nie) und die
  Herkunft aus dem Belegungs-Tab (`openDelete` mit Korb/`expected`, eigener Pfad?) gleichrangig prüfen. Möglich ist
  auch, dass die Zeile **nie** erscheint, z. B. weil `liveCount` im Feld-Initialisierer läuft, bevor `req()` gesetzt
  ist (Dialog-Erzeugung prüfen: `@case ('delete')` in `workspace.html`, Reihenfolge `ops.del.set` ↔ `dialogs.show`).

## Aufgaben

1. **Reproduzieren und Ursache belegen** (roter Test zuerst; Marcs Fall: 5 fast leere Unterordner im Ordner-Tab): Spec mit `FakeJobsApi`, in dem der `count`-Job sofort
   fertig ist und gleich danach entfernt wird (Reihenfolge der Ereignisse wie im echten Kanal); ebenso fehlgeschlagener
   Start, Job hinter Warteschlange. E2E unter Xvfb: kleiner Ordner, großer Ordner, Netzlaufwerk-Simulation
   (`FNF_TEST_SLOW`), Such-Ergebnis-Tab.
2. **Beheben** je nach Ursache, z. B.: `liveCount` merkt sich die letzte Summe/den letzten Fortschritt lokal (Signal),
   statt nur aus dem Store zu lesen – ein entfernter Job verliert sein Ergebnis dann nicht; Startfehler zeigen einen
   leisen Hinweis („Size unknown“) statt nichts; Rust liefert die Summe im Abschluss-Ereignis vor dem Entfernen
   (prüfen, ob das schon so ist). Fix gilt automatisch auch für Kopieren/Verschieben.
3. **Darstellung schärfen** (Marcs Wunsch „wie viele Files und Summe der Größe“):
   - Zeile **immer** anzeigen, sobald der Dialog offen ist (sofort „Counting…“ mit Spinner, nie leer), außer in
     Archiven (dort ein kurzer Hinweis, warum nicht).
   - Dateien und Ordner getrennt und gut lesbar: „**1 234 files**, 56 folders · **4,2 GB**“ (Zahlen mit Tausender-
     trennern über `localeFor`, Größe über `formatSize`); unlesbare Einträge wie bisher.
   - Im **endgültigen** Modus (rot) die Zahlen zusätzlich in die Frage aufnehmen, sobald sie fertig sind:
     „Permanently delete 5 entries (1 234 files, 4,2 GB)? This cannot be undone.“ – vorher ohne Klammer. Gleiches
     Muster beim Hover/Fokus auf „Delete permanently“ im Papierkorb-Dialog (`armed`).
   - Nichts davon blockiert die Knöpfe (bestehende Regel „never waits for the count“).
4. **Weitere Dialoge** mit `liveCount` (Kopieren/Verschieben) mit demselben Darstellungsmuster angleichen, soweit nötig.
5. Texte en/de (`ops-texts.ts` + `.de.ts`, Einzahl/Mehrzahl!), `catalogs.spec.ts`.

## Akzeptanzkriterien

1. Löschdialog (Papierkorb und endgültig) zeigt **in jedem Fall** (Ordner-Tab, Ergebnis-Tabs, Netzlaufwerk, Server)
   sofort eine Zähl-Zeile; am Ende Anzahl Dateien, Anzahl Ordner und Gesamtgröße – auch wenn das Zählen nur Millisekunden
   dauert.
2. Im endgültigen Modus stehen Anzahl Dateien und Größe zusätzlich in der roten Frage.
3. Schlägt das Zählen fehl, steht ein kurzer Hinweis statt einer leeren Stelle; Knöpfe bleiben jederzeit bedienbar.
4. Schließen des Dialogs bricht einen laufenden Zähl-Job weiterhin ab.
5. Kopieren/Verschieben zeigt die Größe ebenso zuverlässig (gleiche Ursache behoben).

## Tests

- `live-count.spec.ts` (neu): sofort beendeter und dann entfernter Job → Summe bleibt; Startfehler → Zustand „unknown“;
  Abbruch beim Schließen.
- `dialogs.spec.ts`: Löschdialog zeigt Zeile in allen Zuständen, Zahlen in der roten Frage, Einzahl/Mehrzahl.
- Rust nur bei Änderung dort (Abschluss-Ereignis mit Summe vor dem Entfernen).
- E2E unter Xvfb wie Aufgabe 1; `pnpm check` grün.

## Nicht in diesem Prompt

- Tastenbedienung der Knöpfe und der Mehrzahl-Fehler „restore it“ → **057**.
- Zählen innerhalb von Archiven.
