# Prompt 040: Panel-Aktionen (Seiten tauschen, Ziel = Quelle, in der anderen Seite öffnen)

> **Slug:** `panel-aktionen` · **Braucht:** 002 (Aktionen, Keymaps), 004 (Seiten, Tabs), 014 (Menüleiste),
> 031 (Tabs zwischen den Seiten) · **Umfang:** S
> Lies zuerst `prompts/000-arbeitsweise.md`, dann `prompts/done/031-drag-tabs-links.design.md` (E4–E6: Tabs per Id
> zwischen den Seiten). Kleines, reines Frontend-Feature: Phasen zusammengelegt, ohne Freigabe-Halt (wie 032).
> Vorbild: Total Commander `cm_Exchange` (Strg+U), `cm_ExchangeWithTabs` (Strg+Shift+U), `cm_TargetEqualSource`,
> `cm_TransferLeft`/`cm_TransferRight` (Strg+←/→).

## Ziel

Drei Handgriffe, die man in einem Dual-Pane-Manager ständig braucht und die im Aktionskatalog fehlen.

## Aufgaben

1. **Seiten tauschen** `SWAP_PANELS`: die aktiven Tabs beider Seiten tauschen den Platz (mit Verlauf, Cursor,
   Filter, Ergebnis-/Belegungs-Tabs – der Tab wandert per Id, wie beim Ziehen in 031). Die aktive Seite bleibt
   dieselbe und behält den Fokus.
2. **Seiten mit allen Tabs tauschen** `SWAP_PANELS_WITH_TABS`: die kompletten Tab-Leisten tauschen.
3. **Ziel = Quelle** `TARGET_EQUALS_SOURCE`: die andere Seite öffnet den Ordner der aktiven Seite (in einem
   Ergebnis-Tab den Ordner, in dem gesucht wurde; im Archiv bzw. auf dem Server den virtuellen Pfad).
4. **In der linken/rechten Seite öffnen** `OPEN_CURSOR_IN_LEFT` / `OPEN_CURSOR_IN_RIGHT` (TC Strg+←/→):
   Ordner (auch „..“) oder Archiv unter dem Cursor öffnet sich in der genannten Seite; steht der Cursor auf einer
   Datei, öffnet sie den aktuellen Ordner (= Ziel = Quelle). Ist die genannte Seite die aktive, ist das wie Enter
   auf dem Ordner. Fokus bleibt in der aktiven Seite.
5. Regeln als reine Funktion (`panel-transfer-logic.ts`), Kürzel in allen drei Keymaps, Einträge im Menü (Ansicht
   bzw. Befehle) und in der Palette, Texte en/de, `docs/feature-parity.md`/README.

## Kürzel (Vorschlag)

| Aktion | Windows/Linux | macOS |
|---|---|---|
| `SWAP_PANELS` | `Ctrl+U` | `⌘U` |
| `SWAP_PANELS_WITH_TABS` | `Ctrl+Shift+U` | `⌘⇧U` |
| `TARGET_EQUALS_SOURCE` | `Ctrl+Alt+O` | `⌘⌥O` |
| `OPEN_CURSOR_IN_LEFT` / `_RIGHT` | `Ctrl+←` / `Ctrl+→` | `⌘←` / `⌘→` |

In Textfeldern behalten die Pfeile ihre Bedeutung (der Dispatcher lässt Textfeldern die Tasten, 014 #1).

## Akzeptanzkriterien

- Links `/a` (Cursor auf `x`), rechts `/b`; Strg+U → links `/b`, rechts `/a` mit Cursor auf `x`; Strg+U erneut →
  wie vorher. Links bleibt aktiv.
- Links drei Tabs, rechts einer; Strg+Shift+U → links ein Tab, rechts drei, aktive Tabs bleiben die aktiven.
- Ziel = Quelle aus einem Unterordner → rechte Seite zeigt denselben Ordner; aus einem Archiv → das Archiv.
- Cursor links auf Ordner `sub`, Strg+→ → rechts `sub`, Fokus links; Cursor auf Datei → rechts der aktuelle Ordner;
  Cursor auf „..“ → rechts der Elternordner.
- Alle Aktionen sind über die Palette und das Menü erreichbar; Kürzel im Kürzel-Dialog änderbar.

## Tests

- Frontend: `WorkspaceStore.swapActiveTabs`/`swapSides` (Ids, aktive Indizes, Sitzung), reine Transfer-Logik
  (Ordner, „..“, Archiv, Datei, Archiv im Archiv, Server, verlustbehaftete Namen, Belegungs-Zeilen),
  Aktions-Handler mit Navigation in der richtigen Seite, Keymaps ohne Konflikte.
- E2E unter Xvfb: Akzeptanzkriterien per `xdotool`.
