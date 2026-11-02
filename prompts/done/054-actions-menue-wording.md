# Prompt 054: Actions-Menü – „MkDir“ heißt „Create folder“ wie Button und Dialog

> **Slug:** `actions-menue-wording` · **Braucht:** 006 (Ordner anlegen), 008 (Multi-MkDir), 015 (Texte en/de), 020 (Actions-Menü) · **Umfang:** XS (nur Texte + Specs, kein Rust)
> Lies zuerst `prompts/000-arbeitsweise.md` (Kurzform genügt: kein Design-Dokument, Entscheidungen im Abschlussbericht).

## Auftrag (Marc, 01.11.2026)

Im Actions-Menü steht für `OPEN_MKDIR_DLG` das alte mr-Wort **„MkDir“**. Überall sonst heißt dieselbe Funktion
**„Create folder“**: im Button unten in der Leiste (`shortLabel` aus `ACTIONS.OPEN_MKDIR_DLG.label = 'Create folder…'`
ohne `…`) und im Dialog-Titel (`ops-texts.ts` `mkdirTitle: 'Create folder'`). Das Menü soll dasselbe Wort verwenden.

## Ist-Zustand (Code gelesen)

- Das Actions-Menü hat einen **eigenen** Textkatalog (mr-Wortlaut, 020): `features/actions/actions-texts.ts`,
  `menuLabels.OPEN_MKDIR_DLG: 'MkDir'` (en) und `'Ordner anlegen'` (de, passt schon).
- `actions-menu.spec.ts` (Z. ~72) erwartet `'MkDir'` – muss mitgeändert werden (Test zuerst rot machen: erwartet
  `'Create folder'`).
- Daneben dieselbe Altlast: `OPEN_MULTIMKDIR_DLG: 'Multi MkDir…'` (en) / `'Mehrere Ordner…'` (de), während der
  Aktionskatalog `'Create several folders…'` / `'Mehrere Ordner anlegen…'` sagt.

## Aufgaben

1. `actions-texts.ts`: `OPEN_MKDIR_DLG: 'MkDir'` → **`'Create folder…'`** (de `'Ordner anlegen…'`). Die
   Ellipse folgt **055** (Regel: „…“ genau dort, wo ein Dialog aufgeht) – 054 und 055 zusammen in einem Branch umsetzen.
2. Konsistenz im selben Zug (klein, gleicher Grund): `OPEN_MULTIMKDIR_DLG` en `'Multi MkDir…'` → **`'Create several
   folders…'`** (= Aktionskatalog), de `'Mehrere Ordner…'` → **`'Mehrere Ordner anlegen…'`**. Wenn das die Spalte des
   Menüs zu breit macht (Screenshot prüfen), Rückfrage an Marc statt kürzen.
3. Deutsch bleibt beim Wort „Ordner anlegen“ (passt zu Button und `mkdirTitle`), mit Ellipse gemäß 055.
4. Weitere Fundstellen des alten Wortes in **sichtbaren** Texten suchen (`grep -rn "MkDir" src/app --include=*texts*.ts`,
   Palette, native Menüleiste `menu-model.ts`, Kürzel-Dialog, Button-Konfiguration) und angleichen. Code-Bezeichner
   (`MultiMkdirStore`, `mkdir-engine.ts`), Action-Ids und Doku-Kürzel („Multi-MkDir (008)“) bleiben unverändert.
5. `docs/feature-parity.md`, Zeilen „Ordner anlegen“/„Multi-MkDir“: in der Spalte „neu“ ggf. das Menü-Label nachziehen
   (Spalte mr bleibt „MkDir“).

## Akzeptanzkriterien

1. Actions-Menü (en) zeigt „Create folder“ statt „MkDir“; Klick öffnet unverändert den Dialog „Create folder“ (F7).
2. Englisch und Deutsch stimmen zwischen Actions-Menü, Button-Leiste, Dialog-Titel und Befehlspalette überein
   (abgesehen von der Ellipse).
3. „Multi MkDir…“ ist durch „Create several folders…“ / „Mehrere Ordner anlegen…“ ersetzt.
4. Buchstabensprung im Menü funktioniert mit den neuen Anfangsbuchstaben (`C` springt ggf. zuerst auf „Copy“ – erwartet).

## Tests

- `actions-menu.spec.ts`: neue Labels (en + de).
- `catalogs.spec.ts` grün; `pnpm check` grün.
- Sichtprüfung: `pnpm screenshots --theme light --scene actions-menu` (Spaltenbreite).

## Nicht in diesem Prompt

- Die Ellipsen-Regel selbst (→ 055); Umbenennen weiterer mr-Begriffe (eigener Prompt, falls gewünscht).
