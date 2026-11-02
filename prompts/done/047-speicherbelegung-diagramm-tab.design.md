# Design 047: Speicherbelegung – Diagramm als eigener Tab

Status: umgesetzt (02.11.2026, selbständig – Entscheidungen ohne Rückfrage, bitte prüfen). Löst Design 033 E1 ab
(Diagramm als Overlay im Ziel-Panel).

## Entscheidungen

- **E1 Schließen des Listen-Tabs:** (b) – der Diagramm-Tab schließt mit (der letzte Tab einer Seite wird zum
  Ordner-Tab), dann wird der Scan freigegeben. Schließen nur des Diagramm-Tabs lässt Liste und Scan stehen;
  „Diagramm“ im Kopf des Listen-Tabs (bzw. Aktion `DISK_USAGE_SHOW_CHART`) holt ihn zurück.
- **E2 Mehrere Scans:** ein vorhandener Diagramm-Tab auf der Gegenseite wird **wiederverwendet** (zeigt den neuen
  Scan); der Diagramm-Tab eines älteren Scans lässt sich über dessen „Diagramm“-Knopf wieder öffnen.
- **E3 Kopfzeile:** einzeilig im Panel-Header (Brotkrumen, Größe, Objekte, `[Ringe] [Kacheln]`, `[Stopp]`/
  `[Neu scannen]`); der eigene Kopf der Diagramm-Komponente entfällt. Statuszeile: gezeigter Ordner + Sammelkorb.
- **E4 Ziele/Navigation:** `targetDir()` liefert bei aktivem Diagramm-Tab den nächsten echten Ordner-Tab dieser Seite
  (links zuerst), nie den Scan-Ordner. Eine Navigation (`requestNavigate`, Ordnermenü ▾, `Strg+←/→`) auf einer Seite mit
  aktivem Diagramm-Tab öffnet einen Ordner-Tab daneben statt den Diagramm-Tab zu überschreiben. `+` auf dem
  Diagramm-Tab öffnet einen Ordner-Tab. Diagramm-Tabs werden nicht gespeichert.

## Verträge (Frontend)

- Schlüssel `usage-chart:<scanId>` (`usageChartKey`, `isUsageChartKey`, `chartScanIdOf`, `anyUsageScanId`).
- `DiskUsageStore`: `openChartTab`, `openOrFocusChart`, `chartTab`, `listSide` (die Seite, deren gewählter Tab die
  Liste des Scans ist – Kopplung Cursor ↔ Diagramm folgt Tab-Tausch und Ziehen).
- `OpsStore.openDeleteBasket(scanId, mode)`: „Entfernen…“ im Korb und F8/Shift+F8 im aktiven Diagramm-Tab löschen
  **nur** den Korb (mit `expected`, Alter, `usageScan` → `afterRemoval` des Scans), egal was die Seiten zeigen.
- `DiskUsageChart` ohne `side`-Input.

## Grenzen

- Im Diagramm-Tab gehen Backspace/Alt+← nicht über die Tastatur (der Fokus liegt im Diagramm, nicht in einer Liste);
  Navigation dort per Klick (Segment, Mitte, Brotkrumen im Kopf).
- E2E nur per Screenshot-Szenen (`disk-usage`, `disk-usage-target`), nicht im echten Fenster.
