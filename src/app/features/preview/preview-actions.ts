import { ActionService } from '../../core/actions/action.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { PropertiesStore } from './properties.store';
import { QuickViewStore } from './quick-view.store';
import { isViewableFile, ViewerStore } from './viewer.store';

/**
 * View (F3), quick view (Strg+Q), properties (Alt+Enter) and edit (F4, until 011
 * the default app) as actions – design 010.
 */
export function registerPreviewActions(
  actions: ActionService,
  ws: WorkspaceStore,
  viewer: ViewerStore,
  quick: QuickViewStore,
  props: PropertiesStore,
): () => void {
  const cursorFile = () => {
    const e = ws.panel()?.store.cursorEntry();
    return e && isViewableFile(e) ? e : undefined;
  };
  return actions.register({
    OPEN_VIEW_DLG: { enabled: () => viewer.canOpen(), run: () => viewer.open() },
    QUICK_VIEW: { run: () => quick.toggle() },
    OPEN_ATTRIBUTE_DLG: { enabled: () => props.canOpen(), run: () => props.open() },
    OPEN_EDIT_DLG: {
      enabled: () => cursorFile() !== undefined,
      run: async () => {
        const e = cursorFile();
        if (e) {
          await ws.panel()?.store.openFile(e);
        }
      },
    },
  });
}
