# Prompt 032: Starter-Menü (eigener Schnellstart)

> **Slug:** `starter-menue` · **Braucht:** 002 (Aktionen, Keymaps), 011 (Tools: Start ohne Shell, Platzhalter),
> 014 (Menüleiste nativ/HTML, Kontextmenü), 015 (Einstellungen, i18n, Export/Import), 022 (Konfig-Editoren) ·
> **Umfang:** S–M
> Auftrag von Marc (21.10.2026), Vorbild Total Commanders Menü „Start“. Umgesetzt ohne Freigabe-Halt (kleines
> Feature, Phasen zusammengelegt – Design `032-startermenue.design.md`).

## Auftrag (wörtlich)

> Starter-Menü (Eigener Schnellstart)
>
> * Aufruf: Drücken Sie `Alt` + `S` (oder was anderes) oder im Menü `Start`.
> * Bearbeiten: Wählen Sie den Eintrag Startermenü ändern.
> * Funktion: Sie können hier Programme, Skripte oder Ordner hinzufügen und der aktuellen Datei Parameter (wie `%P%N`
>   für den Dateinamen) mitgeben.
> * Tastenkürzel: Dem Menü können Sie direkt über die Konfiguration eine Tastenkombination zuweisen.

## Akzeptanzkriterien

1. Menü **Start** in der Menüleiste (macOS nativ, Windows/Linux HTML) mit den eigenen Einträgen, Untermenüs,
   Trennlinien und am Ende „Startermenü ändern…“.
2. `Alt+S` (Aktion `OPEN_STARTER_MENU`, in den Keymaps aller OS, über den Kürzel-Dialog änderbar) öffnet dasselbe
   Menü als Popup an der aktiven Liste – bedienbar per Tastatur (APG-Menü).
3. „Startermenü ändern…“ (`OPEN_STARTER_CONFIG_DLG`) öffnet einen Editor: Programme/Skripte, Ordner, Untermenüs,
   Trennlinien hinzufügen, anordnen (auch in/aus Untermenüs), Titel/Kommando/Parameter/Startordner/Kürzel ändern;
   Schnell-Einträge „Aktueller Ordner“ und „Datei unter dem Cursor“.
4. Parameter wie in TC: `%P%N`, `%N`, `%O`, `%E`, `%P`, `%T`, `%S`, `%%` – jedes Wort ein Argument, keine Shell.
5. Jeder Eintrag kann ein eigenes Tastenkürzel haben (Konfiguration); belegte/ungültige Kürzel werden gemeldet.
6. Ordner-Einträge wechseln die aktive Seite dorthin.
