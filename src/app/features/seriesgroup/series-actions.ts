import { ActionService } from '../../core/actions/action.service';
import { SeriesGroupStore } from './series.store';

/** Group series by season as an action (design 045): needs a local folder on the active side. */
export function registerSeriesGroupActions(
  actions: ActionService,
  sg: SeriesGroupStore,
): () => void {
  return actions.register({
    OPEN_SERIES_GROUP_DLG: { enabled: () => sg.hasFolder(), run: () => sg.open() },
  });
}
