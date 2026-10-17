# Prompt 009: Suche, Ergebnis-Tabs und Ordner-Finder

> **Slug:** `suche` · **Braucht:** 004, 005 · **Umfang:** L
> Lies zuerst `prompts/000-arbeitsweise.md`. Altes Verhalten: `docs/legacy-analysis.md` §3 (Find, Change Dir),
> §1.3 (`search`, `walkfolder`, Abbruch über `{cancelled, rid}`), §5 (Such-Tabs).

## Ziel

Schnelle, abbrechbare Suche im Rust-Backend mit gestreamten Ergebnissen in einem **Ergebnis-Tab**, das sich wie
ein normales Panel bedienen lässt (markieren, kopieren, löschen, „gehe zur Datei“). Dazu der **Ordner-Finder**
(alt „Change Dir“): alle Unterordner rekursiv mit Filter, Enter wechselt dorthin.

## Altes Verhalten (Kurzfassung)

- Suche: JS-Regex, case-sensitiv, nur Basisname; in aktuellem Ordner, einem oder allen markierten Ordnern;
  Vorlagen (cbr/cbz, epub, Bilder). Ergebnisse streamen in Tab „Search N“ mit vollem Pfad; **kein Abbruch in der UI**,
  Symlink-Zyklen möglich.
- Change Dir: rekursiver Ordnerstrom mit Filterfeld, Klick auf Spinner bricht ab.

## Aufgaben

1. **Rust `search/`**: Durchlauf (eigene Iteration oder Crate `walkdir`/`ignore` – Abhängigkeit begründen),
   folgt Symlinks nur optional und mit Zyklusschutz, abbrechbar (Token), unlesbare Ordner gesammelt (nicht
   abbrechen). Kriterien: Name (Glob **und** Regex, case-in-/sensitiv, ganzer Name/Teil), Typ (Datei/Ordner/Link),
   Größe (min/max), Änderungsdatum (von/bis, „letzte N Tage“), versteckte einbeziehen, max. Tiefe, Ausschlüsse
   (z. B. `node_modules`, `.git`). Inhalt-Suche (Text in Dateien) als **Option mit Größenlimit** – im Design
   entscheiden, ob jetzt oder später.
2. Ergebnisse gebündelt streamen (z. B. alle 50 ms oder 500 Treffer) über `Channel`, damit die UI nicht flutet;
   Gesamtzahl, durchsuchte Ordner, Dauer.
3. **Ergebnis-Tab**: neuer Tab-Typ (Prompt 004) mit Liste aus absoluten Pfaden (Spalte „Ordner“), funktioniert mit
   allen Aktionen (Kopieren, Löschen …); „Zur Datei springen“ (öffnet den Ordner im Panel, Cursor auf der Datei);
   Suche erneut ausführen; Tab-Titel zeigt Laufstatus (statt Blinken: Spinner + `aria-busy`).
4. **Suchdialog** (Alt+F7): Felder für die Kriterien, Suchorte (aktueller Ordner, markierte Ordner, Laufwerke ab
   Prompt 011), Vorlagen speicherbar, letzte Suchen merken.
5. **Ordner-Finder** (Alt+F10 o. ä.): rekursiver Ordnerstrom ab aktuellem Ordner mit Filter-Eingabe (unscharf),
   Liste virtualisiert (GuiExpert Table), Enter = in diesen Ordner wechseln, Abbruch bei Esc/Schließen.
6. **Veraltete Ergebnisse verhindern**: neue Suche bricht alte ab; Antworten mit fremder Such-Id verwerfen.
7. Kein Hintergrund-Index (bewusst); Notiz im Design, unter welchen Bedingungen ein Index später sinnvoll wäre.

## Akzeptanzkriterien

- Suche über einen Baum mit 200 000 Dateien liefert erste Treffer < 300 ms, lässt sich jederzeit abbrechen
  (< 200 ms Reaktion), meldet unlesbare Ordner.
- Symlink-Zyklus: kein Endlos-Durchlauf (Rust-Test).
- Ergebnis-Tab: Markieren + Kopieren/Löschen funktioniert, „Zur Datei“ springt korrekt.
- Ordner-Finder filtert live und wechselt per Enter.
