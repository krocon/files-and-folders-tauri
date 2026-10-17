import { ActionService } from '../../core/actions/action.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { PropertiesStore } from './properties.store';
import { QuickViewStore } from './quick-view.store';
import { ViewerStore } from './viewer.store';

/**
 * View (F3), quick view (Strg+Q) and properties (Alt+Enter) as actions – design 010.
 * F4 (edit) belongs to the external tools since 011 (`os-actions.ts`, default tool
 * `edit` = the default app).
 */
export function registerPreviewActions(
  actions: ActionService,
  ws: WorkspaceStore,
  viewer: ViewerStore,
  quick: QuickViewStore,
  props: PropertiesStore,
): () => void {
  return actions.register({
    OPEN_VIEW_DLG: { enabled: () => viewer.canOpen(), run: () => viewer.open() },
    QUICK_VIEW: { run: () => quick.toggle() },
    OPEN_ATTRIBUTE_DLG: { enabled: () => props.canOpen(), run: () => props.open() },
  });
}
