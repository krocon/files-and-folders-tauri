import { ActionService } from '../../core/actions/action.service';
import { DialogService } from '../../shared/dialog/dialog.service';

/** Settings… (Mod+,) and About… (design 015). Returns the unregister function. */
export function registerSettingsActions(
  actions: ActionService,
  dialogs: DialogService,
): () => void {
  return actions.register({
    OPEN_SETUP_DLG: { run: () => dialogs.show('settings') },
    OPEN_ABOUT_DLG: { run: () => dialogs.show('about') },
  });
}
