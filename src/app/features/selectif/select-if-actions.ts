import { ActionService } from '../../core/actions/action.service';
import { SelectIfStore } from './select-if.store';

/** Conditional / relationship-based selection dialog (OPEN_SELECT_IF_DLG, design 046). */
export function registerSelectIfActions(
  actions: ActionService,
  selectIf: SelectIfStore,
): () => void {
  return actions.register({
    OPEN_SELECT_IF_DLG: {
      enabled: () => selectIf.canOpen(),
      run: () => selectIf.open(),
    },
  });
}
