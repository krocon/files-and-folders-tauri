import { ActionService } from '../../core/actions/action.service';
import { DiffStore } from './diff.store';

/** Compare files (design 037). */
export function registerDiffActions(actions: ActionService, diff: DiffStore): () => void {
  return actions.register({
    COMPARE_FILES: { enabled: () => diff.canCompare(), run: () => diff.open() },
  });
}
