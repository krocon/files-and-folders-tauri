# Prompt 076: Dialog-Kürzel sichtbar an jedem Knopf

> **Slug:** `dialog-tasten-sichtbar` · **Braucht:** 057 (Rollen `appDialogKey`, Enter/Esc/Mod+Buchstabe im `Modal`)
> · **Umfang:** S–M (Anzeige + Durchgang durch alle Dialoge, kein Rust)

## Auftrag (Marc, 15.11.2026)

In jedem Dialog sollen die Knöpfe per Tastendruck auslösbar sein, und das Kürzel soll **am Knopf stehen** –
unterstrichener Buchstabe oder anders.

## Entscheidungen

| | Entscheidung | Begründung |
|---|---|---|
| **E1** | Jeder Knopf mit Rolle zeigt sein Kürzel **dauerhaft** als ruhige Tastenkappe hinter dem Text: `↩`/`Enter` (Hauptknopf), `Esc` (Abbrechen), `⌘D`/`Ctrl+D`, `⇧⌘D`/`Ctrl+Shift+D`. `::after` mit `attr(data-dialog-key)` in `styles/controls.css`, Farbe `currentColor` + Deckkraft → passt auf normalen, Haupt- und Gefahrknopf in jedem Farbschema. Das Badge „nur solange ⌘ gehalten“ (057 E4) entfällt. | Ein unterstrichener Buchstabe bräuchte Buchstaben je Sprache (057 E3 legt sie sprachunabhängig fest) und ist auf macOS unüblich; Tastenkappen kennt man aus macOS-Menüs, sie zeigen auch den Modifier und funktionieren für Enter/Esc. |
| **E2** | **Jeder** `.btn` in einem Dialog hat eine Rolle oder ist ausdrücklich ausgenommen (`data-no-dialog-key`): je Zeile wiederholte Knöpfe (Kürzel-Tabelle, Regeln, Token-Knöpfe, Vorlagen) und Icon-Knöpfe, deren Symbol schon die Taste ist (Pfeile, +/− im Viewer). `dialog-roles.spec.ts` prüft das für neue Dialoge. Wiederkehrende Buchstaben: Neu/Hinzufügen `N`, Entfernen `R`, Nach oben `U`, Nach unten `D`, Zurücksetzen `E`, Speichern unter `S`. Sich ausschließende Knöpfe (Größe berechnen/abbrechen, Vorlage speichern/bestätigen) teilen den Buchstaben. | Konsistenz zwischen Dialogen; Ausnahmen sind im Template sichtbar. |
| **E3** | Neue Rolle **`hint:<Tasten>`** (Keymap-Notation, z. B. `hint:Shift+F7`, `hint:0`): nur Anzeige und Tooltip, die Tasten behandelt der Dialog selbst (Diff F7/⇧F7, Viewer 0/1, F3/⇧F3). | Vorhandene Dialogtasten werden sichtbar, ohne eine zweite Mechanik. |

Unverändert aus 057: Enter = Hauptknopf (nie ein destruktiver), Esc = Abbrechen, `Mod+Buchstabe` = Nebenknopf,
`Mod+Shift+Buchstabe` = destruktiv, reservierte Buchstaben `A C V X Y Z Q W H M`, Konfliktdialog mit Alt-Buchstaben.

## Offen

- Im echten macOS-Fenster prüfen, ob AppKit neu vergebene Kürzel (z. B. ⌘K, ⌘I, ⌘L im Einstellungsdialog) schluckt
  (Risiko aus 057).
- Bei Bedarf eine Einstellung zum Ausblenden der Tastenkappen.
