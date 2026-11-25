# Prompt 077: Cleaning Folders – Rückstände in markierten Ordnern aufräumen

> **Slug:** `rueckstaende-aufraeumen` · **Braucht:** 005 (Jobs), 006 (Löschen/Papierkorb), 008 (Clean Folders:
> `clean.rs`, Job `clean`, Dialog), 045 (Müll-Muster mit `*`/`?`, `RELEASE_EXTRAS`, `openPrepared`), 027 (letzte
> Dialogeingaben), 030 (ungeprüfte Listings), 057/076 (Dialog-Tasten) · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/008-gruppieren-leere-ordner.design.md` (E3,
> Verträge) und `prompts/done/045-serien-gruppieren.design.md` (E4 und „Abweichungen bei der Umsetzung“). Beispiel
> aus Marcs Filmordner: [`077-rueckstaende-aufraeumen-beispiel.txt`](077-rueckstaende-aufraeumen-beispiel.txt).

## Auftrag (Marc, 25.11.2026)

Ein Clean-Dialog, der aufgeht, die **selektierten Ordner als Eingabe** nimmt, **Löschungen vorschlägt** und sie
dann auch **ausführt**. Leere Ordner (auch rekursiv) sollen weg – und ebenso Ordner, in denen nach dem Entpacken
und Wegverschieben der Filme nur noch Reste liegen.

## Ausgangslage: vier Ordner aus Marcs Filmordner

Markiert sind vier Ordner (vollständiger Baum mit Größen in der Beispieldatei):

| Ordner | Inhalt | Urteil |
|---|---|---|
| `Lustiges Taschenbuch - Europareise 01-03` | 3 × `.cbr`, 1,97 GB, keine Unterordner | **bleibt** – echte Inhalte (Comics) |
| `Mein Land will nicht verschwinden (2025)` | 1 Release-Unterordner mit 1 × `.nfo` (736 B) | **Rückstand** – ganz weg |
| `Miss Merkel - Ein Kreuzfahrt Krimi (2025)` | 1 Release-Unterordner mit 1 × `.nfo` (647 B) | **Rückstand** – ganz weg |
| `MobLand S02 German DL 1080P WEB H264-WAYNE` | 3 Release-Unterordner, je 1 × `.nfo` + `Sample/…-sample.mkv` (55–75 MiB) | **Rückstand** – ganz weg, ≈ 202 MiB |

Beobachtungen, die das Design tragen müssen:

1. **Kein einziger Ordner ist wörtlich leer.** „Leer“ heißt hier: enthält (rekursiv) nur Beiwerk – `.nfo`,
   `Sample/`, `*-sample.mkv`. Der vorhandene Dialog „Ordner aufräumen“ (008) meldet mit seinen Defaults für alle
   vier Ordner **„Nichts zu löschen“**.
2. Technisch kann 008 + 045 E4 den Fall schon: „Auch der Startordner selbst“ an, „Als leer behandeln …“ an und
   `*.nfo; sample; *-sample.*` von Hand eintippen. Das weiß niemand, und das Ergebnis ist eine flache Pfadliste
   ohne Urteil je markiertem Ordner.
3. **Samples sind groß** (bis 75 MiB). Eine Regel „Beiwerk = kleine Datei“ greift nicht; umgekehrt darf ein
   4-GB-Film, der zufällig `…-sample.mkv` heißt, nicht als Beiwerk gelten.
4. Der Ordner, der bleiben muss, unterscheidet sich nur durch die **Art seiner Dateien** (`.cbr`). Die Regel muss
   deshalb lauten: *alles, was nicht ausdrücklich Beiwerk ist, ist Inhalt* – nie umgekehrt (keine Liste
   „wichtiger“ Endungen).

## Ziel

Der Dialog beantwortet für **jeden markierten Ordner** eine Frage: *Ist das ein Rückstand?* – und zeigt, was er
deshalb löschen würde und warum der Rest bleibt.

```
Ordner aufräumen – 4 Ordner in /…/Filme.nosync                Profil: [Release-Reste ▾]

 ☑  Ordner                                          Urteil            Löscht              Bleibt
 ☐  Lustiges Taschenbuch - Europareise 01-03        bleibt            –                   3 Dateien · 1,97 GB (.cbr)
 ☑  Mein Land will nicht verschwinden (2025)        Rückstand         2 Ordner · 1 Datei · 736 B     –
 ☑  Miss Merkel - Ein Kreuzfahrt Krimi (2025)       Rückstand         2 Ordner · 1 Datei · 647 B     –
 ☑  MobLand S02 German DL 1080P WEB H264-WAYNE      Rückstand         7 Ordner · 6 Dateien · 202 MiB –

 Details: MobLand S02 …                (Baum/Liste des Ordners unter dem Cursor: was geht, was bleibt, Grund)

 3 Ordner werden gelöscht · 11 Ordner, 8 Dateien · 202 MiB          Löschen: (•) in den Papierkorb ( ) endgültig
                                                                          [Esc Abbrechen]  [↩ Aufräumen]
```

Drei Urteile je Startordner:

- **Rückstand** – enthält rekursiv nur Beiwerk und leere Ordner → der Startordner geht **als Ganzes** (vorgewählt).
- **teilweise** – hat Inhalt, aber darunter liegen leere Unterordner (bzw. reine Beiwerk-Unterordner, s. Aufgabe 4)
  → nur diese gehen, der Startordner bleibt.
- **bleibt** – nichts zu tun; die Zeile nennt den Grund (Anzahl, Größe, häufigste Endungen des Inhalts).

## Abgrenzung zum Bestand

- **008** liefert Suche (`find_empty_dirs`), Job `clean` (prüft jeden Eintrag unmittelbar vor dem Löschen neu) und
  einen Dialog mit flacher Liste. **045 E4** hat Müll-Muster mit `*`/`?` ergänzt und öffnet den Dialog vorbelegt
  (`openPrepared`, `RELEASE_EXTRAS`).
- **Neu hier:** Urteil je Startordner, Profile statt Mustertippen, Größen, Grund fürs Bleiben, Abwählen je Ordner,
  Schutz gegen große „Samples“, Kontextmenü auf Ordnern.
- **Kein zweiter Dialog neben 008** – im Design entscheiden (Empfehlung: Variante A):
  - **A:** den vorhandenen Dialog ausbauen (gleiche Aktion `OPEN_DELETE_EMPTY_FOLDERS_DLG`, `CleanFoldersStore`);
    das heutige Formular wird zum Bereich „Regeln“/Profil „Eigene“. `openPrepared` (045) muss weiter funktionieren.
  - B: neue Aktion + neuer Dialog, 008 bleibt daneben (doppelte Logik, zwei Einträge im Menü).

## Aufgaben

1. **Bestand prüfen** (Phase 1, Design `077-rueckstaende-aufraeumen.design.md`): `clean.rs` (`scan_dir`,
   `Matcher`, Grenzen), `jobs/clean.rs` (Neuprüfung, Reihenfolge Kinder → Eltern), `CleanFoldersStore`/Dialog,
   `series-engine.ts` (`RELEASE_EXTRAS`), `cleanRoots`. Mit einer Fixture aus der Beispieldatei festhalten, was der
   heutige Scan mit welchen Optionen liefert (Ausgangswert für die Tests).
2. **Scan je Startordner (Rust):** Das Ergebnis wird je Wurzel gegliedert – Vorschlag `CleanScan.roots:
   Vec<RootVerdict>` mit `path`, `verdict` (`residue | partial | keep`), `removeDirs`, `removeFiles`,
   `removeBytes`, `keepFiles`, `keepBytes`, `keepExtensions` (die häufigsten, begrenzt), `keepSample` (die ersten
   Namen, begrenzt, wie `junkNames`). Größen werden beim Durchlauf mitgezählt (kein zweiter Durchlauf, keine
   `dirsize`-Jobs). Im Design festlegen, ob `find_empty_dirs` erweitert wird oder ein Command `scan_residue`
   daneben entsteht; DTOs auf beiden Seiten + Test (`CLAUDE.md` §4).
   Unverändert verbindlich: keinen Symlinks folgen (ein Link ist Inhalt), kein fremdes Dateisystem, unlesbare
   Ordner = Inhalt, nie oberhalb einer Wurzel, Grenzen (`truncated` → angefangene Ordner gelten als Inhalt),
   abbrechbar über `scanId`, veraltete Antworten verwerfen.
3. **Beiwerk-Regeln als Profil** (Auswahl im Dialog, letzte Wahl über `dialogs.recent`):
   - **Nur leere Ordner** – wie 008-Default plus Systemmüll (`DEFAULT_JUNK`). Für beliebige Ordner gefahrlos.
   - **Release-Reste** (löst Marcs Fall): Systemmüll + `RELEASE_EXTRAS` aus 045 – **eine** Quelle für beide
     Features, nicht kopieren. Im Design prüfen, was der Liste fehlt (Kandidaten: `*.sfv`, `*.srr`, `*.md5`,
     `*.url`, `proof`-Bilder, Ordner `Proof`/`Subs`) und was bewusst **nicht** hineingehört: Bilder allgemein
     (`*.jpg`/`*.png` – Fotoordner!), Untertitel, Archivteile (`*.rar`, `*.r00` …; als abschaltbare Option
     „entpackte Archivteile“ mit Default aus erwägen – groß und unwiederbringlich).
   - **Eigene** – die Felder von heute (Müll-Namen/Muster, „Dateien nach Muster löschen“).
   Vorbelegung: Sind Ordner markiert → „Release-Reste“ ist **nicht** automatisch gewählt; es gilt die letzte Wahl,
   beim ersten Mal „Nur leere Ordner“. (Entscheidung im Design bestätigen – ein Default, der Dateien löscht, soll
   eine bewusste Wahl gewesen sein.)
4. **Schutzregeln** (Rust, getestet – nicht nur im Frontend):
   - **Größengrenze für Beiwerk:** eine Datei, die nur über ein Muster als Beiwerk gilt und größer ist als die
     Grenze, zählt als **Inhalt**. Zwei Werte, weil Samples groß sind: allgemein klein (Vorschlag 1 MiB), für
     Sample-Muster/-Ordner großzügig (Vorschlag 300 MiB); im Profil sichtbar und änderbar. Marcs Samples (≤ 75 MiB)
     gehen durch, ein 4-GB-`…-sample.mkv` hält seinen Ordner fest (Urteil „bleibt“, Grund genannt).
   - **Versteckte Dateien** sind Inhalt, außer sie stehen im Systemmüll.
   - **Ordner mit Inhalt werden nicht ausgeweidet:** In einem Ordner mit Urteil „teilweise“ gehen wirklich leere
     Unterordner. Ob auch reine Beiwerk-Unterordner gehen (`Sample/` neben einem Film – heutiges Verhalten laut
     045 „Abweichungen“), wird eine Option, Default **aus**; einzelne Beiwerk-Dateien neben Inhalt bleiben immer
     (dafür gibt es „Dateien nach Muster löschen“ im Profil „Eigene“).
   - Wurzeln, die ineinander liegen oder doppelt sind, werden zusammengeführt; Gefahrenprüfung (`check_danger`:
     Home, Volume-Wurzeln …) für jede Wurzel, die als Ganzes gehen soll.
5. **Dialog:** oben Profil + Regeln (einklappbar), darunter die **Ordner-Tabelle** (GuiExpert `preview-grid`:
   Checkbox, Name relativ zum Panel-Ordner, Urteil, „Löscht“, „Bleibt“), darunter **Details** des Ordners unter
   dem Cursor (was geht – Kinder zuerst –, was bleibt mit Grund). Zeilen mit Urteil „bleibt“ sind nicht anwählbar.
   Summenzeile: Ordner/Dateien/Bytes der angewählten Zeilen. Hinweise für `truncated` und unlesbare Ordner wie
   heute. Tasten: Leertaste = an/abwählen, ↩ = Aufräumen (Papierkorb; **endgültig nie auf Enter**, 057), Esc,
   Rollen/Tastenkappen nach 076. Suche läuft entprellt neu, wenn Profil oder Regeln sich ändern.
6. **Eingabe:** markierte echte Ordner des aktiven Panels (`cleanRoots`), ohne Markierung der Ordner unter dem
   Cursor, sonst der Panel-Ordner (im Design entscheiden: heute gilt „markiert, sonst Panel-Ordner“ – der Cursor-
   Ordner ist näher an Marcs Erwartung „selektierte Folder als Input“; Verhalten von F8 als Maßstab nehmen).
   Markierte **Dateien** werden ignoriert und im Dialog als Hinweis gezählt.
7. **Ausführung:** ein Job `clean` mit genau den Einträgen der angewählten Ordner; der Job prüft wie heute jeden
   Eintrag neu, **einschließlich der Größengrenze** (zwischen Vorschau und Löschen kann ein Film dazugekommen
   sein → „nicht mehr leer“, Ordner bleibt). Im Design klären: Ein Rückstands-Ordner soll als **ein**
   Papierkorb-Eintrag landen (wiederherstellbar mit einem Griff) statt als viele Einzeleinträge – prüfen, was
   `jobs/clean.rs` heute tut und was die Neuprüfung dann braucht. Papierkorb ist bei jedem Öffnen der Default.
   Nach dem Job: Meldung mit freigegebenem Platz, Panels frischen sich auf, Markierung der gelöschten Ordner
   entfällt, die der gebliebenen bleibt stehen.
8. **Aktion & Einstiege:** `OPEN_DELETE_EMPTY_FOLDERS_DLG` behalten (Kürzel unverändert), Label angleichen
   („Clean folders…“ / „Ordner aufräumen…“), zusätzlich im **Kontextmenü** auf Ordnern/Markierung. Gesperrt in
   Archiven, auf Serverpfaden, in Ergebnis-Tabs ohne echten Ordner und auf ungeprüften Listings
   (`OFF_WHILE_UNCHECKED`) – prüfen, ob das heute schon alles gilt, sonst nachziehen.
9. **Texte** en/de (`clean-texts.ts` + `.de.ts`), Urteile und Gründe als Katalogfunktionen (Mehrzahl!), Größen
   über die vorhandene Formatierung.
10. **Doku:** README-Feature (Norton-Screenshot nach 044 – Marcs Beispiel als Szene im Demo-Dateisystem),
    `docs/architecture.md` (Entscheidungen), `docs/roadmap.md`, `docs/feature-parity.md` (mr „Clean“), Index
    `prompts/README.md`.

## Akzeptanzkriterien

- **Marcs Beispiel** als Fixture (Dateien per `set_len` in echter Größe, sparse), vier Ordner markiert, Profil
  „Release-Reste“: `Lustiges Taschenbuch …` = „bleibt“ (3 Dateien, `.cbr`), nicht anwählbar; die drei anderen =
  „Rückstand“, vorgewählt, mit 2 Ordnern/1 Datei/736 B, 2/1/647 B und 7/6/212 024 204 B. Aufräumen → drei Ordner im
  Papierkorb, der Comic-Ordner unverändert, das Panel zeigt nur noch ihn.
- Dasselbe mit Profil „Nur leere Ordner“ → viermal „bleibt“, Knopf gesperrt, Hinweis auf das Profil „Release-Reste“
  (statt eines stummen „Nichts zu löschen“).
- `Sample/film-sample.mkv` mit 4 GiB → der Ordner bleibt, Grund „Sample größer als 300 MiB“.
- Ordner mit Film + leerem Unterordner + `Sample/` → „teilweise“: nur der leere Unterordner geht; mit der Option
  aus Aufgabe 4 auch `Sample/`. Der Film und die `.nfo` daneben bleiben in jedem Fall.
- Zwischen Vorschau und Start wird eine Datei in einen Rückstands-Ordner gelegt → der Job lässt ihn stehen und
  meldet „nicht mehr leer“; die übrigen gehen.
- Symlink auf einen Ordner außerhalb, Mountpoint, unlesbarer Unterordner → gelten als Inhalt, nichts dahinter wird
  angefasst. Home-Ordner oder Volume-Wurzel als Startordner → nie als Ganzes löschbar.
- `openPrepared` aus „Serien nach Staffeln“ (045) funktioniert unverändert bzw. zeigt dieselbe neue Ansicht.
- 50 000 Einträge unter den Startordnern → Vorschau bleibt bedienbar, Suche abbrechbar; Bedienung komplett per
  Tastatur; Texte deutsch/englisch.

## Tests

- **Rust** (`clean.rs`, tempfile): Urteil je Wurzel für alle drei Fälle, Summen (Ordner/Dateien/Bytes), beide
  Größengrenzen, versteckte Dateien, Links, fremdes FS (soweit testbar), unlesbar (nicht als root), `truncated`,
  verschachtelte/doppelte Wurzeln, **Marcs Baum aus der Beispieldatei als ein Fall**. Job `clean`
  (`jobs/tests_tools.rs`): Rückstand als Ganzes in den Papierkorb/endgültig, Neuprüfung (neue Datei, gewachsenes
  Sample), Abbruch, nie oberhalb der Wurzel.
- **Frontend:** Store-Tests mit `FakeFoldersApi` (Profile → Optionen, Vorwahl, Abwählen, Summen, veraltete
  Antworten, Start des Jobs nur mit angewählten Ordnern, Formular merken – nie der Löschmodus, `openPrepared`);
  reine Helfer (Zeilen, Gründe) tabellengetrieben; `dialog-roles.spec.ts` und `catalogs.spec.ts` bleiben grün.
- **E2E** (echtes Fenster bzw. Xvfb): Fixture anlegen, vier Ordner markieren, Dialog öffnen, Urteile prüfen,
  Aufräumen, Ergebnis im Panel und im Papierkorb; Screenshot im Bericht beschreiben.

## Nicht in diesem Prompt (→ „Offen“ im Design)

- Automatisches Aufräumen ohne Dialog (z. B. direkt nach dem Entpacken oder Verschieben).
- Erkennen, **ob** der Film wirklich woanders liegt (Abgleich mit dem Zielordner/Index der Palette) – das Urteil
  beruht nur auf dem, was im Ordner noch liegt.
- Serverpfade und Archive.
- Eigene, benannte Profile speichern (über „Eigene“ + letzte Eingabe hinaus).
