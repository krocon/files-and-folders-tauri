import { ActionService } from '../../core/actions/action.service';
import { ViewMode } from '../../core/session/session.models';
import { isUsageChartKey, isUsageKey } from '../diskusage/usage-rows';
import { WorkspaceStore } from '../workspace/workspace.store';
import { ColumnsStore } from './columns.store';

/**
 * Columns and view modes (design 041 E8): `OPEN_COLUMNS_DLG` and the three views of
 * the active tab – full (the table), brief (names side by side), thumbnails (tiles).
 * The tabs of the disk usage stay in the full view: their columns are the content.
 */
export function registerColumnActions(
  actions: ActionService,
  ws: WorkspaceStore,
  columns: ColumnsStore,
): () => void {
  const tab = () => ws.activeTab(ws.activeSide());
  const canSwitch = () => {
    const key = tab().search?.key;
    return !isUsageKey(key) && !isUsageChartKey(key);
  };
  const view = (mode: ViewMode) => ({
    enabled: canSwitch,
    run: () => {
      const t = tab();
      if ((t.view ?? 'full') !== mode) {
        ws.updateTab(t.id, { view: mode });
      }
    },
  });
  return actions.register({
    OPEN_COLUMNS_DLG: { run: () => columns.open() },
    VIEW_MODE_FULL: view('full'),
    VIEW_MODE_BRIEF: view('brief'),
    VIEW_MODE_THUMBNAILS: view('thumbnails'),
  });
}
