import { ActionService } from '../../core/actions/action.service';
import { DialogService } from '../../shared/dialog/dialog.service';

/** About as an action (design 017); on macOS the native app menu has its own "About". */
export function registerAboutActions(actions: ActionService, dialogs: DialogService): () => void {
  return actions.register({
    OPEN_ABOUT_DLG: { run: () => dialogs.show('about') },
  });
}
