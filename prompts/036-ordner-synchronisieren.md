# Prompt 036: Ordner vergleichen und synchronisieren

> **Slug:** `ordner-synchronisieren` · **Braucht:** 004 (zwei Seiten, Tabs), 005/006 (Jobs, Kopieren, Löschen,
> Konflikte), 009 (Ergebnis-Tabs als Muster), 016 (SHA-256 aus den Duplikaten), 029/030 (langsame Laufwerke),
> 034 (Serverordner, zweite Stufe) · **Umfang:** L
> Lies zuerst `prompts/000-arbeitsweise.md`, dann die Designs 005, 006, 009 und 016 (Abschnitte „Verträge“).
> Vorbild: Total Commander „Verzeichnisse synchronisieren“ (Befehle → Verzeichnisse synchronisieren) und
> „Verzeichnisse vergleichen“ (Shift+F2 markiert Unterschiede). In mr gab es das nicht.

## Ziel

Zwei Ordner (Standard: die aktiven Ordner beider Seiten) werden – optional rekursiv – verglichen. Das Ergebnis zeigt
je relativem Pfad links/rechts mit Größe und Datum und einem Richtungssymbol (`→`, `←`, `=`, `≠`, nur links, nur
rechts). Der Nutzer kann je Zeile die Aktion ändern und den Abgleich als Job ausführen.

## Aufgaben

1. **Schnellvergleich** `COMPARE_DIRS` (TC Shift+F2): ohne Dialog, nur die oberste Ebene; markiert in beiden Panels
   die Einträge, die auf der anderen Seite fehlen oder neuer sind. Klein und sofort nützlich – eigene Phase.
2. **Synchronisieren-Dialog** `OPEN_SYNC_DIRS_DLG`: Ordnerpaar, rekursiv, Filter (Glob wie in der Suche),
   Kriterien Name/Größe/Datum (Toleranz in Sekunden, FAT/SMB 2 s, Zeitzonen-Option) und optional **Inhalt**
   (SHA-256 bzw. byteweise; nur bei gleicher Größe). Symlinks werden nicht verfolgt (wie überall).
3. **Vergleich als Job** `compare` in Rust: liefert gebündelt Zeilen (wie die Suche, `searchHits`-Muster), abbrechbar,
   Fortschritt. Ergebnis in einer Tabelle (GuiExpert Table, Muster `preview-grid` oder Ergebnis-Tab).
4. **Ansichtsfilter**: nur Unterschiede, nur links/rechts, gleiche ausblenden; Aktion je Zeile umschalten
   (kopieren →/←, löschen links/rechts, nichts) per Tastatur und Maus; Summen (Anzahl, Bytes je Richtung).
5. **Ausführen** als ein Job (oder Folge von Copy/Delete-Jobs mit gemeinsamem Fortschritt – Entscheidung im Design):
   Konflikte über die Engine, Löschen standardmäßig in den Papierkorb, `expected` für ungeprüfte/Netzlistings
   (030 E4/E5). Vor dem Ausführen eine Zusammenfassung.
6. **Zweite Stufe:** eine Seite ist ein Serverordner (`remote://`, 034) – Vergleich nach Größe/Datum, Inhalt nur
   lokal. Archive als Quelle nur lesend.
7. Vorlagen (Ordnerpaar + Optionen) speichern – optional, falls 027 die Dialog-Persistenz gebaut hat.

## Akzeptanzkriterien

- Zwei Testordner mit neuen, geänderten, fehlenden Dateien und Unterordnern → Ergebnis zeigt jede Kategorie richtig.
- Shift+F2 markiert in beiden Panels genau die abweichenden Einträge der obersten Ebene.
- „Nur Unterschiede“ + Ausführen → beide Seiten gleich; ein zweiter Vergleich zeigt nur `=`.
- Inhaltsvergleich findet Dateien gleicher Größe und gleichen Datums mit anderem Inhalt.
- Abbruch während Vergleich und während Abgleich lässt nichts halb Kopiertes zurück (Temp + Umbenennen wie 006).
- Namen mit Umlauten (NFC/NFD auf macOS!), Leerzeichen, Groß/klein-Unterschiede auf case-insensitiven Systemen.

## Tests

- Rust: reine Vergleichslogik (Tabellen-Fälle), Zeit-Toleranz, NFC/NFD, case-insensitiv, Symlinks, Abbruch,
  große Bäume (Laufzeit), Ausführungsplan aus Zeilenaktionen.
- Frontend: Zeilenaktionen, Filter, Summen, Schnellvergleich markiert (Fakes).
- E2E unter Xvfb. Externes Review (Schwerpunkt: Löschen auf der falschen Seite, Datenverlust).
