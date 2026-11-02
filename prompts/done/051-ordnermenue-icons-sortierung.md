# Prompt 051: Ordnermenü (▾) mit Icons je Abschnitt und übersichtlicher „Zuletzt“-Liste

> **Slug:** `ordnermenue-icons-sortierung` · **Braucht:** 004 (Tabs, Favoriten, `recent`), 011 (Laufwerke im Ordnermenü), 014 (`ContextMenu`), 034 (Server im Ordnermenü), 027 (Sitzung) · **Umfang:** S (reines Frontend, kein Rust)
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `features/workspace/tab-bar.ts` (`folderMenuItems`, `onFolderMenuChosen`) und `features/workspace/context-menu.ts` (`MenuItem`, `headingLines`). Gemeinsame Grundlage mit **052** (Icons im Tab-Menü): das Feld `MenuItem.icon` wird nur **einmal** eingeführt – wer zuerst umgesetzt wird, legt es an.
> Screenshot von Marc (31.10.2026): [`051-ordnermenue-icons-sortierung-beispiel.png`](051-ordnermenue-icons-sortierung-beispiel.png).

## Ist-Zustand

Das Ordnermenü (▾ links in der Tab-Leiste, `TabBar.folderMenuItems`) zeigt fünf Abschnitte, getrennt durch Linien
(`headingLines` – Überschriften nur für Screenreader):

1. **Home**
2. **Laufwerke** (`VolumesStore`, `volumeLabel`: „Media – /Volumes/Media (smbfs · 38 TB free of 186 TB)“)
3. **Server** (034: Profile, verbundene zuerst mit „● “, max. 10, dann „All connections…“)
4. **Favoriten** (`ws.favorites()`, Reihenfolge = Einfügereihenfolge des `Set`)
5. **Zuletzt** (`ws.recent()`, MRU, max. `MAX_RECENT = 20`, ohne Favoriten)

Alle Einträge sind reiner Text. Optisch ist nicht zu erkennen, zu welchem Abschnitt eine Zeile gehört; die lange
„Zuletzt“-Liste ist eine ungeordnete Wand aus vollen Pfaden (`/Users/…` und `/Volumes/…` wild gemischt) – schwer zu
überfliegen.

## Teil A: Icon vorne links für jeden Eintrag

- `MenuItem` (context-menu.ts) bekommt ein optionales Feld `icon?: string` (Font-Awesome-4.5-Klasse ohne `fa `, z. B.
  `'home'`). `ContextMenu` rendert es als `<i class="fa fa-fw fa-<icon>" aria-hidden="true">` in einer **festen
  Icon-Spalte** vor dem Label. Hat **irgendein** Eintrag eines Menüs (oder einer Gruppe – im Design entscheiden) ein
  Icon, bekommen alle Einträge die Spalte (leer, wenn ohne Icon), damit die Texte bündig stehen. Menüs ganz ohne Icons
  sehen unverändert aus (Regression für alle ~12 Verwender von `<app-context-menu>`).
- Verträgt sich mit `checked` (✓), `shortcut`-Badge, Untermenü-Pfeil und dem Buchstabensprung (Typeahead nutzt weiter
  nur `label`). Farbe = Textfarbe des Eintrags (auch bei Hover/Fokus in Norton: `--color-selection`), dimmed bei
  `disabled`. Keine neuen Farb-Tokens nötig – falls doch, Rezept `CLAUDE.md` §9.
- Vorschlag Zuordnung (nur Icons aus FA 4.5, Namen in `src/assets/font-awesome-4.5.0/` prüfen):

  | Eintrag | Icon |
  |---|---|
  | Home | `fa-home` |
  | Laufwerk `fixed` | `fa-hdd-o` |
  | Laufwerk `network` | `fa-sitemap` (oder `fa-hdd-o` + Netz-Hinweis – Design) |
  | Laufwerk `removable` / `optical` / `ram` / `unknown` | `fa-usb` / `fa-dot-circle-o` / `fa-bolt` / `fa-hdd-o` |
  | Laufwerk nicht erreichbar (`reachable: false`) | Icon gedimmt bzw. `fa-chain-broken` |
  | Server-Profil | `fa-server`; **verbunden** statt „● “-Präfix z. B. `fa-plug` oder Akzentfarbe (Text bleibt sauber, Status per `aria`/`hint`) |
  | „All connections…“ | `fa-ellipsis-h` oder `fa-cog` |
  | Favorit | `fa-star` |
  | Zuletzt | `fa-history` (oder `fa-clock-o`) |
  | Server-Pfad in Favoriten/Zuletzt (`remote://…`) | `fa-server` statt Stern/Uhr? (Design) |

- Die `VolumeKind` liefert Rust schon (`os.models.ts`), es ist keine Backend-Änderung nötig.

## Teil B: „Zuletzt“ (und Favoriten) besser lesbar – sortieren?

Marcs Frage: *Macht es Sinn, die unterste Sektion zu sortieren?* Bitte im Design kurz abwägen und entscheiden:

- **Für alphabetisch** (natürlich, ohne Groß/Klein, nach Anzeigepfad): Pfade mit gleichem Präfix stehen beieinander
  (`/Users/marckronberg/Documents/…` als Block, `/Volumes/Media/…` als Block) – man findet einen bekannten Ordner per
  Auge oder Buchstabensprung viel schneller. Die Liste ist mit ≤ 20 Einträgen klein genug, dass „wann zuletzt“ kaum
  zählt; die allerletzten Ordner sind ohnehin über Tabs und den Tab-Verlauf (`Alt+←`, Tab-Menü „History“) erreichbar.
- **Für MRU (heute)**: der eben verlassene Ordner steht oben – nützlich für „schnell zurück“.
- **Empfehlung:** „Zuletzt“ standardmäßig **alphabetisch** (die Menge bleibt MRU-begrenzt auf 20, nur die *Anzeige* wird
  sortiert), umschaltbar über die Einstellung `folderMenu.recentOrder: 'alpha' | 'recent'` (015, Schema in
  `settings-schema.json` gemeinsam mit Rust → das Schema-Feld braucht dort einen Eintrag; sonst keine Rust-Logik).
  Favoriten: ebenfalls alphabetisch anzeigen (Einfügereihenfolge eines `Set` trägt keine Bedeutung) – oder bewusst
  nicht, Begründung im Design.
- Zusätzlich die **Lesbarkeit langer Pfade** verbessern (gilt für Favoriten und Zuletzt), z. B. Ordnername vorne,
  Elternpfad gedämpft dahinter („`Swift` — /Volumes/Media/video/youtube“) oder Home als `~` abkürzen. Im Design eine
  Variante wählen; Tooltip (`hint`) zeigt immer den vollen Pfad; Typeahead springt dann über den Ordnernamen.
  `displayPath` (Server-Namen) beibehalten. Pfade nicht im Frontend zerlegen (`CLAUDE.md` §4 „Pfade sind opak“) –
  Name und Elternordner kommen aus vorhandenen Rust-Daten/Commands (`describe_paths` o. ä. prüfen) oder die Variante
  „~“-Abkürzung entfällt.
- **Wichtig:** `onFolderMenuChosen` adressiert heute über Indizes (`fav:<i>`, `recent:<i>`) in die *unsortierten*
  Listen. Beim Sortieren auf stabile Ids umstellen (Pfad in einer Map, nicht Index), sonst öffnet ein Klick den falschen
  Ordner. Erst roter Test.

## Aufgaben

1. Design kurz (`prompts/051-ordnermenue-icons-sortierung.design.md`): Icon-Spalte (je Menü oder je Gruppe), Icon-
   Tabelle, Sortierung/Anzeige (Teil B), Einstellung ja/nein.
2. `ContextMenu`: `icon` + Icon-Spalte + CSS (`context-menu.css`), Spec.
3. `TabBar.folderMenuItems`: Icons setzen, „● “ ersetzen, Sortierung und stabile Ids.
4. Einstellung (falls gewählt): Schema, Texte en/de, Einstellungsdialog.
5. Screenshot-Szene `folder-menu` (existiert, `scripts/screenshots/scenes.json`) mit `light`, `dark`, `classic-norton`
   prüfen; `docs/ui-layout.md` ergänzen.

## Akzeptanzkriterien

1. Jeder Eintrag im Ordnermenü hat links ein zum Abschnitt passendes Icon; die Texte aller Einträge stehen bündig.
2. Netzlaufwerke und lokale Platten sind am Icon unterscheidbar; verbundene Server ohne „● “-Präfix im Text, aber klar
   erkennbar (sichtbar und für Screenreader).
3. „Zuletzt“ ist gemäß Entscheidung sortiert; ein Klick/Enter auf einen Eintrag öffnet **genau** diesen Ordner (auch
   nach dem Sortieren, auch wenn Favoriten herausgefiltert wurden).
4. Andere Menüs (Dateikontextmenü, Actions, Start, 🎨, Tab-Menü bis 052) sehen ohne gesetzte Icons unverändert aus.
5. Tastatur (↑/↓, Pos1/Ende, Buchstabensprung, Esc) funktioniert wie vorher.

## Tests

- `context-menu.spec.ts`: Icon wird gerendert (`aria-hidden`), Spalte nur wenn Icons vorhanden, Label/Typeahead
  unverändert.
- `tab-bar.spec.ts`: Icons je Abschnitt und `VolumeKind`; Sortierung; **Klick auf sortierten Eintrag öffnet den
  richtigen Pfad** (roter Test zuerst); Einstellung `recent` behält MRU.
- `catalogs.spec.ts` grün (neue Texte en/de). `pnpm check` grün; Sichtprüfung per Screenshot-Szene.

## Nicht in diesem Prompt

- Favoriten per Drag umsortieren oder umbenennen; mehr als 20 „Zuletzt“-Einträge.
- Icons im Tab-Kontextmenü → **052**.
