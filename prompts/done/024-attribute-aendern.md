# Prompt 024: Attribute ändern – Rechte, Windows-Attribute, Zeitstempel

> **Slug:** `attribute-aendern` · **Braucht:** 005 (Job-Engine), 006 (Auswahl, Dialog-Muster), 010 (Eigenschaften),
> 016 (Archive sperren Aktionen), 030 (ungeprüfte Listings) · **Umfang:** M
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/010-vorschau-eigenschaften.design.md` (E5) und
> `prompts/done/005-job-queue.design.md` (Verträge). Anlass: `docs/feature-parity.md` Zeilen „Attribute ändern“ (A.1)
> und „Attribute“ (K), Folge-Prompt 024. Marc hat am 20.10.2026 den Rahmen festgelegt und die Umsetzung ohne
> Haltepunkt nach Phase 1 freigegeben.

## Ziel

Rechte (Unix), Attribute (Windows, „versteckt“ unter macOS) und Zeitstempel eines oder vieler Einträge lassen sich
ändern – auf Wunsch auch für den Inhalt markierter Ordner. Das Ändern läuft als Job mit Fortschritt, Abbruch und
Fehlerprotokoll je Eintrag; Rust prüft jede Anfrage.

## Bestand

- Eigenschaften-Dialog (010 E5, `features/preview/properties-dialog.ts`, Rust `properties.rs`): reine Anzeige von
  Zeiten, Unix-Modus/Eigentümer, Windows-Attributen; `OPEN_ATTRIBUTE_DLG` („Properties…“, `Alt+Enter`, macOS auch `⌘I`)
  öffnet ihn, ein Hinweis verweist auf „später“.
- mr: `cmd/attribute` – Archive/Hidden/Read only/System und „Datum/Zeit ändern“ für **eine** Datei, Server per
  PowerShell (Windows) bzw. nur Schreibbit des Eigentümers (Unix).
- Job-Engine (005): `JobSpec`, `validate`, `Reporter` (Fortschritt, `dirsChanged`), `ItemError`, Abbruch/Pause.

## Aufgaben

1. **Job-Art `attributes`**: Pfade, Änderung (Bits setzen/löschen, Flags dreiwertig, Zeiten), Option „rekursiv“ mit
   Filter (nur Dateien / nur Ordner / beides). Validierung in Rust (Pfade, Masken, Plattform, Zeitbereich, Gefahr bei
   rekursiven Änderungen an Wurzel/Home/Systemordnern), `tempfile`-Tests.
2. **Unix:** rwx für u/g/o, setuid/setgid/sticky mit Warnhinweis, Oktal-Eingabe, Dreifach-Zustand bei
   Mehrfachauswahl. Eigentümer/Gruppe: begründet entscheiden. **Symlinks nie folgen** – ein markierter Link wird
   übersprungen und gemeldet, Links im Ordnerinhalt werden still übersprungen (gezählt).
3. **Windows:** R/H/S/A dreiwertig über `SetFileAttributesW` hinter `platform/`.
4. **macOS:** „versteckt“ (`UF_HIDDEN`, `lchflags`).
5. **Zeitstempel:** Änderungs- und Zugriffszeit auf Datum/Zeit oder „jetzt“; Erstellzeit, wo das OS es kann.
6. **Dialog** mit plattformabhängigen Feldern, Vorschau „x Einträge · y Änderungen“, Strg/⌘+Enter; eigene Aktion
   (Entscheidung zur Aktions-Id im Design), Einstieg auch aus dem Eigenschaften-Dialog. Danach frischen die Panels
   über `dirsChanged` auf.
7. Archive (virtuelle Pfade) und ungeprüfte Listings (030) sperren die Aktion.

## Akzeptanzkriterien

- Eine Datei: Gruppe-Schreiben setzen → Modus ändert sich genau um dieses Bit; Oktal `640` setzt alle neun Bits.
- Drei Dateien mit verschiedenen Modi: Kästchen, in denen sie sich unterscheiden, stehen auf „unverändert“; nur
  angefasste Bits ändern sich.
- Ordner rekursiv, „nur Ordner“, `g+x`: Unterordner bekommen das Bit, Dateien nicht; Links bleiben unberührt (auch
  ihr Ziel außerhalb).
- Markierter Symlink: Ziel unverändert, Meldung „übersprungen“ im Fehlerprotokoll.
- Änderungszeit auf ein Datum setzen → die Liste zeigt das neue Datum nach dem Job ohne manuelles Auffrischen.
- In einem ZIP-Ordner und bei ungeprüftem Listing ist die Aktion gesperrt (Hinweis).
- Rekursiv auf dem Home-Ordner → Ablehnung mit verständlichem Fehler.

## Tests

- Rust: Masken/Plattform-Validierung, Modus setzen/löschen (Unicode/Leerzeichen), Mehrfachauswahl, Rekursion mit
  Filter, Reihenfolge bei unlesbaren Ordnern (nur ohne root), Links (markiert, im Inhalt, dangling), Zeiten
  (Datum, nur Zugriff, „jetzt“, Ordner), fehlender Eintrag, Abbruch, `dirsChanged`, Wire-Format.
- Frontend: reine Logik (Dreifach-Zustand, Oktal, Änderung bauen, Zählen), Store (Auswahl, Laden der Ausgangswerte,
  Start des Jobs, Meldungen), Dialog (Felder je Plattform, Strg+Enter), Sperren (Archiv, ungeprüft), Texte en/de.
- E2E unter Xvfb (Linux): Akzeptanzkriterien oben; macOS/Windows nur in der CI kompiliert bzw. bei Marc.
